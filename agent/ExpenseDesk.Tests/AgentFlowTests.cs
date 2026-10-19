using System.Net.Http.Json;
using System.Text.Json;
using ExpenseDesk.Desk;

namespace ExpenseDesk.Tests;

/// <summary>
/// The AG-UI event stream the dashboard depends on (docs/agent-contract.md,
/// with web/src/agent/scripted-agent.ts as the reference), end to end
/// through the HTTP endpoint.
/// </summary>
public sealed class AgentFlowTests : IDisposable
{
    private const string OverCap = "I need to book a hotel in London for the AI Summit, 4 to 7 Nov, around £320 a night.";
    private readonly DeskHost _host = new();

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task OverCapRequestGoesToTheManager()
    {
        var events = await _host.TeamsMessageAsync("Amara Nwosu", OverCap);

        Assert.Equal("RUN_STARTED", events[0].Type());
        Assert.Equal("RUN_FINISHED", events[^1].Type());
        Assert.Equal(["lookup_employee", "check_policy", "submit_approval_request"], events.ToolCalls());
        // @ag-ui/client rejects explicit nulls (rawEvent, the model update AGUI.Server attaches, is opaque).
        Assert.All(events, e => Assert.Empty(Nulls(e)));

        // The new request is published before the first tool call, with status "received".
        var firstCall = events.FindIndex(e => e.Type() == "TOOL_CALL_START");
        var opened = events.Take(firstCall).OfType("STATE_SNAPSHOT").Last().GetProperty("snapshot");
        Assert.Equal("EXP-2037", opened.GetProperty("activeRequestId").GetString());
        Assert.Equal("received", opened.Request("EXP-2037").GetProperty("status").GetString());

        // Every call's arguments start with requestId, and state lands before each result.
        foreach (var args in events.OfType("TOOL_CALL_ARGS"))
            Assert.StartsWith("{\"requestId\":\"EXP-2037\"", args.GetProperty("delta").GetString());
        foreach (var i in events.Select((e, i) => (e, i)).Where(x => x.e.Type() == "TOOL_CALL_RESULT").Select(x => x.i))
            Assert.Equal("STATE_SNAPSHOT", events[i - 1].Type());

        var submitResult = events.OfType("TOOL_CALL_RESULT").Last();
        var beforeResult = events[events.IndexOf(submitResult) - 1].GetProperty("snapshot").Request("EXP-2037");
        Assert.Equal("awaiting_manager", beforeResult.GetProperty("status").GetString());

        var request = events.LastState().Request("EXP-2037");
        Assert.Equal("amara.nwosu", request.GetProperty("employeeId").GetString());
        Assert.Equal("jonas.lindqvist", request.GetProperty("managerId").GetString());
        Assert.Equal("CC-410 Field Engineering", request.GetProperty("costCenter").GetString());
        Assert.Equal("over", request.GetProperty("policy").GetProperty("outcome").GetString());
        Assert.Equal(70, request.GetProperty("policy").GetProperty("overBy").GetDecimal());
        var card = request.GetProperty("approval").GetProperty("card");
        Assert.Equal(960, card.GetProperty("total").GetDecimal());
        Assert.Equal(70, card.GetProperty("overBy").GetDecimal());
        Assert.Equal("Amara Nwosu", card.GetProperty("requesterName").GetString());

        var lookup = JsonDocument.Parse(events.OfType("TOOL_CALL_RESULT").First().GetProperty("content").GetString()!).RootElement;
        Assert.Equal("CC-410 Field Engineering", lookup.GetProperty("employee").GetProperty("costCenter").GetString());
        Assert.Equal("Jonas Lindqvist", lookup.GetProperty("manager").GetProperty("name").GetString());

        Assert.Contains("sent it to Jonas", string.Concat(events.OfType("TEXT_MESSAGE_CONTENT").Select(e => e.GetProperty("delta").GetString())));
    }

    private static IEnumerable<string> Nulls(JsonElement e, string path = "") => e.ValueKind switch
    {
        JsonValueKind.Null => [path],
        JsonValueKind.Object => e.EnumerateObject().Where(p => p.Name != "rawEvent").SelectMany(p => Nulls(p.Value, $"{path}.{p.Name}")),
        JsonValueKind.Array => e.EnumerateArray().SelectMany((x, i) => Nulls(x, $"{path}[{i}]")),
        _ => [],
    };

