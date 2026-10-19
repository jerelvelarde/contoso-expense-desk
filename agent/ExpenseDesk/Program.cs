using AGUI.Abstractions;
using CopilotKit.Intelligence;
using CopilotKit.Intelligence.AgentFramework;
using ExpenseDesk.Agent;
using ExpenseDesk.Desk;
using ExpenseDesk.Hosting;
using ExpenseDesk.Learning;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.Extensions.AI;

// Contoso Expense Desk backend, one ASP.NET Core host:
//   /agents/expense  the Microsoft Agent Framework agent, served over AG-UI (AGUI.Server)
//   /copilotkit      the CopilotKit .NET runtime, connected to CopilotKit Intelligence,
//                    which reaches the agent at /agents/expense through HttpAgent
var builder = WebApplication.CreateBuilder(args);
var settings = DeskSettings.From(builder.Configuration, builder.Environment);

builder.Services.AddAGUIServer();
// Serialize AG-UI events with the protocol's own resolver first, so optional fields are omitted, not null.
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.TypeInfoResolverChain.Insert(0, AGUIJsonUtilities.DefaultTypeInfoResolver));

builder.Services.AddSingleton(settings);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(SeedData.Load(settings.SeedDirectory));
builder.Services.AddSingleton<DeskStore>();
builder.Services.AddSingleton<ExpenseTools>();
builder.Services.AddSingleton(ModelClient.Create(settings));
builder.Services.AddSingleton<Intake>();

// One Intelligence client, shared by the runtime and the learned-skills adapter.
builder.Services.AddSingleton(_ =>
{
    if (!settings.HasIntelligence) return null!;
    var defaults = new IntelligenceOptions { ApiKey = settings.IntelligenceApiKey! };
    return new IntelligenceClient(new IntelligenceOptions
    {
        ApiKey = settings.IntelligenceApiKey!,
        ApiUrl = settings.IntelligenceApiUrl ?? defaults.ApiUrl,
        RunnerUrl = settings.IntelligenceRunnerUrl ?? defaults.RunnerUrl,
        ClientUrl = settings.IntelligenceClientUrl ?? defaults.ClientUrl,
    });
});
builder.Services.AddSingleton(sp => settings.HasLearning
    ? new SkillRegistryContextProvider(new SkillRegistryOptions
    {
        Client = sp.GetRequiredService<IntelligenceClient>(),
        ContainerId = settings.LearningContainerId,
        Revision = settings.SkillsRevision,
    })
    : null!);
builder.Services.AddSingleton(sp => new LearnedSkills(
    settings.HasLearning ? sp.GetRequiredService<IntelligenceClient>() : null,
    settings.LearningContainerId,
    settings.SkillsRevision,
    sp.GetRequiredService<TimeProvider>(),
    sp.GetRequiredService<ILogger<LearnedSkills>>()));

builder.Services.AddSingleton<ExpenseAgent>(sp =>
{
    var chatClient = sp.GetRequiredService<IChatClient>();
    var agentOptions = new ChatClientAgentOptions
    {
        Name = ExpenseAgent.AgentId,
        ChatOptions = ModelClient.Tuned(new ChatOptions
        {
            Instructions = Instructions.Expense,
            Tools = sp.GetRequiredService<ExpenseTools>().All(),
            AllowMultipleToolCalls = false,
        }, settings),
    };
    // Learned skills: the adapter adds the skill catalog and its two load tools to every invocation.
    var skills = settings.HasLearning ? sp.GetRequiredService<SkillRegistryContextProvider>() : null;
    var modelAgent = skills?.CreateAgent(chatClient, agentOptions) ?? chatClient.AsAIAgent(agentOptions);
    return ActivatorUtilities.CreateInstance<ExpenseAgent>(sp, modelAgent);
});

if (settings.HasIntelligence)
{
    builder.Services.AddHttpClient("agent", client => client.Timeout = Timeout.InfiniteTimeSpan)
        .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) })
        .SetHandlerLifetime(Timeout.InfiniteTimeSpan);
    builder.Services.AddSingleton(sp =>
    {
        var logger = sp.GetRequiredService<ILogger<IntelligenceRuntime>>();
        return new IntelligenceRuntime(new RuntimeOptions
        {
            Intelligence = sp.GetRequiredService<IntelligenceClient>(),
            ApiKey = settings.IntelligenceApiKey!,
            Agents = new Dictionary<string, IRuntimeAgent>
            {
                [ExpenseAgent.AgentId] = new HttpAgent(
                    settings.AgentUrl,
                    sp.GetRequiredService<IHttpClientFactory>().CreateClient("agent"),
                    "Contoso expense desk (Microsoft Agent Framework)"),
            },
            // Demo only: every request runs as the Finance user. Put real sign-in
            // (e.g. Entra ID) in front of this before it leaves localhost.
            IdentifyUser = (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                return ValueTask.FromResult<RuntimeUser?>(new RuntimeUser(settings.DemoUserId, settings.DemoUserName));
            },
            // Threads go to the Learning Container so Automatic Learning sees the managers' decisions.
            LearningContainer = settings.HasLearning
                ? (_, _, _, _, _) => ValueTask.FromResult<string?>(settings.LearningContainerId)
                : null,
            AllowedOrigins = settings.AllowedOrigins,
            OnError = error => logger.LogError(error.Exception, "CopilotKit runtime error: {Code}", error.Code),
        });
    });
}

var app = builder.Build();
var log = app.Services.GetRequiredService<ILogger<Program>>();

app.MapAGUIServer("/agents/expense", app.Services.GetRequiredService<ExpenseAgent>());
app.MapGet("/", () => Results.Text(
    $"Contoso Expense Desk agent. AG-UI: /agents/expense. CopilotKit runtime: {(settings.HasIntelligence ? "/copilotkit" : "not configured")}."));
app.MapGet("/healthz", () => Results.Ok(new
{
    status = "ok",
    runtime = settings.HasIntelligence,
    model = settings.HasModel,
    learnedSkills = settings.HasLearning,
}));

if (settings.HasIntelligence)
{
    app.Services.GetRequiredService<IntelligenceRuntime>().Map(app, "/copilotkit");
}
else
{
    log.LogWarning("CPK_INTELLIGENCE_API_KEY is not set, so /copilotkit is off. The dashboard needs it; see agent/README.md.");
}
if (!settings.HasModel)
{
    log.LogWarning("No model configured (AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT, or OPENAI_API_KEY). Teams messages and decisions will fail.");
}
else
{
    log.LogInformation("Model: {Model}", settings.ModelDescription);
}
if (settings.HasLearning)
{
    try
    {
        await app.Services.GetRequiredService<SkillRegistryContextProvider>().InitializeAsync();
    }
    catch (LearnedSkillsException e)
    {
        // The agent still runs; the adapter retries on the next invocation.
        log.LogWarning("Learned skills unavailable ({Code}): {Message}", e.Code, e.Message);
    }
}
else
{
    log.LogWarning("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID is not set, so learned skills are off.");
}

await app.RunAsync();

/// <summary>Visible to the integration tests (WebApplicationFactory).</summary>
public partial class Program;
