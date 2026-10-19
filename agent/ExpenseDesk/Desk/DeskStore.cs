using System.Text.Json;

namespace ExpenseDesk.Desk;

/// <summary>
/// The agent's authoritative copy of <see cref="ExpenseDeskState"/>. Runs that
/// start in Teams carry no browser state, so the agent keeps the desk itself
/// and only accepts Finance's field edits from the dashboard. In memory,
/// seeded from seed/; a restart goes back to the seed.
/// </summary>
public sealed class DeskStore(SeedData seed)
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public SeedData Seed { get; } = seed;

    /// <summary>Only read or change this while holding <see cref="LockAsync"/>.</summary>
    public ExpenseDeskState State { get; private set; } = seed.InitialState();

    /// <summary>One run at a time, so tool calls and edits never interleave.</summary>
    public async Task<IDisposable> LockAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        return new Releaser(_gate);
    }

    public JsonElement Snapshot() => JsonSerializer.SerializeToElement(State, DeskJson.Options);

    public void Reset()
    {
        var learned = State.LearnedRules;
        State = Seed.InitialState();
        State.LearnedRules = learned;
    }

    public ExpenseRequest? Find(string? id) => id is null ? null : State.Requests.FirstOrDefault(r => r.Id == id);

    public ExpenseRequest Get(string id) => Find(id) ?? throw new DeskException($"There is no request {id}.");

    public string NextRequestId()
    {
        var max = State.Requests
            .Select(r => int.TryParse(new string(r.Id.Where(char.IsDigit).ToArray()), out var n) ? n : 0)
            .DefaultIfEmpty(0)
            .Max();
        return $"EXP-{Math.Max(2036, max) + 1}";
    }

    public ExpenseRequest Open(ExpenseRequest request)
    {
        State.Requests.Insert(0, request);
        State.ActiveRequestId = request.Id;
        return request;
    }

    /// <summary>
    /// Applies Finance's edits from the dashboard. Values come from the run's
    /// <c>forwardedProps.values</c> (falling back to the dashboard's copy of the
    /// request in state); only the editable fields named in the trigger are
    /// taken, and only while the request is open. Each applied change gets its
    /// FieldEdit record so the timeline can place it. Returns the fields that
    /// really changed.
    /// </summary>
    public IReadOnlyList<string> ApplyFinanceEdits(string requestId, Agent.DeskTrigger.FieldsEdited edited, JsonElement? clientState)
    {
        var request = Get(requestId);
        if (!RequestStatus.IsOpen(request.Status)) return [];
        var source = edited.Values is { ValueKind: JsonValueKind.Object } values ? values : ClientCopy(requestId, clientState);
        if (source.ValueKind != JsonValueKind.Object) return [];

        var changed = new List<string>();
        foreach (var field in edited.Fields.Distinct())
        {
            if (!EditableFields.All.Contains(field) || !source.TryGetProperty(field, out var value)) continue;
            if (Apply(request, field, value)) changed.Add(field);
        }
        if (changed.Count == 0) return changed;

        var records = edited.Edits is { ValueKind: JsonValueKind.Array } e
            ? e.Deserialize<List<FieldEdit>>(DeskJson.Options) ?? []
            : ClientCopy(requestId, clientState) is { ValueKind: JsonValueKind.Object } copy && copy.TryGetProperty("edits", out var trail)
                ? (trail.Deserialize<List<FieldEdit>>(DeskJson.Options) ?? []).TakeLast(changed.Count).ToList()
                : [];
        request.Edits = [.. request.Edits ?? [], .. records.Where(r => changed.Contains(r.Field))];
        return changed;
    }

    private static bool Apply(ExpenseRequest request, string field, JsonElement value)
    {
        string? Text() => value.ValueKind == JsonValueKind.String && value.GetString() is { } t && t.Trim().Length > 0 ? t.Trim() : null;
        switch (field)
        {
            case "city" when Text() is { } city && city != request.City:
                request.City = city;
                return true;
            case "purpose" when Text() is { } purpose && purpose != request.Purpose:
                request.Purpose = purpose;
                return true;
            case "costCenter" when Text() is { } cc && cc != request.CostCenter:
                request.CostCenter = cc;
                return true;
            case "nightlyRate" when value.ValueKind == JsonValueKind.Number && value.GetDecimal() is > 0 and var rate && rate != request.NightlyRate:
                request.NightlyRate = rate;
                return true;
            case "checkIn" or "checkOut" when Text() is { } date && DateOnly.TryParse(date, out _):
                var checkIn = field == "checkIn" ? date : request.CheckIn;
                var checkOut = field == "checkOut" ? date : request.CheckOut;
                if ((field == "checkIn" ? request.CheckIn : request.CheckOut) == date) return false;
                // Reject dates that would leave no nights rather than store an impossible stay.
                if (checkIn is not null && checkOut is not null && NightsBetween(checkIn, checkOut) is null) return false;
                request.CheckIn = checkIn;
                request.CheckOut = checkOut;
                request.Nights = NightsBetween(checkIn, checkOut) ?? request.Nights;
                return true;
            default:
                return false;
        }
    }

    private static JsonElement ClientCopy(string requestId, JsonElement? clientState) =>
        clientState is { ValueKind: JsonValueKind.Object } s && s.TryGetProperty("requests", out var list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray().FirstOrDefault(r => r.TryGetProperty("id", out var id) && id.GetString() == requestId)
            : default;

    public static int? NightsBetween(string? checkIn, string? checkOut)
    {
        if (!DateOnly.TryParse(checkIn, out var start) || !DateOnly.TryParse(checkOut, out var end)) return null;
        var nights = end.DayNumber - start.DayNumber;
        return nights > 0 ? nights : null;
    }

    private sealed class Releaser(SemaphoreSlim gate) : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0) gate.Release();
        }
    }
}

/// <summary>A rule the agent broke; the message goes back to the model as the tool result.</summary>
public sealed class DeskException(string message) : Exception(message);