    [Fact]
    public async Task ManagerApprovalIsRecorded()
    {
        await _host.TeamsMessageAsync("Amara Nwosu", OverCap);
        var events = await _host.RunAsync(new { scene = "decision", requestId = "EXP-2037", outcome = "approved" });

        Assert.Equal(["record_decision"], events.ToolCalls());
        var args = JsonDocument.Parse(events.OfType("TOOL_CALL_ARGS").Single().GetProperty("delta").GetString()!).RootElement;
        Assert.Equal("jonas.lindqvist", args.GetProperty("decidedBy").GetString());
        var request = events.LastState().Request("EXP-2037");
        Assert.Equal("approved", request.GetProperty("status").GetString());
        Assert.Equal("jonas.lindqvist", request.GetProperty("decision").GetProperty("by").GetString());
        Assert.Equal("teams", request.GetProperty("decision").GetProperty("channel").GetString());
        Assert.Equal("EXP-2037", events.LastState().GetProperty("activeRequestId").GetString());
    }

    [Fact]
    public async Task TheModelCannotDecideForTheManager()
    {
        _host.Model.Misbehave = true;
        var events = await _host.TeamsMessageAsync("Amara Nwosu", OverCap);

        // The tool rejects it; the dashboard never sees the attempt.
        Assert.DoesNotContain("record_decision", events.ToolCalls());
        Assert.NotEqual("approved", _host.Store.Get("EXP-2037").Status);
        Assert.Null(_host.Store.Get("EXP-2037").Decision);
    }

    [Fact]
    public async Task WithinPolicyIsApprovedByTheAgent()
    {
        var events = await _host.TeamsMessageAsync("Leo Fischer", "Partner summit in Manchester, hotel is £140 for one night.");

        Assert.Equal(["lookup_employee", "check_policy", "record_decision"], events.ToolCalls());
        var request = events.LastState().Request("EXP-2037");
        Assert.Equal("auto_approved", request.GetProperty("status").GetString());
        Assert.Equal("agent", request.GetProperty("decision").GetProperty("by").GetString());
        Assert.False(request.GetProperty("decision").TryGetProperty("learnedRuleId", out _));
    }

    [Fact]
    public async Task LearnedRuleApprovesInsideTheLearnedLimit()
    {
        _host.Store.State.LearnedRules.Add(new LearnedRule
        {
            Id = "london-hotel-cap",
            Title = "London hotels are approved up to £350 a night",
            City = "London",
            CapPerNight = 350,
            LearnedAt = DeskJson.Now(),
            Evidence = new LearnedEvidence { Approvals = 3 },
        });

        var events = await _host.TeamsMessageAsync("Amara Nwosu", "Booking London again for the AI Summit follow-up workshop, 18 to 20 Nov, £335 a night.");

        var policy = JsonDocument.Parse(events.OfType("TOOL_CALL_RESULT").ElementAt(1).GetProperty("content").GetString()!).RootElement;
        Assert.Equal("within_learned", policy.GetProperty("outcome").GetString());
        Assert.Equal("london-hotel-cap", policy.GetProperty("learnedRule").GetProperty("id").GetString());
        var request = events.LastState().Request("EXP-2037");
        Assert.Equal("auto_approved", request.GetProperty("status").GetString());
        Assert.Equal("london-hotel-cap", request.GetProperty("decision").GetProperty("learnedRuleId").GetString());
        Assert.Single(events.LastState().GetProperty("learnedRules").EnumerateArray());
    }

