using System.ClientModel;
using System.ClientModel.Primitives;
using Azure.Identity;
using Microsoft.Extensions.AI;
using OpenAI;
using ChatCompletionOptions = OpenAI.Chat.ChatCompletionOptions;
using ChatReasoningEffortLevel = OpenAI.Chat.ChatReasoningEffortLevel;

namespace ExpenseDesk.Hosting;

/// <summary>
/// The chat model: an Azure OpenAI (or Azure AI Foundry) deployment through
/// its OpenAI-compatible v1 endpoint, as Agent Framework's samples do. An API
/// key if one is set, otherwise Entra ID through DefaultAzureCredential.
/// Without an Azure deployment, OPENAI_API_KEY stands in (same SDK, OpenAI's
/// endpoint) so the demo can run before the Azure resource exists.
/// </summary>
public static class ModelClient
{
    public static IChatClient Create(DeskSettings settings)
    {
        if (!settings.HasModel) return new MissingModel();
        if (!settings.HasAzureModel)
        {
            return new OpenAIClient(new ApiKeyCredential(settings.OpenAIApiKey!)).GetChatClient(settings.OpenAIModel).AsIChatClient();
        }

        var options = new OpenAIClientOptions { Endpoint = V1Endpoint(settings.AzureOpenAIEndpoint!) };
        var client = settings.AzureOpenAIApiKey is { } key
            ? new OpenAIClient(new ApiKeyCredential(key), options)
#pragma warning disable OPENAI001 // Entra ID through BearerTokenPolicy, as Agent Framework's Azure samples do
            : new OpenAIClient(new BearerTokenPolicy(new DefaultAzureCredential(), "https://ai.azure.com/.default"), options);
#pragma warning restore OPENAI001
        return client.GetChatClient(settings.AzureOpenAIDeployment!).AsIChatClient();
    }

    /// <summary>Sets reasoning_effort on every request built from <paramref name="options"/>, if configured.</summary>
    public static ChatOptions Tuned(ChatOptions options, DeskSettings settings)
    {
        if (settings.ReasoningEffort is { } effort)
        {
#pragma warning disable OPENAI001 // reasoning_effort is marked experimental in the OpenAI SDK
            options.RawRepresentationFactory = _ => new ChatCompletionOptions { ReasoningEffortLevel = new ChatReasoningEffortLevel(effort) };
#pragma warning restore OPENAI001
        }
        return options;
    }

    /// <summary>https://&lt;resource&gt;.openai.azure.com (or .services.ai.azure.com) → …/openai/v1/</summary>
    public static Uri V1Endpoint(string endpoint)
    {
        var uri = new Uri(endpoint, UriKind.Absolute);
        var path = uri.AbsolutePath.TrimEnd('/');
        if (path.EndsWith("/openai/v1", StringComparison.OrdinalIgnoreCase)) return new UriBuilder(uri) { Path = path + "/" }.Uri;
        return new UriBuilder(uri) { Path = $"{path}/openai/v1/" }.Uri;
    }

    /// <summary>Lets the host start without a model so sync, edits and learning still work.</summary>
    private sealed class MissingModel : IChatClient
    {
        private static InvalidOperationException Error() =>
            new("No model configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT, or OPENAI_API_KEY (see agent/.env.example).");

        public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
            throw Error();

        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
            throw Error();

        public object? GetService(Type serviceType, object? serviceKey = null) => null;

        public void Dispose() { }
    }
}
