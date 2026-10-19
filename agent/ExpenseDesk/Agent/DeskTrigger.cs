using System.Text.Json;
using Microsoft.Extensions.AI;

namespace ExpenseDesk.Agent;

/// <summary>
/// What started a run, read from AG-UI <c>forwardedProps.scene</c>. A Teams
/// message is the employee's text (the run's last user message) plus their
/// display name in <c>from</c>; a decision is the manager's press on the
/// approval card. Without a scene, a user message counts as a Teams message.
/// </summary>
public abstract record DeskTrigger
{
    public sealed record TeamsMessage(string From, string Text) : DeskTrigger;

    public sealed record Decision(string RequestId, string Outcome, string? Note, string? DecidedBy) : DeskTrigger;

    /// <param name="Values">The edited values (<c>forwardedProps.values</c>), so a snapshot sent while the edit waited can't erase it.</param>
    /// <param name="Edits">The dashboard's FieldEdit records for this edit (<c>forwardedProps.edits</c>).</param>
    public sealed record FieldsEdited(string RequestId, IReadOnlyList<string> Fields, JsonElement? Values = null, JsonElement? Edits = null) : DeskTrigger;

    /// <summary>Re-read the learned skills and publish them.</summary>
    public sealed record Learn : DeskTrigger;

    /// <summary>Publish the desk without doing anything else (the dashboard calls this on load).</summary>
    public sealed record Sync : DeskTrigger;

    /// <summary>Put the desk back to the seed data.</summary>
    public sealed record Reset : DeskTrigger;

    public static DeskTrigger Parse(JsonElement? forwardedProps, IEnumerable<ChatMessage> messages)
    {
        var props = forwardedProps is { ValueKind: JsonValueKind.Object } p ? p : default;
        string? Str(string name) =>
            props.ValueKind == JsonValueKind.Object && props.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString()
                : null;
        var lastUser = messages.LastOrDefault(m => m.Role == ChatRole.User)?.Text;

        switch (Str("scene"))
        {
            case "decision":
                // Accept the card's verbs too, so the Teams listener can forward Action.Execute as is.
                var outcome = Required(Str("outcome"), "outcome").Trim().ToLowerInvariant() switch
                {
                    "approved" or "approve" => "approved",
                    "rejected" or "reject" => "rejected",
                    var other => throw new ArgumentException($"forwardedProps.outcome must be \"approved\" or \"rejected\", not \"{other}\"."),
                };
                return new Decision(Required(Str("requestId"), "requestId"), outcome, Str("note"), Str("decidedBy"));
            case "fields_edited":
                var fields = props.TryGetProperty("fields", out var f) && f.ValueKind == JsonValueKind.Array
                    ? f.EnumerateArray().Select(x => x.GetString()).OfType<string>().ToList()
                    : [];
                JsonElement? Obj(string name) =>
                    props.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.Object or JsonValueKind.Array ? v.Clone() : null;
                return new FieldsEdited(Required(Str("requestId"), "requestId"), fields, Obj("values"), Obj("edits"));
            case "learn":
                return new Learn();
            case "sync":
                return new Sync();
            case "reset":
                return new Reset();
            case "teams_message" or null:
                var text = Str("text") ?? lastUser;
                if (string.IsNullOrWhiteSpace(text)) return new Sync();
                return new TeamsMessage(Str("from") ?? "Unknown sender", text);
            case var other:
                throw new ArgumentException($"Unknown scene \"{other}\".");
        }
    }

    private static string Required(string? value, string name) =>
        string.IsNullOrWhiteSpace(value) ? throw new ArgumentException($"forwardedProps.{name} is required for this scene.") : value;
}