    [Fact]
    public async Task RateEditRechecksPolicyAndRefreshesTheCard()
    {
        var first = await _host.TeamsMessageAsync("Amara Nwosu", OverCap);
        var state = JsonSerializer.Deserialize<ExpenseDeskState>(first.LastState(), DeskJson.Options)!;
        var edited = state.Requests.Single(r => r.Id == "EXP-2037");
        edited.NightlyRate = 300;
        edited.Edits = [new FieldEdit { Field = "nightlyRate", From = JsonSerializer.SerializeToElement(320), To = JsonSerializer.SerializeToElement(300), By = "priya.raman", At = DeskJson.Now() }];

        var events = await _host.RunAsync(
            new { scene = "fields_edited", requestId = "EXP-2037", fields = new[] { "nightlyRate" } },
            JsonSerializer.SerializeToElement(state, DeskJson.Options));

        Assert.Equal(["check_policy"], events.ToolCalls());
        var policy = JsonDocument.Parse(events.OfType("TOOL_CALL_RESULT").Single().GetProperty("content").GetString()!).RootElement;
        Assert.Equal(50, policy.GetProperty("overBy").GetDecimal());
        var approval = events.LastState().Request("EXP-2037").GetProperty("approval");
        Assert.Equal(900, approval.GetProperty("card").GetProperty("total").GetDecimal());
        Assert.Equal(["nightlyRate", "total", "overBy"], approval.GetProperty("changed").EnumerateArray().Select(c => c.GetString()));
        Assert.True(approval.TryGetProperty("updatedAt", out _));
        Assert.Single(events.LastState().Request("EXP-2037").GetProperty("edits").EnumerateArray());
        Assert.Empty(events.OfType("TEXT_MESSAGE_START"));
    }

    [Fact]
    public async Task PurposeEditRefreshesTheCardWithoutAPolicyCheck()
    {
        var first = await _host.TeamsMessageAsync("Amara Nwosu", OverCap);
        var state = JsonSerializer.Deserialize<ExpenseDeskState>(first.LastState(), DeskJson.Options)!;
        state.Requests.Single(r => r.Id == "EXP-2037").Purpose = "AI Summit keynote";

        var events = await _host.RunAsync(
            new { scene = "fields_edited", requestId = "EXP-2037", fields = new[] { "purpose" } },
            JsonSerializer.SerializeToElement(state, DeskJson.Options));

        Assert.Empty(events.ToolCalls());
        var approval = events.LastState().Request("EXP-2037").GetProperty("approval");
        Assert.Equal("AI Summit keynote", approval.GetProperty("card").GetProperty("purpose").GetString());
        Assert.Equal(["purpose"], approval.GetProperty("changed").EnumerateArray().Select(c => c.GetString()));
    }

    [Fact]
    public async Task EditsToADecidedRequestAreIgnored()
    {
        var state = JsonSerializer.Deserialize<ExpenseDeskState>(_host.Store.Snapshot(), DeskJson.Options)!;
        state.Requests.Single(r => r.Id == "EXP-2036").NightlyRate = 1;

        var events = await _host.RunAsync(
            new { scene = "fields_edited", requestId = "EXP-2036", fields = new[] { "nightlyRate" } },
            JsonSerializer.SerializeToElement(state, DeskJson.Options));

        Assert.Empty(events.ToolCalls());
        Assert.Equal(280, _host.Store.Get("EXP-2036").NightlyRate);
    }

    [Fact]
    public async Task AnEditTravelsWithItsRunEvenIfTheStateWasOverwritten()
    {
        var first = await _host.TeamsMessageAsync("Amara Nwosu", OverCap);
        var stale = first.LastState();   // the dashboard's copy after a snapshot wiped its optimistic edit
        var edit = new { field = "nightlyRate", from = 320, to = 290, by = "priya.raman", at = DeskJson.Now(), afterMessageId = "m1" };

        var events = await _host.RunAsync(
            new { scene = "fields_edited", requestId = "EXP-2037", fields = new[] { "nightlyRate" }, values = new { nightlyRate = 290 }, edits = new[] { edit } },
            stale);

        Assert.Equal(["check_policy"], events.ToolCalls());
        var request = events.LastState().Request("EXP-2037");
        Assert.Equal(290, request.GetProperty("nightlyRate").GetDecimal());
        Assert.Equal(40, request.GetProperty("policy").GetProperty("overBy").GetDecimal());
        Assert.Equal("m1", request.GetProperty("edits")[0].GetProperty("afterMessageId").GetString());
        // No snapshot of the pre-edit desk first: it would flicker the dashboard's edit back.
        Assert.Equal(290, events.OfType("STATE_SNAPSHOT").First().GetProperty("snapshot").Request("EXP-2037").GetProperty("nightlyRate").GetDecimal());
    }

