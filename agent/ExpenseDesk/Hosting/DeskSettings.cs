namespace ExpenseDesk.Hosting;

/// <summary>
/// Settings from environment variables (or appsettings). Secrets come from
/// the environment only; see agent/.env.example.
/// </summary>
public sealed record DeskSettings
{
    public string? AzureOpenAIEndpoint { get; init; }
    public string? AzureOpenAIDeployment { get; init; }
    public string? AzureOpenAIApiKey { get; init; }

    /// <summary>Stand-in model for local runs without an Azure deployment: OpenAI's own API.</summary>
    public string? OpenAIApiKey { get; init; }
    public string OpenAIModel { get; init; } = "gpt-5.6-sol";

    /// <summary>
    /// reasoning_effort for every model call. gpt-5.6 models refuse function tools on Chat Completions
    /// unless it is "none", so the OpenAI stand-in defaults to that; Azure deployments send none unless set.
    /// </summary>
    public string? ReasoningEffort { get; init; }

    public string? IntelligenceApiKey { get; init; }
    public string? LearningContainerId { get; init; }
    public Uri? IntelligenceApiUrl { get; init; }
    public Uri? IntelligenceRunnerUrl { get; init; }
    public Uri? IntelligenceClientUrl { get; init; }
    public string? SkillsRevision { get; init; }

    public required string SeedDirectory { get; init; }
    public required Uri AgentUrl { get; init; }
    public required IReadOnlySet<string> AllowedOrigins { get; init; }
    public required string DemoUserId { get; init; }
    public required string DemoUserName { get; init; }

    public bool HasAzureModel => !string.IsNullOrWhiteSpace(AzureOpenAIEndpoint) && !string.IsNullOrWhiteSpace(AzureOpenAIDeployment);

    public bool HasModel => HasAzureModel || !string.IsNullOrWhiteSpace(OpenAIApiKey);

    public string ModelDescription => HasAzureModel
        ? $"Azure OpenAI deployment {AzureOpenAIDeployment}"
        : HasModel ? $"OpenAI {OpenAIModel} (stand-in until an Azure deployment is set)" : "none";

    public bool HasIntelligence => !string.IsNullOrWhiteSpace(IntelligenceApiKey);

    public bool HasLearning => HasIntelligence && !string.IsNullOrWhiteSpace(LearningContainerId);

    public static DeskSettings From(IConfiguration config, IHostEnvironment env)
    {
        string? Get(string key) => string.IsNullOrWhiteSpace(config[key]) ? null : config[key]!.Trim();
        Uri? GetUri(string key) => Get(key) is { } v ? new Uri(v) : null;

        return new DeskSettings
        {
            AzureOpenAIEndpoint = Get("AZURE_OPENAI_ENDPOINT"),
            AzureOpenAIDeployment = Get("AZURE_OPENAI_DEPLOYMENT"),
            AzureOpenAIApiKey = Get("AZURE_OPENAI_API_KEY"),
            OpenAIApiKey = Get("OPENAI_API_KEY"),
            OpenAIModel = Get("OPENAI_MODEL") ?? "gpt-5.6-sol",
            ReasoningEffort = Get("MODEL_REASONING_EFFORT")
                ?? (Get("AZURE_OPENAI_DEPLOYMENT") is null && Get("OPENAI_API_KEY") is not null ? "none" : null),
            IntelligenceApiKey = Get("CPK_INTELLIGENCE_API_KEY"),
            LearningContainerId = Get("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID"),
            IntelligenceApiUrl = GetUri("INTELLIGENCE_API_URL"),
            IntelligenceRunnerUrl = GetUri("INTELLIGENCE_RUNNER_URL"),
            IntelligenceClientUrl = GetUri("INTELLIGENCE_CLIENT_URL"),
            SkillsRevision = Get("CPK_INTELLIGENCE_SKILLS_REVISION"),
            SeedDirectory = Path.GetFullPath(Get("DESK_SEED_DIR") ?? Path.Combine(env.ContentRootPath, "..", "..", "seed")),
            AgentUrl = GetUri("DESK_AGENT_URL") ?? new Uri("http://localhost:5000/agents/expense"),
            AllowedOrigins = (Get("DESK_ALLOWED_ORIGINS") ?? "http://localhost:4620")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.Ordinal),
            DemoUserId = Get("DESK_DEMO_USER_ID") ?? "priya.raman",
            DemoUserName = Get("DESK_DEMO_USER_NAME") ?? "Priya Raman",
        };
    }
}
