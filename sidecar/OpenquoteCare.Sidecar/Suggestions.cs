using System.Text.Json;
using System.Text.Json.Serialization;
using Openquote.Gil;

namespace OpenquoteCare.Sidecar;

/// <summary>
/// Suggested codes for the record being entered, learned from the open vault's settled records. The
/// suggester is built in memory on the first request after the vault changes, for the type and date
/// asked, and kept until the vault or the request moves on; nothing is written anywhere.
/// </summary>
/// <remarks>
/// A build reads every settled record of the type (about half a second for a year of one counselor's
/// sessions); a suggestion afterwards takes milliseconds. Requests are taken one at a time, since a
/// suggester is not safe for concurrent use.
/// </remarks>
internal sealed class Suggestions(VaultSession session) : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Built? _built;

    private sealed record Built(VaultSession.Snapshot Snapshot, string Type, DateOnly Date, CodeSuggester Suggester);

    public async Task<SuggestionsView> SuggestAsync(SuggestRequest request, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var snapshot = session.Current;
            if (_built is not { } built || !ReferenceEquals(built.Snapshot, snapshot) || built.Type != request.Type || built.Date != request.Date)
            {
                var suggester = await CodeSuggester.BuildAsync(snapshot.Content, request.Type, request.Date, cancellationToken).ConfigureAwait(false);
                _built = built = new Built(snapshot, request.Type, request.Date, suggester);
            }
            var fields = await built.Suggester.SuggestAsync(request.Fields, cancellationToken).ConfigureAwait(false);
            return new SuggestionsView(built.Suggester.Remembered, fields);
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose() => _gate.Dispose();
}

/// <summary>A record being entered: its type, the date it is for, and the values it holds so far.</summary>
public sealed record SuggestRequest(string Type, DateOnly Date, Dictionary<string, JsonElement> Fields);

/// <summary>
/// Codes suggested for the coded fields the record has no value for yet, each with why it is suggested
/// and the settled records that rest on it (entity ids), and how many settled records they are learned from.
/// </summary>
public sealed record SuggestionsView(int Remembered, IReadOnlyList<FieldSuggestions> Fields);

/// <summary>Writes why a code is suggested as a camel-case name (<c>similarRecords</c>, <c>sameValue</c>, <c>frequent</c>).</summary>
public sealed class SuggestionBasisConverter() : JsonStringEnumConverter<SuggestionBasis>(JsonNamingPolicy.CamelCase);
