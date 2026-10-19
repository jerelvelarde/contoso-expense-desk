using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using ExpenseDesk.Desk;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

namespace ExpenseDesk.Tests;

/// <summary>
/// The real host (AG-UI endpoint, tools, state) with a scripted model in
/// place of Azure OpenAI and no CopilotKit Intelligence connection.
/// </summary>
public sealed class DeskHost : WebApplicationFactory<Program>
{
    public ScriptedModel Model { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        foreach (var key in new[] { "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_API_KEY", "OPENAI_API_KEY", "CPK_INTELLIGENCE_API_KEY", "CPK_INTELLIGENCE_LEARNING_CONTAINER_ID" })
        {
            builder.UseSetting(key, "");
        }
        builder.ConfigureTestServices(services => services.AddSingleton<IChatClient>(Model));
    }

    public DeskStore Store => Services.GetRequiredService<DeskStore>();

    /// <summary>Posts one AG-UI run and returns its events, parsed from the SSE stream.</summary>
    public async Task<List<JsonElement>> RunAsync(object forwardedProps, object? state = null, string? userText = null)
    {
        var client = CreateClient();
        var messages = userText is null
            ? Array.Empty<object>()
            : [new { id = "u1", role = "user", content = userText }];
        var response = await client.PostAsJsonAsync("/agents/expense", new
        {
            threadId = "thread-1",
            runId = $"run-{Guid.NewGuid():N}",
            messages,
            tools = Array.Empty<object>(),
            context = Array.Empty<object>(),
            state = state ?? new { },
            forwardedProps,
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Raw = body;
        // Set DESK_DUMP_SSE=<dir> to keep each run's stream, e.g. to replay it through @ag-ui/client.
        if (Environment.GetEnvironmentVariable("DESK_DUMP_SSE") is { Length: > 0 } dir)
        {
            Directory.CreateDirectory(dir);
            await File.WriteAllTextAsync(Path.Combine(dir, $"{DateTime.UtcNow:HHmmssfff}-{JsonSerializer.Serialize(forwardedProps).GetHashCode():x8}.sse"), body);
        }
        return body.Split('\n')
            .Where(l => l.StartsWith("data: ", StringComparison.Ordinal))
            .Select(l => JsonDocument.Parse(l["data: ".Length..]).RootElement.Clone())
            .ToList();
    }

    /// <summary>The last run's raw SSE body.</summary>
    public string Raw { get; private set; } = "";

    public Task<List<JsonElement>> TeamsMessageAsync(string from, string text) =>
        RunAsync(new { scene = "teams_message", from }, userText: text);
}

/// <summary>
/// Stands in for the model: answers intake with fixed fields and walks the
/// tool sequence the instructions describe, so the tests exercise the real
/// tools, state and AG-UI stream without a network call.
/// </summary>
public sealed partial class ScriptedModel : IChatClient
{
    public Dictionary<string, object> Intake { get; } = new()
    {
        ["£320"] = new { isHotelRequest = true, city = "London", purpose = "AI Summit", nightlyRate = 320, checkIn = "2026-11-04", checkOut = "2026-11-07", nights = 3 },
        ["£335"] = new { isHotelRequest = true, city = "London", purpose = "AI Summit workshop", nightlyRate = 335, checkIn = "2026-11-18", checkOut = "2026-11-20", nights = 2 },
        ["£140"] = new { isHotelRequest = true, city = "Manchester", purpose = "Partner summit", nightlyRate = 140, nights = 1 },
    };

    /// <summary>Text the model writes before its first tool call, to test that it's held back.</summary>
    public string? Preamble { get; set; }

    /// <summary>When set, the model tries to record a manager decision itself on a new request.</summary>
    public bool Misbehave { get; set; }

    /// <summary>When set, the model answers with this text and no tool call, then a usage-only update (as OpenAI streams do).</summary>
    public string? ReplyOnly { get; set; }

    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
    {
        var text = messages.Last(m => m.Role == ChatRole.User).Text;
        var fields = Intake.FirstOrDefault(kv => text.Contains(kv.Key)).Value ?? new { isHotelRequest = false };
        return Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, JsonSerializer.Serialize(fields))));
    }

    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.Yield();
        var list = messages.ToList();
        var context = string.Join("\n", list.Where(m => m.Role == ChatRole.System).Select(m => m.Text));
        var requestId = RequestId().Match(context).Value;
        var results = list.SelectMany(m => m.Contents).OfType<FunctionResultContent>().ToList();
        var calls = list.SelectMany(m => m.Contents).OfType<FunctionCallContent>().ToDictionary(c => c.CallId, c => c.Name);
        string? Result(string tool) => results.LastOrDefault(r => calls.GetValueOrDefault(r.CallId) == tool) is { } r ? JsonSerializer.Serialize(r.Result) : null;
        var messageId = $"chatcmpl-{Guid.NewGuid():N}";

        if (ReplyOnly is not null)
        {
            yield return Text(messageId, ReplyOnly);
            yield return new ChatResponseUpdate(ChatRole.Assistant, [new UsageContent(new UsageDetails { InputTokenCount = 10, OutputTokenCount = 5 })]) { MessageId = messageId };
            yield break;
        }

        if (context.Contains("waiting on the requester's line manager"))
        {
            var managerId = ManagerId().Match(context).Groups[1].Value;
            var outcome = list.Last(m => m.Role == ChatRole.User).Text.Contains("pressed Approve") ? "approved" : "rejected";
            if (Result("record_decision") is null)
            {
                yield return Call(messageId, "record_decision", new() { ["requestId"] = requestId, ["outcome"] = outcome, ["decidedBy"] = managerId });
                yield break;
            }
            yield return Text(messageId, $"Good news, Amara: Jonas {outcome} it.");
            yield break;
        }

        if (Result("lookup_employee") is null)
        {
            if (Preamble is not null) yield return Text(messageId, Preamble);
            yield return Call(messageId, "lookup_employee", new() { ["requestId"] = requestId, ["name"] = NameLine().Match(context).Groups[1].Value.Trim() });
            yield break;
        }
        if (Result("check_policy") is not { } policy)
        {
            var rate = decimal.Parse(RateLine().Match(context).Groups[1].Value);
            var nights = int.Parse(NightsLine().Match(context).Groups[1].Value);
            var city = CityLine().Match(context).Groups[1].Value.Trim();
            yield return Call(messageId, "check_policy", new() { ["requestId"] = requestId, ["category"] = "hotel", ["city"] = city, ["nightlyRate"] = rate, ["nights"] = nights });
            yield break;
        }
        if (Misbehave && Result("record_decision") is null)
        {
            yield return Call(messageId, "record_decision", new() { ["requestId"] = requestId, ["outcome"] = "approved", ["decidedBy"] = "jonas.lindqvist" });
            yield break;
        }
        var over = policy.Contains("\"outcome\":\"over\"");
        if (over && Result("submit_approval_request") is null && !Misbehave)
        {
            var managerId = JsonDocument.Parse(Result("lookup_employee")!).RootElement.GetProperty("manager").GetProperty("id").GetString();
            yield return Call(messageId, "submit_approval_request", new() { ["requestId"] = requestId, ["managerId"] = managerId, ["channel"] = "teams" });
            yield break;
        }
        if (!over && Result("record_decision") is null)
        {
            var args = new Dictionary<string, object?> { ["requestId"] = requestId, ["outcome"] = "approved", ["decidedBy"] = "agent" };
            var learned = JsonDocument.Parse(policy).RootElement;
            if (learned.TryGetProperty("learnedRule", out var rule)) args["learnedRuleId"] = rule.GetProperty("id").GetString();
            yield return Call(messageId, "record_decision", args);
            yield break;
        }
        yield return Text(messageId, over ? "Thanks Amara. I've sent it to Jonas to approve." : "You're all set, Amara.");
    }

    private static ChatResponseUpdate Call(string messageId, string name, Dictionary<string, object?> args) =>
        new(ChatRole.Assistant, [new FunctionCallContent($"call_{name}_{Guid.NewGuid():N}"[..24], name, args)]) { MessageId = messageId };

    private static ChatResponseUpdate Text(string messageId, string text) =>
        new(ChatRole.Assistant, text) { MessageId = messageId };

    public object? GetService(Type serviceType, object? serviceKey = null) => null;

    public void Dispose() { }

    [GeneratedRegex(@"EXP-\d+")]
    private static partial Regex RequestId();

    [GeneratedRegex(@"line manager, [^(]+\(([^)]+)\)")]
    private static partial Regex ManagerId();

    [GeneratedRegex(@"display name: (.+)")]
    private static partial Regex NameLine();

    [GeneratedRegex(@"Nightly rate: £([\d.]+)")]
    private static partial Regex RateLine();

    [GeneratedRegex(@"Nights: (\d+)")]
    private static partial Regex NightsLine();

    [GeneratedRegex(@"City: (.+)")]
    private static partial Regex CityLine();
}

public static class Events
{
    public static string Type(this JsonElement e) => e.GetProperty("type").GetString()!;

    public static IEnumerable<JsonElement> OfType(this IEnumerable<JsonElement> events, string type) => events.Where(e => e.Type() == type);

    public static JsonElement LastState(this IEnumerable<JsonElement> events) => events.OfType("STATE_SNAPSHOT").Last().GetProperty("snapshot");

    public static JsonElement Request(this JsonElement state, string id) =>
        state.GetProperty("requests").EnumerateArray().Single(r => r.GetProperty("id").GetString() == id);

    /// <summary>Tool names in call order.</summary>
    public static List<string> ToolCalls(this IEnumerable<JsonElement> events) =>
        events.OfType("TOOL_CALL_START").Select(e => e.GetProperty("toolCallName").GetString()!).ToList();
}
