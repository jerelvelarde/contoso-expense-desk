using System.Text.Json;

namespace ExpenseDesk.Desk;

public sealed class Employee
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Title { get; init; }
    public required string Department { get; init; }
    public string? Office { get; init; }
    public required string CostCenter { get; init; }
    public string? ManagerId { get; init; }
    public string? TeamsRole { get; init; }

    public PersonRef Ref() => new() { Id = Id, Name = Name, Title = Title, Department = Department };
}

public sealed class FinanceUser
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Title { get; init; }
}

/// <summary>
/// The seed data in seed/, shared with the dashboard: the employee directory
/// (people.json) and past requests (requests.json).
/// </summary>
public sealed class SeedData
{
    private sealed record PeopleFile(List<Employee> Employees, FinanceUser Finance);

    private sealed record RequestsFile(List<ExpenseRequest> Requests);

    private readonly string _requestsJson;

    public IReadOnlyDictionary<string, Employee> Directory { get; }
    public FinanceUser Finance { get; }
    public string PolicyMarkdown { get; }

    private SeedData(PeopleFile people, string requestsJson, string policyMarkdown)
    {
        Directory = people.Employees.ToDictionary(e => e.Id);
        Finance = people.Finance;
        _requestsJson = requestsJson;
        PolicyMarkdown = policyMarkdown;
    }

    public static SeedData Load(string directory)
    {
        string Read(string name)
        {
            var path = Path.Combine(directory, name);
            if (!File.Exists(path)) throw new FileNotFoundException($"Seed file not found: {path}. Set Desk:SeedDirectory to the repo's seed/ folder.");
            return File.ReadAllText(path);
        }

        var people = JsonSerializer.Deserialize<PeopleFile>(Read("people.json"), DeskJson.Options)
            ?? throw new InvalidDataException("people.json is empty");
        return new SeedData(people, Read("requests.json"), Read("expense-policy.md"));
    }

    public Employee? FindByName(string name) =>
        Directory.Values.FirstOrDefault(e => string.Equals(e.Name.Trim(), name.Trim(), StringComparison.OrdinalIgnoreCase));

    public PersonRef? Person(string? id) => id is not null && Directory.TryGetValue(id, out var e) ? e.Ref() : null;

    /// <summary>The seeded history with people resolved, as the dashboard's seedDeskState() builds it.</summary>
    public ExpenseDeskState InitialState()
    {
        var requests = JsonSerializer.Deserialize<RequestsFile>(_requestsJson, DeskJson.Options)?.Requests ?? [];
        foreach (var r in requests)
        {
            r.Employee = Person(r.EmployeeId);
            r.Manager = Person(r.ManagerId);
        }
        var people = Directory.Values.ToDictionary(e => e.Id, e => e.Ref());
        people[Finance.Id] = new PersonRef { Id = Finance.Id, Name = Finance.Name, Title = Finance.Title, Department = "Finance" };
        return new ExpenseDeskState { Requests = requests, People = people };
    }
}
