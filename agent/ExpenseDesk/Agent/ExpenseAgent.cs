using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using AGUI.Abstractions;
using AGUI.Server;
using ExpenseDesk.Desk;
using ExpenseDesk.Learning;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace ExpenseDesk.Agent;

/// <summary>
/// The "expense" agent the dashboard and Teams talk to. It wraps the model
/// agent (a ChatClientAgent with the four tools and learned skills) and adds
/// what the model shouldn't own: reading the Teams message into a request,
/// publishing <see cref="ExpenseDeskState"/> as AG-UI STATE_SNAPSHOT events
/// around every tool result, and the deterministic re-check after Finance
/// edits a field.
/// </summary>
public sealed class ExpenseAgent(
    AIAgent modelAgent,
    Intake intake,
    DeskStore store,
    ExpenseTools tools,
    LearnedSkills learned,
    ILogger<ExpenseAgent> logger) : DelegatingAIAgent(modelAgent)
{
    public const string AgentId = "expense";

    public override string Name => AgentId;

    public override string Description => "Contoso expense desk: checks hotel requests against policy and routes over-cap ones to the manager in Teams.";

    protected override Task<AgentResponse> RunCoreAsync(
        IEnumerable<ChatMessage> messages, AgentSession? session = null, AgentRunOptions? options = null, CancellationToken cancellationToken = default) =>
        RunCoreStreamingAsync(messages, session, options, cancellationToken).ToAgentResponseAsync(cancellationToken);

    protected override async IAsyncEnumerable<AgentResponseUpdate> RunCoreStreamingAsync(
        IEnumerable<ChatMessage> messages,
        AgentSession? session = null,
        AgentRunOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        RunAgentInput? input = null;
        _ = options is ChatClientAgentRunOptions { ChatOptions: { } chatOptions } && chatOptions.TryGetRunAgentInput(out input);
        var trigger = DeskTrigger.Parse(input?.ForwardedProperties, messages);
        logger.LogInformation("Run {RunId}: {Trigger}", input?.RunId, trigger);

        using var deskLock = await store.LockAsync(cancellationToken);
        await learned.RefreshAsync(store, force: trigger is DeskTrigger.Learn, cancellationToken);
        // Not before an edit: the dashboard already shows it, and the pre-edit desk would flicker back.
        if (trigger is not DeskTrigger.FieldsEdited) yield return Snapshot();

        var steps = trigger switch
        {
            DeskTrigger.TeamsMessage t => TeamsMessageAsync(t, session, options, cancellationToken),
            DeskTrigger.Decision d => DecisionAsync(d, session, options, cancellationToken),
            DeskTrigger.FieldsEdited e => FieldsEditedAsync(e, input?.State),
            DeskTrigger.Reset => ResetAsync(),
            _ => Nothing(),
        };
        await foreach (var update in Logged(steps, trigger, cancellationToken)) yield return update;
    }

    /// <summary>
    /// AGUI.Server turns an exception into a bare RUN_ERROR ("An error occurred while
    /// streaming the agent response"), so log the real one before it does.
    /// </summary>
    private async IAsyncEnumerable<AgentResponseUpdate> Logged(
        IAsyncEnumerable<AgentResponseUpdate> source, DeskTrigger trigger, [EnumeratorCancellation] CancellationToken ct)
    {
        await using var updates = source.GetAsyncEnumerator(ct);
        while (true)
        {
            try
            {
                if (!await updates.MoveNextAsync()) yield break;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "Run failed: {Trigger}", trigger);
                throw;
            }
            yield return updates.Current;
        }
    }

    /* ---------------- scenes ---------------- */

    private async IAsyncEnumerable<AgentResponseUpdate> TeamsMessageAsync(
        DeskTrigger.TeamsMessage message, AgentSession? session, AgentRunOptions? options, [EnumeratorCancellation] CancellationToken ct)
    {
        var fields = await intake.ReadAsync(message.Text, ct);
        var (request, missing) = fields.IsHotelRequest
            ? Intake.ToRequest(fields, store.NextRequestId(), message.From, message.Text, DeskJson.Now())
            : (null, "the city, dates and nightly rate");
        if (request is null)
        {
            yield return Say($"Hi {FirstName(message.From)}, I can get hotel stays approved. Send me {missing} and I'll check it against policy.");
            yield break;
        }

        store.Open(request);
        yield return Snapshot();

        var context = $"""
            You're handling expense request {request.Id}, which just arrived in Teams.
            Requester's Teams display name: {request.Requester.Name}
            Category: {request.Category}
            City: {request.City}
            Purpose: {request.Purpose}
            Nightly rate: {Money(request.NightlyRate)} (GBP)
            Nights: {request.Nights}{(request.CheckIn is null ? "" : $" ({request.CheckIn} to {request.CheckOut})")}
            Total: {Money(request.Total)}
            """;
        await foreach (var update in RunModelAsync([new(ChatRole.System, context), new(ChatRole.User, message.Text)], session, options, ct))
            yield return update;
    }

    private async IAsyncEnumerable<AgentResponseUpdate> DecisionAsync(
        DeskTrigger.Decision decision, AgentSession? session, AgentRunOptions? options, [EnumeratorCancellation] CancellationToken ct)
    {
        var request = store.Find(decision.RequestId);
        if (request is not { Status: RequestStatus.AwaitingManager, ManagerId: { } managerId })
        {
            logger.LogWarning("Ignoring a decision on {RequestId}: it isn't waiting on a manager", decision.RequestId);
            yield break;
        }
        if (decision.DecidedBy is { } by && by != managerId)
        {
            logger.LogWarning("Ignoring a decision on {RequestId} from {DecidedBy}: only {ManagerId} can decide it", request.Id, by, managerId);
            yield break;
        }

        store.State.ActiveRequestId = request.Id;
        yield return Snapshot();

        var manager = store.Seed.Directory[managerId];
        var outcome = decision.Outcome;
        var edits = request.Edits is { Count: > 0 }
            ? "Finance edited the request before the decision: " +
              string.Join("; ", request.Edits.Select(e => $"{e.Field} from {e.From} to {e.To}")) + "."
            : "Finance made no edits.";
        var context = $"""
            Expense request {request.Id} is waiting on the requester's line manager, {manager.Name} ({manager.Id}).
            Requester: {request.Employee?.Name ?? request.Requester.Name}
            {request.City} hotel for {request.Purpose}: {Money(request.NightlyRate)} a night for {request.Nights} nights, total {Money(request.Total)}.
            Cost centre: {request.CostCenter}
            {edits}
            """;
        var action = $"""
            Teams approval card action on {request.Id}: {manager.Name} ({manager.Id}) pressed {(outcome == "approved" ? "Approve" : "Reject")}.
            {(string.IsNullOrWhiteSpace(decision.Note) ? "No note." : $"Their note: \"{decision.Note}\"")}
            """;

        tools.PendingDecision = new ManagerDecision(request.Id, outcome, managerId, decision.Note);
        try
        {
            await foreach (var update in RunModelAsync([new(ChatRole.System, context), new(ChatRole.User, action)], session, options, ct))
                yield return update;
        }
        finally
        {
            tools.PendingDecision = null;
        }
    }

    /// <summary>
    /// Finance edited a field in the dashboard. Re-run check_policy when a
    /// pricing field changed, then refresh the manager's card if it's out.
    /// Deterministic, with no model call, so edits sync in well under a second.
    /// </summary>
    private async IAsyncEnumerable<AgentResponseUpdate> FieldsEditedAsync(DeskTrigger.FieldsEdited edited, JsonElement? clientState)
    {
        var request = store.Find(edited.RequestId);
        if (request is null || !RequestStatus.IsOpen(request.Status)) yield break;

        var cardBefore = request.Approval?.Card;
        var changed = store.ApplyFinanceEdits(request.Id, edited, clientState);
        logger.LogInformation("Finance edited {RequestId}: {Fields}", request.Id, changed.Count == 0 ? "(no changes)" : string.Join(", ", changed));
        yield return Snapshot();
        if (changed.Count == 0) yield break;

        if (changed.Any(EditableFields.Pricing.Contains))
        {
            var callId = $"call_{Guid.NewGuid():N}"[..13];
            var args = new Dictionary<string, object?>
            {
                ["requestId"] = request.Id,
                ["category"] = request.Category,
                ["city"] = request.City,
                ["nightlyRate"] = request.NightlyRate,
                ["nights"] = request.Nights,
            };
            yield return new AgentResponseUpdate(ChatRole.Assistant, [new FunctionCallContent(callId, ExpenseTools.CheckPolicy, args)])
            {
                MessageId = $"msg_{Guid.NewGuid():N}",
            };
            var result = await tools.CheckPolicyAsync(request.Id, request.Category, request.City, request.NightlyRate, request.Nights);
            yield return Snapshot();
            yield return new AgentResponseUpdate(ChatRole.Tool, [new FunctionResultContent(callId, JsonSerializer.SerializeToElement(result, DeskJson.Options))]);
        }

        if (request.Status == RequestStatus.AwaitingManager && request.Approval is { } approval && cardBefore is not null)
        {
            // Sending the refreshed card to Teams belongs to the Teams channel (not built yet).
            var card = Policy.CardFacts(request);
            approval.Changed = card.ChangedFrom(cardBefore);
            approval.Card = card;
            approval.UpdatedAt = DeskJson.Now();
            yield return Snapshot();
        }
    }

    private async IAsyncEnumerable<AgentResponseUpdate> ResetAsync()
    {
        store.Reset();
        tools.PendingDecision = null;
        await Task.CompletedTask;
        yield return Snapshot();
    }

    private static async IAsyncEnumerable<AgentResponseUpdate> Nothing()
    {
        await Task.CompletedTask;
        yield break;
    }

    /* ---------------- the model's turn ---------------- */

    /// <summary>
    /// Runs the model agent and forwards its stream, with these changes:
    /// <list type="bullet">
    /// <item>A contract tool call goes out with its result, a state snapshot between them, once the tool has run.
    /// A call the tool rejected stays server-side: the model sees the error and corrects itself, and the dashboard
    /// (whose renderers have no failed state) only shows the call that worked.</item>
    /// <item>The learned-skill tools (copilotkit_load_skill, copilotkit_read_skill_file) stay server-side.</item>
    /// <item>Text before the first tool call is held back, so a preamble can't land under the previous request
    /// in the dashboard. If the model never calls a tool, that text is the reply and goes out at the end.</item>
    /// </list>
    /// </summary>
    private async IAsyncEnumerable<AgentResponseUpdate> RunModelAsync(
        List<ChatMessage> conversation, AgentSession? session, AgentRunOptions? options, [EnumeratorCancellation] CancellationToken ct)
    {
        var hidden = new HashSet<string>(StringComparer.Ordinal);
        var calls = new Dictionary<string, AgentResponseUpdate>(StringComparer.Ordinal);
        var held = new List<AgentResponseUpdate>();
        var calledTool = false;

        await foreach (var update in InnerAgent.RunStreamingAsync(conversation, session, options, ct))
        {
            var other = new List<AIContent>();
            foreach (var content in update.Contents)
            {
                switch (content)
                {
                    case FunctionCallContent call when !ExpenseTools.Names.Contains(call.Name):
                        hidden.Add(call.CallId);
                        break;
                    case FunctionResultContent result when hidden.Contains(result.CallId):
                        break;
                    case TextReasoningContent:
                        // The CopilotKit runtime rejects reasoning messages on the next run.
                        break;
                    case FunctionCallContent call:
                        if (!calledTool)
                        {
                            calledTool = true;
                            foreach (var earlier in Without<TextContent>(held)) yield return earlier;
                            held.Clear();
                        }
                        calls[call.CallId] = WithContents(update, [call]);
                        break;
                    case FunctionResultContent result when calls.Remove(result.CallId, out var callUpdate):
                        if (IsRejected(result))
                        {
                            logger.LogWarning("Hid a rejected {Tool} call from the dashboard", callUpdate.Contents.OfType<FunctionCallContent>().First().Name);
                            break;
                        }
                        yield return callUpdate;
                        yield return Snapshot();
                        yield return WithContents(update, [result]);
                        break;
                    default:
                        other.Add(content);
                        break;
                }
            }
            if (other.Count == 0) continue;

            var forward = other.Count == update.Contents.Count ? update : WithContents(update, other);
            if (!calledTool) held.Add(forward);
            else if (!other.Any(c => c is TextContent) || calls.Count == 0) yield return forward;
            // Text in the same update as a pending call is that call's preamble; drop it.
            else foreach (var rest in Without<TextContent>([forward])) yield return rest;
        }

        // No tool call at all: the held text is the whole reply.
        foreach (var update in held) yield return update;
    }

    private static bool IsRejected(FunctionResultContent result) =>
        result.Result is JsonElement { ValueKind: JsonValueKind.Object } json && json.TryGetProperty("error", out _);

    private static IEnumerable<AgentResponseUpdate> Without<T>(IEnumerable<AgentResponseUpdate> updates) where T : AIContent
    {
        foreach (var update in updates)
        {
            var kept = update.Contents.Where(c => c is not T).ToList();
            if (kept.Count > 0) yield return WithContents(update, kept);
        }
    }

    private static AgentResponseUpdate WithContents(AgentResponseUpdate update, List<AIContent> contents)
    {
        var source = update.AsChatResponseUpdate();
        return new AgentResponseUpdate(new ChatResponseUpdate(source.Role, contents)
        {
            MessageId = source.MessageId,
            ResponseId = source.ResponseId,
            ConversationId = source.ConversationId,
            CreatedAt = source.CreatedAt,
            ModelId = source.ModelId,
            FinishReason = source.FinishReason,
            AuthorName = source.AuthorName,
            AdditionalProperties = source.AdditionalProperties,
        });
    }

    /* ---------------- AG-UI helpers ---------------- */

    /// <summary>A raw AG-UI STATE_SNAPSHOT; AGUI.Server passes raw events through verbatim.</summary>
    private AgentResponseUpdate Snapshot() => new()
    {
        Role = ChatRole.Assistant,
        RawRepresentation = new ChatResponseUpdate
        {
            Role = ChatRole.Assistant,
            RawRepresentation = new StateSnapshotEvent { Snapshot = store.Snapshot() },
        },
    };

    private static AgentResponseUpdate Say(string text) =>
        new(ChatRole.Assistant, text) { MessageId = $"msg_{Guid.NewGuid():N}" };

    private static string FirstName(string name) => name.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? name;

    private static string Money(decimal amount) => "£" + amount.ToString("#,0.##", CultureInfo.InvariantCulture);
}
