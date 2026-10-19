using System.ComponentModel;
using ExpenseDesk.Desk;
using Microsoft.Extensions.AI;

namespace ExpenseDesk.Agent;

/// <summary>
/// The four tools from docs/agent-contract.md. Each one checks the request
/// against the desk's rules, changes the desk, and returns the result the
/// dashboard renders. Every tool's first argument is requestId so the dashboard
/// can attribute a call while its arguments are still streaming.
/// </summary>
public sealed class ExpenseTools(DeskStore store, ILogger<ExpenseTools> logger)
{
    public const string LookupEmployee = "lookup_employee";
    public const string CheckPolicy = "check_policy";
    public const string SubmitApprovalRequest = "submit_approval_request";
    public const string RecordDecision = "record_decision";

    public static readonly IReadOnlySet<string> Names = new HashSet<string>(StringComparer.Ordinal)
    {
        LookupEmployee, CheckPolicy, SubmitApprovalRequest, RecordDecision,
    };

    /// <summary>
    /// The manager's button press this run is acting on, if any. The agent may
    /// record a manager's decision only when one actually arrived.
    /// </summary>
    public ManagerDecision? PendingDecision { get; set; }

    public IList<AITool> All() =>
    [
        Create(LookupEmployeeAsync, LookupEmployee, "Look up the employee who sent the request in the company directory, with their line manager and cost centre."),
        Create(CheckPolicyAsync, CheckPolicy, "Check a hotel request against the Contoso travel policy and any learned approval rules. Pass the request's values exactly as given."),
        Create(SubmitApprovalRequestAsync, SubmitApprovalRequest, "Send the over-cap request to the employee's line manager as an Adaptive Card in Microsoft Teams. Only for requests whose policy outcome is \"over\"."),
        Create(RecordDecisionAsync, RecordDecision, "Record the final decision on a request: the manager's decision from Teams, or the agent's own approval when the request is within policy or within a learned rule."),
    ];

    private static AIFunction Create(Delegate method, string name, string description) =>
        AIFunctionFactory.Create(method, new AIFunctionFactoryOptions
        {
            Name = name,
            Description = description,
            SerializerOptions = DeskJson.Options,
        });

    public Task<object> LookupEmployeeAsync(
        [Description("The expense request id, e.g. EXP-2037.")] string requestId,
        [Description("The requester's display name from Teams.")] string name) => Guarded(() =>
    {
        var request = store.Get(requestId);
        RequireOpen(request);
        var employee = store.Seed.FindByName(name)
            ?? throw new DeskException($"No employee named \"{name}\" is in the directory.");
        var manager = store.Seed.Person(employee.ManagerId)
            ?? throw new DeskException($"{employee.Name} has no line manager in the directory.");

        if (request.Status == RequestStatus.Received) request.Status = RequestStatus.Checking;
        request.EmployeeId = employee.Id;
        request.ManagerId = manager.Id;
        request.Employee = employee.Ref();
        request.Manager = manager;
        request.CostCenter ??= employee.CostCenter;

        return new
        {
            employee = new { employee.Id, employee.Name, employee.Title, employee.Department, employee.CostCenter },
            manager = new { manager.Id, manager.Name, manager.Title, manager.Department },
        };
    });

