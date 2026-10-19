using ExpenseDesk.Desk;

namespace ExpenseDesk.Tests;

public sealed class PolicyTests
{
    private static readonly LearnedRule London350 = new()
    {
        Id = "london-hotel-cap",
        Title = "London hotels are approved up to £350 a night",
        City = "London",
        CapPerNight = 350,
        LearnedAt = "2026-10-18T00:00:00.000Z",
        Evidence = new LearnedEvidence(),
    };

    [Theory]
    [InlineData("London", 250, "HOTEL-LDN", "within")]
    [InlineData("London", 320, "HOTEL-LDN", "over")]
    [InlineData("Manchester", 140, "HOTEL-UK", "within")]
    [InlineData("Paris", 210, "HOTEL-INTL", "over")]
    public void AppliesTheWrittenCaps(string city, decimal rate, string ruleId, string outcome)
    {
        var result = Policy.Evaluate("hotel", city, rate, []);
        Assert.Equal(ruleId, result.RuleId);
        Assert.Equal(outcome, result.Outcome);
    }

    [Fact]
    public void ALearnedRuleCoversRatesUpToItsCap()
    {
        Assert.Equal("within_learned", Policy.Evaluate("hotel", "london", 335, [London350]).Outcome);
        var over = Policy.Evaluate("hotel", "London", 360, [London350]);
        Assert.Equal("over", over.Outcome);
        Assert.Equal(110, over.OverBy);
        Assert.Equal("over", Policy.Evaluate("hotel", "Manchester", 200, [London350]).Outcome);
    }

    [Fact]
    public void CardChangesListTheFactsThatMoved()
    {
        var before = new ApprovalCardFacts { RequesterName = "A", City = "London", Purpose = "x", Nights = 3, NightlyRate = 320, Total = 960, RuleId = "HOTEL-LDN", CapPerNight = 250, OverBy = 70 };
        var after = before with { NightlyRate = 300, Total = 900, OverBy = 50 };
        Assert.Equal(["nightlyRate", "total", "overBy"], after.ChangedFrom(before));
    }
}