    [Fact]
    public async Task ARejectedEditKeepsNoEditRecord()
    {
        await _host.TeamsMessageAsync("Amara Nwosu", OverCap);
        var edit = new { field = "nightlyRate", from = 320, to = 0, by = "priya.raman", at = DeskJson.Now() };

        var events = await _host.RunAsync(new { scene = "fields_edited", requestId = "EXP-2037", fields = new[] { "nightlyRate" }, values = new { nightlyRate = 0 }, edits = new[] { edit } });

        Assert.Empty(events.ToolCalls());
        Assert.Equal(320, _host.Store.Get("EXP-2037").NightlyRate);
        Assert.Null(_host.Store.Get("EXP-2037").Edits);
    }

    [Fact]
    public async Task AReplyWithoutToolCallsIsKept()
    {
        _host.Model.ReplyOnly = "I can't book that one, Amara.";
        var events = await _host.TeamsMessageAsync("Amara Nwosu", OverCap);

        Assert.Empty(events.ToolCalls());
        Assert.Equal("I can't book that one, Amara.", string.Concat(events.OfType("TEXT_MESSAGE_CONTENT").Select(e => e.GetProperty("delta").GetString())));
    }

    [Fact]
    public async Task TheCardVerbCountsAsTheOutcome()
    {
        await _host.TeamsMessageAsync("Amara Nwosu", OverCap);
        var events = await _host.RunAsync(new { scene = "decision", requestId = "EXP-2037", outcome = "approve", note = "Fine for the summit." });

        Assert.Equal(["record_decision"], events.ToolCalls());
        var decision = events.LastState().Request("EXP-2037").GetProperty("decision");
        Assert.Equal("approved", decision.GetProperty("outcome").GetString());
        Assert.Equal("Fine for the summit.", decision.GetProperty("note").GetString());
    }

    [Fact]
    public async Task PreambleTextIsHeldBack()
    {
        _host.Model.Preamble = "Let me check that for you.";
        var events = await _host.TeamsMessageAsync("Amara Nwosu", OverCap);

        var text = string.Concat(events.OfType("TEXT_MESSAGE_CONTENT").Select(e => e.GetProperty("delta").GetString()));
        Assert.DoesNotContain("Let me check", text);
        Assert.Contains("sent it to Jonas", text);
    }

    [Fact]
    public async Task HealthReportsWhatIsConfigured()
    {
        var health = await _host.CreateClient().GetFromJsonAsync<JsonElement>("/healthz");

        Assert.Equal("ok", health.GetProperty("status").GetString());
        Assert.False(health.GetProperty("runtime").GetBoolean());
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await _host.CreateClient().GetAsync("/copilotkit/info")).StatusCode);
    }

    [Fact]
    public async Task SyncPublishesTheSeededDesk()
    {
        var events = await _host.RunAsync(new { scene = "sync" });

        var state = events.LastState();
        Assert.Equal(["RUN_STARTED", "STATE_SNAPSHOT", "RUN_FINISHED"], events.Select(e => e.Type()));
        Assert.Contains(state.GetProperty("requests").EnumerateArray(), r => r.GetProperty("id").GetString() == "EXP-2036");
        Assert.Equal("Priya Raman", state.GetProperty("people").GetProperty("priya.raman").GetProperty("name").GetString());
    }

    [Fact]
    public async Task ResetGoesBackToTheSeed()
    {
        await _host.TeamsMessageAsync("Amara Nwosu", OverCap);
        var events = await _host.RunAsync(new { scene = "reset" });

        Assert.DoesNotContain(events.LastState().GetProperty("requests").EnumerateArray(), r => r.GetProperty("id").GetString() == "EXP-2037");
    }

    [Fact]
    public async Task ANonHotelMessageGetsAPromptAndNoRequest()
    {
        var events = await _host.TeamsMessageAsync("Amara Nwosu", "hello?");

        Assert.Empty(events.ToolCalls());
        Assert.Contains("hotel", string.Concat(events.OfType("TEXT_MESSAGE_CONTENT").Select(e => e.GetProperty("delta").GetString())));
        Assert.DoesNotContain(events.LastState().GetProperty("requests").EnumerateArray(), r => r.GetProperty("id").GetString() == "EXP-2037");
    }
}
