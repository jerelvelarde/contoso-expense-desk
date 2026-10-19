namespace ExpenseDesk.Desk;

/// <summary>
/// The hotel rules from seed/expense-policy.md. This is the authoritative
/// check; web/src/agent/policy.ts mirrors it for the scripted agent.
/// </summary>
public static class Policy
{
    private static readonly HashSet<string> UkCities = new(StringComparer.OrdinalIgnoreCase)
    {
        "london", "manchester", "edinburgh", "birmingham", "glasgow", "bristol", "leeds", "liverpool", "cardiff", "belfast",
    };

    /// <summary>A learned rule never raises a cap by more than 50% (seed/expense-policy.md).</summary>
    public const decimal MaxLearnedUplift = 1.5m;

    public sealed record BaseRule(string RuleId, decimal CapPerNight, string Label);

    public static BaseRule BaseRuleFor(string city)
    {
        var c = city.Trim();
        if (c.Equals("london", StringComparison.OrdinalIgnoreCase)) return new("HOTEL-LDN", 250, "London hotel cap");
        if (UkCities.Contains(c)) return new("HOTEL-UK", 150, "UK hotel cap");
        return new("HOTEL-INTL", 200, "International hotel cap");
    }

    public static PolicyResult Evaluate(string category, string city, decimal nightlyRate, IEnumerable<LearnedRule> learnedRules)
    {
        var rule = BaseRuleFor(city);
        if (nightlyRate <= rule.CapPerNight)
        {
            return new PolicyResult { RuleId = rule.RuleId, CapPerNight = rule.CapPerNight, Outcome = "within" };
        }

        var learned = learnedRules.FirstOrDefault(l =>
            string.Equals(l.Category, category, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(l.City.Trim(), city.Trim(), StringComparison.OrdinalIgnoreCase));
        // Enforce the policy ceiling even if a learned skill claims more.
        var learnedCap = learned is null ? 0 : Math.Min(learned.CapPerNight, rule.CapPerNight * MaxLearnedUplift);
        if (learned is not null && nightlyRate <= learnedCap)
        {
            return new PolicyResult
            {
                RuleId = rule.RuleId,
                CapPerNight = rule.CapPerNight,
                Outcome = "within_learned",
                LearnedRule = new LearnedRuleRef { Id = learned.Id, CapPerNight = learnedCap, Title = learned.Title },
            };
        }

        return new PolicyResult
        {
            RuleId = rule.RuleId,
            CapPerNight = rule.CapPerNight,
            Outcome = "over",
            OverBy = nightlyRate - rule.CapPerNight,
        };
    }

    public static ApprovalCardFacts CardFacts(ExpenseRequest r)
    {
        var policy = r.Policy ?? Evaluate(r.Category, r.City, r.NightlyRate, []);
        return new ApprovalCardFacts
        {
            RequesterName = r.Employee?.Name ?? r.Requester.Name,
            City = r.City,
            Purpose = r.Purpose,
            CheckIn = r.CheckIn,
            CheckOut = r.CheckOut,
            Nights = r.Nights,
            NightlyRate = r.NightlyRate,
            Total = r.Total,
            CostCenter = r.CostCenter,
            RuleId = policy.RuleId,
            CapPerNight = policy.CapPerNight,
            OverBy = Math.Max(0, r.NightlyRate - policy.CapPerNight),
        };
    }
}
