using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using CopilotKit.Intelligence;
using ExpenseDesk.Desk;

namespace ExpenseDesk.Learning;

/// <summary>
/// Publishes the skills CopilotKit Automatic Learning produced for this agent
/// as <see cref="ExpenseDeskState.LearnedRules"/>. The model reads the same
/// skills through SkillRegistryContextProvider; that adapter keeps its
/// snapshot internal, so this reads the container's published snapshot with
/// the Intelligence SDK and turns each hotel-cap skill into a rule the policy
/// check can apply and the dashboard can show.
/// </summary>
public sealed partial class LearnedSkills(
    IntelligenceClient? client,
    string? containerId,
    string? pinnedRevision,
    TimeProvider clock,
    ILogger<LearnedSkills> logger)
{
    public static readonly TimeSpan FreshnessWindow = TimeSpan.FromSeconds(5);

    private readonly Dictionary<string, string> _firstSeen = new(StringComparer.Ordinal);
    private IReadOnlyList<SkillDoc> _skills = [];
    private string? _etag;
    private DateTimeOffset _lastChecked = DateTimeOffset.MinValue;

    public bool Enabled => client is not null && !string.IsNullOrWhiteSpace(containerId);

    public IReadOnlyList<SkillDoc> Skills => _skills;

    /// <summary>Re-reads the registry (at most every few seconds unless forced) and updates the desk's learned rules.</summary>
    public async Task RefreshAsync(DeskStore store, bool force, CancellationToken cancellationToken)
    {
        if (!Enabled) return;
        var now = clock.GetUtcNow();
        if (force || now - _lastChecked >= FreshnessWindow)
        {
            try
            {
                var result = await client!.GetLearnedSkillsSnapshotAsync(containerId!, pinnedRevision, _etag, cancellationToken);
                if (result is LearnedSkillsSnapshot snapshot)
                {
                    _skills = Parse(snapshot.Bytes);
                    _etag = snapshot.ETag;
                    logger.LogInformation("Learned skills revision {Revision}: {Names}", snapshot.Revision,
                        _skills.Count == 0 ? "(none)" : string.Join(", ", _skills.Select(s => s.Name)));
                }
                _lastChecked = now;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Keep the last verified skills; the run goes on without new ones.
                logger.LogWarning(e, "Couldn't read learned skills from container {ContainerId}", containerId);
            }
        }

        foreach (var skill in _skills) _firstSeen.TryAdd(skill.Name, now.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"));
        store.State.LearnedRules = ToRules(_skills, store.State.Requests, _firstSeen, logger);
    }

    public sealed record SkillDoc(string Name, string Description, string Markdown);

    private sealed record Manifest(int SchemaVersion, string Revision, List<ManifestSkill> Skills);

    private sealed record ManifestSkill(string Name, string Description);

    /// <summary>Reads manifest.json and each skill's SKILL.md from a snapshot archive.</summary>
    public static IReadOnlyList<SkillDoc> Parse(byte[] archive)
    {
        using var zip = new ZipArchive(new MemoryStream(archive), ZipArchiveMode.Read);
        string Read(string path)
        {
            var entry = zip.GetEntry(path) ?? throw new InvalidDataException($"Snapshot is missing {path}");
            using var reader = new StreamReader(entry.Open(), Encoding.UTF8);
            return reader.ReadToEnd();
        }

        var manifest = JsonSerializer.Deserialize<Manifest>(Read("manifest.json"), DeskJson.Options)
            ?? throw new InvalidDataException("Empty skills manifest");
        return manifest.Skills.Select(s => new SkillDoc(s.Name, s.Description, Read($"{s.Name}/SKILL.md"))).ToList();
    }

    /// <summary>
    /// Turns hotel-cap skills into learned rules. A skill qualifies when it is
    /// about hotels, names a city and raises that city's cap; the policy's 50%
    /// ceiling still applies. Evidence is the manager approvals on the desk the
    /// rule covers.
    /// </summary>
    public static List<LearnedRule> ToRules(
        IEnumerable<SkillDoc> skills,
        IReadOnlyList<ExpenseRequest> requests,
        IReadOnlyDictionary<string, string> firstSeen,
        ILogger? logger = null)
    {
        var rules = new List<LearnedRule>();
        foreach (var skill in skills)
        {
            if (Interpret(skill) is not { } rule)
            {
                logger?.LogInformation("Skill {Name} isn't a hotel cap rule; the model can still load it", skill.Name);
                continue;
            }

            var cap = Math.Min(rule.Cap, Policy.BaseRuleFor(rule.City).CapPerNight * Policy.MaxLearnedUplift);
            var evidence = requests
                .Where(r => string.Equals(r.City, rule.City, StringComparison.OrdinalIgnoreCase) &&
                            r.Status == RequestStatus.Approved &&
                            r.Decision is { By: not "agent" } &&
                            r.Policy?.Outcome == "over" &&
                            r.NightlyRate <= cap)
                .ToList();
            rules.Add(new LearnedRule
            {
                Id = skill.Name,
                Title = $"{rule.City} hotels are approved up to £{cap.ToString("0.##", CultureInfo.InvariantCulture)} a night",
                City = rule.City,
                CapPerNight = cap,
                LearnedAt = firstSeen.TryGetValue(skill.Name, out var at) ? at : DeskJson.Now(),
                Evidence = new LearnedEvidence
                {
                    Approvals = evidence.Count,
                    RequestIds = evidence.Select(r => r.Id).ToList(),
                    ApproverIds = evidence.Select(r => r.Decision!.By).Distinct().ToList(),
                    Rates = evidence.Select(r => r.NightlyRate).ToList(),
                },
            });
        }
        return rules;
    }

    private static readonly string[] Cities =
        ["London", "Manchester", "Edinburgh", "Birmingham", "Glasgow", "Bristol", "Leeds", "Liverpool", "Cardiff", "Belfast"];

    /// <summary>
    /// Reads city and cap from a skill. Explicit <c>city:</c> / <c>capPerNight:</c>
    /// lines win. Otherwise the cap must be stated as an approval ("approve(d)
    /// London hotels up to £350") in one sentence, and the city is the one city
    /// that sentence names. Anything vaguer, or about rejections, is not a rule.
    /// </summary>
    public static (string City, decimal Cap)? Interpret(SkillDoc skill)
    {
        var text = $"{skill.Name}\n{skill.Description}\n{skill.Markdown}";
        if (!text.Contains("hotel", StringComparison.OrdinalIgnoreCase)) return null;

        string? city = CityLine().Match(text) is { Success: true } c ? c.Groups[1].Value.Trim() : null;
        decimal? cap = CapLine().Match(text) is { Success: true } line ? Amount(line.Groups[1].Value) : null;
        if (cap is null)
        {
            var sentence = Sentences().Split(text).FirstOrDefault(x => ApprovedUpTo().IsMatch(x) && !Rejection().IsMatch(x));
            if (sentence is null) return null;
            cap = Amount(ApprovedUpTo().Match(sentence).Groups[1].Value);
            city ??= SingleCity(sentence);
        }
        city ??= SingleCity(text);
        if (city is null || cap is null) return null;
        return cap > Policy.BaseRuleFor(city).CapPerNight ? (city, cap.Value) : null;
    }

    private static string? SingleCity(string text)
    {
        var named = Cities.Where(name => Regex.IsMatch(text, $@"\b{name}\b", RegexOptions.IgnoreCase)).ToList();
        return named.Count == 1 ? named[0] : null;
    }

    private static decimal? Amount(string s) =>
        decimal.TryParse(s.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : null;

    [GeneratedRegex(@"^\s*city\s*:\s*([A-Za-z .'-]+?)\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex CityLine();

    [GeneratedRegex(@"^\s*cap(?:PerNight)?\s*:\s*£?\s*([\d,]+(?:\.\d+)?)\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex CapLine();

    [GeneratedRegex(@"approv\w*\b[^£]{0,80}?(?:up to|at most|no more than|max(?:imum)? of)\s*£\s*([\d,]+(?:\.\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex ApprovedUpTo();

    [GeneratedRegex(@"\b(?:reject\w*|declin\w*|denied|refus\w*)\b", RegexOptions.IgnoreCase)]
    private static partial Regex Rejection();

    [GeneratedRegex(@"(?<=[.!?;])\s+|\n+")]
    private static partial Regex Sentences();
}
