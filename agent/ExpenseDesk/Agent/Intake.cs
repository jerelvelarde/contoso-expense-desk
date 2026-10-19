using System.ComponentModel;
using ExpenseDesk.Desk;
using Microsoft.Extensions.AI;

namespace ExpenseDesk.Agent;

/// <summary>
/// Reads the employee's Teams message into request fields before the agent's
/// turn, so the request exists (and has an id) before the first tool call.
/// </summary>
public sealed class Intake(IChatClient chatClient, TimeProvider clock, Hosting.DeskSettings settings)
{
    [Description("The hotel request in an employee's Teams message.")]
    public sealed record Fields(
        [property: Description("True when the message asks to book or approve a hotel stay.")] bool IsHotelRequest,
        [property: Description("City of the hotel, e.g. \"London\".")] string? City,
        [property: Description("Why they're travelling, as a short title of at most five words, e.g. \"AI Summit\" or \"Customer workshop\".")] string? Purpose,
        [property: Description("Nightly rate in GBP as a number, e.g. 320 for \"around £320 a night\".")] decimal? NightlyRate,
        [property: Description("Check-in date as yyyy-MM-dd.")] string? CheckIn,
        [property: Description("Check-out date as yyyy-MM-dd.")] string? CheckOut,
        [property: Description("Number of nights, if stated or implied by the dates.")] int? Nights);

    public async Task<Fields> ReadAsync(string message, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var response = await chatClient.GetResponseAsync<Fields>(
            [
                new(ChatRole.System,
                    $"Extract the hotel request from an employee's Teams message. Today is {today:yyyy-MM-dd} ({today:dddd}). " +
                    "Dates without a year are the next occurrence on or after today. \"4 to 7 Nov\" means check in on the 4th and check out on the 7th. " +
                    "Leave a field null when the message doesn't say it; never guess a rate."),
                new(ChatRole.User, message),
            ],
            DeskJson.Options,
            Hosting.ModelClient.Tuned(new ChatOptions(), settings),
            cancellationToken: cancellationToken);
        return response.Result;
    }

    /// <summary>Builds the new request, or explains what's missing.</summary>
    public static (ExpenseRequest? Request, string? Missing) ToRequest(Fields f, string id, string requesterName, string text, string createdAt)
    {
        var nights = DeskStore.NightsBetween(f.CheckIn, f.CheckOut) ?? f.Nights;
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(f.City)) missing.Add("the city");
        if (f.NightlyRate is not > 0) missing.Add("the nightly rate");
        if (nights is not > 0) missing.Add("the dates or number of nights");
        if (missing.Count > 0) return (null, string.Join(", ", missing));

        return (new ExpenseRequest
        {
            Id = id,
            CreatedAt = createdAt,
            Source = new RequestSource { Text = text },
            Requester = new Requester { Name = requesterName },
            City = f.City!.Trim(),
            Purpose = string.IsNullOrWhiteSpace(f.Purpose) ? "Business travel" : f.Purpose.Trim(),
            NightlyRate = f.NightlyRate!.Value,
            Nights = nights!.Value,
            CheckIn = f.CheckIn,
            CheckOut = f.CheckOut,
            Status = RequestStatus.Received,
        }, null);
    }
}