    public Task<object> CheckPolicyAsync(
        [Description("The expense request id.")] string requestId,
        [Description("Expense category. Always \"hotel\".")] string category,
        [Description("City of the hotel.")] string city,
        [Description("Nightly rate in GBP, excluding taxes and breakfast.")] decimal nightlyRate,
        [Description("Number of nights.")] int nights) => Guarded(() =>
    {
        var request = store.Get(requestId);
        RequireOpen(request);
        if (!string.Equals(category, request.Category, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(city.Trim(), request.City.Trim(), StringComparison.OrdinalIgnoreCase) ||
            nightlyRate != request.NightlyRate || nights != request.Nights)
        {
            throw new DeskException(
                $"These values don't match {request.Id}. Call check_policy again with category \"{request.Category}\", city \"{request.City}\", " +
                $"nightlyRate {request.NightlyRate} and nights {request.Nights}.");
        }

        if (request.Status == RequestStatus.Received) request.Status = RequestStatus.Checking;
        request.Policy = Policy.Evaluate(request.Category, request.City, request.NightlyRate, store.State.LearnedRules);
        return request.Policy;
    });

    public Task<object> SubmitApprovalRequestAsync(
        [Description("The expense request id.")] string requestId,
        [Description("The employee id of the requester's line manager, from lookup_employee.")] string managerId,
        [Description("Where to send the approval card. Always \"teams\".")] string channel) => Guarded(() =>
    {
        var request = store.Get(requestId);
        if (request.Status is not (RequestStatus.Received or RequestStatus.Checking))
            throw new DeskException($"{request.Id} is {request.Status}; it can't be sent for approval now.");
        if (request.Policy?.Outcome != "over")
            throw new DeskException($"{request.Id} is not over the cap (call check_policy first). Only over-cap requests go to the manager.");
        if (request.ManagerId is null)
            throw new DeskException($"Call lookup_employee for {request.Id} first.");
        if (managerId != request.ManagerId)
            throw new DeskException($"{managerId} is not the requester's line manager. Their manager is {request.ManagerId}.");
        if (!string.Equals(channel, "teams", StringComparison.OrdinalIgnoreCase))
            throw new DeskException("Approval cards go to Teams; use channel \"teams\".");

        request.Status = RequestStatus.AwaitingManager;
        request.Approval = new Approval
        {
            ManagerId = managerId,
            SentAt = DeskJson.Now(),
            Card = Policy.CardFacts(request),
        };
        // Sending cards/approval-request.json to the manager is the Teams channel's job (not built yet).
        logger.LogInformation("Approval card for {RequestId} ready for {ManagerId} (Teams delivery not configured)", request.Id, managerId);
        return new { status = "sent", cardId = $"card_{request.Id.ToLowerInvariant()}" };
    });

    public Task<object> RecordDecisionAsync(
        [Description("The expense request id.")] string requestId,
        [Description("\"approved\" or \"rejected\".")] string outcome,
        [Description("The manager's employee id when they decided in Teams, or \"agent\" when you approve within policy or under a learned rule.")] string decidedBy,
        [Description("The learned rule id from check_policy, required when you approve under a learned rule.")] string? learnedRuleId = null,
        [Description("The manager's note, if they left one. Recorded from the card itself.")] string? note = null) => Guarded(() =>
    {
        var request = store.Get(requestId);
        outcome = outcome.Trim().ToLowerInvariant();
        if (outcome is not ("approved" or "rejected")) throw new DeskException("outcome must be \"approved\" or \"rejected\".");

        if (decidedBy == "agent")
        {
            if (request.Status is not (RequestStatus.Received or RequestStatus.Checking))
                throw new DeskException($"{request.Id} is {request.Status}; the agent can't decide it.");
            if (outcome != "approved") throw new DeskException("The agent only approves; rejections come from the manager.");
            var policy = request.Policy ?? throw new DeskException($"Call check_policy for {request.Id} first.");
            if (policy.Outcome == "over")
                throw new DeskException($"{request.Id} is over the cap; send it to the manager with submit_approval_request.");
            if (policy.Outcome == "within_learned" && learnedRuleId != policy.LearnedRule?.Id)
                throw new DeskException($"Pass learnedRuleId \"{policy.LearnedRule?.Id}\", the learned rule check_policy applied.");
            if (policy.Outcome == "within") learnedRuleId = null;

            request.Status = RequestStatus.AutoApproved;
            request.Decision = new Decision { Outcome = "approved", By = "agent", At = DeskJson.Now(), Channel = "agent", LearnedRuleId = learnedRuleId };
            return new { status = "recorded" };
        }

        if (request.Status != RequestStatus.AwaitingManager)
            throw new DeskException($"{request.Id} is {request.Status}, not waiting on a manager.");
        if (decidedBy != request.ManagerId)
            throw new DeskException($"Only {request.ManagerId}, the requester's line manager, can decide {request.Id}.");
        var pending = PendingDecision;
        if (pending is null || pending.RequestId != request.Id || pending.Outcome != outcome)
            throw new DeskException($"No {outcome} decision has arrived from the manager for {request.Id}. Never decide on the manager's behalf.");

        request.Status = outcome;
        request.Decision = new Decision
        {
            Outcome = outcome,
            By = decidedBy,
            At = DeskJson.Now(),
            Channel = "teams",
            // The manager's own words from the card, never the model's paraphrase.
            Note = pending.Note,
        };
        PendingDecision = null;
        return new { status = "recorded" };
    });

    private static void RequireOpen(ExpenseRequest request)
    {
        if (!RequestStatus.IsOpen(request.Status)) throw new DeskException($"{request.Id} is already {request.Status}.");
    }

    /// <summary>Rule violations go back to the model as the tool result so it can correct itself.</summary>
    private Task<object> Guarded(Func<object> action)
    {
        try
        {
            return Task.FromResult(action());
        }
        catch (DeskException e)
        {
            logger.LogWarning("Tool call rejected: {Reason}", e.Message);
            return Task.FromResult<object>(new { error = e.Message });
        }
    }
}

/// <summary>What the manager pressed on the Teams approval card.</summary>
public sealed record ManagerDecision(string RequestId, string Outcome, string ManagerId, string? Note);
