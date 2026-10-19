using System.IO.Compression;
using System.Text;
using ExpenseDesk.Desk;
using ExpenseDesk.Learning;

namespace ExpenseDesk.Tests;

public sealed class LearnedSkillsTests
{
    [Theory]
    [InlineData("london-hotels", "Use when approving London hotel stays.", "Managers consistently approve London hotels up to £350 a night.", "London", 350)]
    [InlineData("hotel-cap", "Hotel approvals", "city: London\ncapPerNight: 340\n", "London", 340)]
    [InlineData("ldn", "London hotel pattern", "Jonas has approved London hotels at most £340 a night.\nManchester is unchanged.", "London", 340)]
    public void ReadsCityAndCap(string name, string description, string markdown, string city, decimal cap)
    {
        Assert.Equal((city, cap), LearnedSkills.Interpret(new(name, description, markdown)));
    }

    [Theory]
    [InlineData("refund-policy", "Use when handling refunds.", "Refunds are available for 30 days.")]
    [InlineData("london-meals", "London dinners", "Approve dinners in London up to £80.")]
    [InlineData("london-hotels", "London hotels", "London hotels at or under £250 are fine.")]
    [InlineData("ldn", "London hotel pattern", "Jonas approved £280 and £350 against a £250 cap.")]
    [InlineData("partner-rate", "London hotels", "Jonas rejected a £320 London hotel; use the partner rate.")]
    [InlineData("rejections", "Hotel rejections", "Managers rejected London hotels approved up to £420 by mistake.")]
    [InlineData("two-cities", "UK hotels", "Managers approve hotels in London and Manchester up to £300.")]
    public void IgnoresSkillsThatAreNotHotelCapRaises(string name, string description, string markdown)
    {
        Assert.Null(LearnedSkills.Interpret(new(name, description, markdown)));
    }

    [Fact]
    public void CapsTheRuleAtFiftyPercentOverPolicy()
    {
        var rules = LearnedSkills.ToRules([new("ldn", "London hotels", "Approve London hotels up to £500.")], [], new Dictionary<string, string>());
        Assert.Equal(375, rules.Single().CapPerNight);
    }

    [Fact]
    public void EvidenceIsTheManagersApprovalsTheRuleCovers()
    {
        var seed = SeedData.Load(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "seed")).InitialState();
        var rule = LearnedSkills.ToRules([new("london-hotel-cap", "London hotels", "Approve London hotels up to £350 a night.")], seed.Requests, new Dictionary<string, string>()).Single();

        Assert.Equal("London hotels are approved up to £350 a night", rule.Title);
        Assert.All(rule.Evidence.Rates, r => Assert.InRange(r, 251, 350));
        Assert.Equal(rule.Evidence.RequestIds.Count, rule.Evidence.Approvals);
        Assert.DoesNotContain("agent", rule.Evidence.ApproverIds);
    }

    [Fact]
    public void ParsesASnapshotArchive()
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Add(string path, string text)
            {
                using var w = new StreamWriter(zip.CreateEntry(path).Open(), Encoding.UTF8);
                w.Write(text);
            }
            Add("manifest.json", """{"schemaVersion":1,"revision":"r1","skills":[{"name":"london-hotel-cap","description":"London hotels up to £350","files":[{"path":"SKILL.md","size":10,"sha256":"x"}]}]}""");
            Add("london-hotel-cap/SKILL.md", "# London hotels\nApprove up to £350 a night.\n");
        }

        var skill = Assert.Single(LearnedSkills.Parse(buffer.ToArray()));
        Assert.Equal("london-hotel-cap", skill.Name);
        Assert.Contains("£350", skill.Markdown);
    }
}
