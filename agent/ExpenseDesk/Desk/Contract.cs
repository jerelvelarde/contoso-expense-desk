using System.Text.Json;
using System.Text.Json.Serialization;

namespace ExpenseDesk.Desk;

/// <summary>
/// The shared state the dashboard renders. Mirrors web/src/agent/contract.ts
/// field for field; names are camelCase on the wire and absent fields are
/// omitted, so the dashboard sees exactly what the scripted agent publishes.
/// </summary>
public sealed class ExpenseDeskState
{
    public List<ExpenseRequest> Requests { get; set; } = [];
    public List<LearnedRule> LearnedRules { get; set; } = [];
    public Dictionary<string, PersonRef> People { get; set; } = [];
    public string? ActiveRequestId { get; set; }
}

public static class RequestStatus
{
    public const string Received = "received";
    public const string Checking = "checking";
    public const string AwaitingManager = "awaiting_manager";
    public const string Approved = "approved";
    public const string Rejected = "rejected";
    public const string AutoApproved = "auto_approved";

    public static bool IsOpen(string status) => status is Received or Checking or AwaitingManager;
}

public sealed class PersonRef
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Title { get; set; }
    public string? Department { get; set; }
}

public sealed class PolicyResult
{
    public required string RuleId { get; set; }
    public decimal CapPerNight { get; set; }
    /// <summary>"within", "over" or "within_learned".</summary>
    public required string Outcome { get; set; }
    public decimal? OverBy { get; set; }
    public LearnedRuleRef? LearnedRule { get; set; }
}

public sealed class LearnedRuleRef
{
    public required string Id { get; set; }
    public decimal CapPerNight { get; set; }
    public required string Title { get; set; }
}

public sealed class Decision
{
    /// <summary>"approved" or "rejected".</summary>
    public required string Outcome { get; set; }
    /// <summary>Employee id of the manager, or "agent".</summary>
    public required string By { get; set; }
    public required string At { get; set; }
    /// <summary>"teams" or "agent".</summary>
    public required string Channel { get; set; }
    public string? Note { get; set; }
    public string? LearnedRuleId { get; set; }
}

public sealed class RequestSource
{
    public string Channel { get; set; } = "teams";
    public required string Text { get; set; }
}

public sealed class Requester
{
    public required string Name { get; set; }
}

public sealed class ExpenseRequest
{
    public required string Id { get; set; }
    public required string CreatedAt { get; set; }
    public required RequestSource Source { get; set; }
    public required Requester Requester { get; set; }
    public string? EmployeeId { get; set; }
    public string? ManagerId { get; set; }
    public PersonRef? Employee { get; set; }
    public PersonRef? Manager { get; set; }
    public string Category { get; set; } = "hotel";
    public required string City { get; set; }
    public required string Purpose { get; set; }
    public decimal NightlyRate { get; set; }
    public int Nights { get; set; }
    public string? CheckIn { get; set; }
    public string? CheckOut { get; set; }
    public string Currency { get; set; } = "GBP";
    public string? CostCenter { get; set; }
    public required string Status { get; set; }
    public PolicyResult? Policy { get; set; }
    public Approval? Approval { get; set; }
    public Decision? Decision { get; set; }
    public List<FieldEdit>? Edits { get; set; }

    [JsonIgnore]
    public decimal Total => NightlyRate * Nights;
}

public sealed class Approval
{
    public required string ManagerId { get; set; }
    public required string SentAt { get; set; }
    public string Channel { get; set; } = "teams";
    public string? UpdatedAt { get; set; }
    public required ApprovalCardFacts Card { get; set; }
    public List<string>? Changed { get; set; }
}

/// <summary>Exactly what the agent put on the manager's Adaptive Card.</summary>
public sealed record ApprovalCardFacts
{
    public required string RequesterName { get; init; }
    public required string City { get; init; }
    public required string Purpose { get; init; }
    public string? CheckIn { get; init; }
    public string? CheckOut { get; init; }
    public int Nights { get; init; }
    public decimal NightlyRate { get; init; }
    public decimal Total { get; init; }
    public string? CostCenter { get; init; }
    public required string RuleId { get; init; }
    public decimal CapPerNight { get; init; }
    public decimal OverBy { get; init; }

    /// <summary>The camelCase names of the facts that differ from <paramref name="previous"/>.</summary>
    public List<string> ChangedFrom(ApprovalCardFacts previous)
    {
        var now = JsonSerializer.SerializeToElement(this, DeskJson.Options);
        var before = JsonSerializer.SerializeToElement(previous, DeskJson.Options);
        var changed = new List<string>();
        foreach (var prop in now.EnumerateObject())
        {
            var had = before.TryGetProperty(prop.Name, out var old);
            if (!had || old.GetRawText() != prop.Value.GetRawText()) changed.Add(prop.Name);
        }
        foreach (var prop in before.EnumerateObject())
        {
            if (!now.TryGetProperty(prop.Name, out _)) changed.Add(prop.Name);
        }
        return changed;
    }
}

public sealed class FieldEdit
{
    public required string Field { get; set; }
    public JsonElement From { get; set; }
    public JsonElement To { get; set; }
    public required string By { get; set; }
    public required string At { get; set; }
    public string? AfterMessageId { get; set; }
}

public sealed class LearnedRule
{
    public required string Id { get; set; }
    public required string Title { get; set; }
    public string Category { get; set; } = "hotel";
    public required string City { get; set; }
    public decimal CapPerNight { get; set; }
    public required string LearnedAt { get; set; }
    public string Source { get; set; } = "automatic_learning";
    public required LearnedEvidence Evidence { get; set; }
}

public sealed class LearnedEvidence
{
    public int Approvals { get; set; }
    public List<string> RequestIds { get; set; } = [];
    public List<string> ApproverIds { get; set; } = [];
    public List<decimal> Rates { get; set; } = [];
}

public static class EditableFields
{
    public static readonly string[] All = ["city", "purpose", "nightlyRate", "checkIn", "checkOut", "costCenter"];

    /// <summary>Fields that change what the policy check sees (matches the scripted agent).</summary>
    public static readonly string[] Pricing = ["nightlyRate", "city", "checkIn", "checkOut"];
}

public static class DeskJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
}
