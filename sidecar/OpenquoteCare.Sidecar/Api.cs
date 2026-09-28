using System.Text.Json;
using System.Text.Json.Nodes;
using Openquote.Records;
using Openquote.Reports;
using Openquote.Vault;

namespace OpenquoteCare.Sidecar;

/// <summary>A vault file on the wire: the path and the plaintext, base64-encoded.</summary>
public sealed record WireFile(string Path, string Content)
{
    internal VaultFile ToVaultFile() => new(Path, Convert.FromBase64String(Content));

    internal static WireFile From(VaultFile f) => new(f.Path, Convert.ToBase64String(f.Content.Span));
}

public sealed record FilesRequest(IReadOnlyList<WireFile> Files);

public sealed record CreateSubjectRequest(Dictionary<string, JsonNode?> Fields);


public sealed record CreateInSubjectRequest(string SubjectId, string Type, Dictionary<string, JsonNode?> Fields);

public sealed record UpdateRequest(string Type, string Id, Dictionary<string, JsonNode?> Fields);

public sealed record ReclassifyRequest(string Type, string Id, string Field, JsonNode Value);

public sealed record RunRequest(string Report, int Version, int Year, int Month);

/// <summary>The HTTP surface the shell calls. The sidecar never touches the disk: files come in as
/// plaintext from the host, and every change it makes is handed back as a file for the host to
/// encrypt, create, and then add.</summary>
internal static class Api
{
    public static void Map(WebApplication app, string device, TimeProvider clock)
    {
        var writer = new VaultWriter(device, clock);

        app.MapPost("/vault/load", (FilesRequest request, VaultSession session) =>
            Summary(session.Load(request.Files.Select(f => f.ToVaultFile()))));

        app.MapPost("/vault/add", (FilesRequest request, VaultSession session) =>
        {
            try
            {
                return Results.Ok(Summary(session.Add(request.Files.Select(f => f.ToVaultFile()))));
            }
            catch (InvalidOperationException e)
            {
                return Results.Conflict(new { error = e.Message });
            }
        });

        app.MapGet("/entities/{type}", (string type, VaultSession session) =>
            session.Current.Entities.Values
                .Where(e => e.Reference.Type == type && !e.Destroyed)
                .OrderBy(e => e.Reference.Id, StringComparer.Ordinal)
                .Select(EntityView));

        app.MapGet("/summary", (VaultSession session) => Summary(session.Current));

        app.MapGet("/schemes", (VaultSession session) =>
            session.Current.Content.Schemes
                .OrderBy(s => s.Name, StringComparer.Ordinal).ThenBy(s => s.Version)
                .Select(s => new
                {
                    scheme = s.Name,
                    s.Version,
                    items = s.Items.Select(i => new { i.Code, i.Label, i.Parent, i.Suggest }),
                }));

        app.MapPost("/changes/subject", (CreateSubjectRequest request) =>
            WireFile.From(writer.CreateSubject(request.Fields)));

        app.MapPost("/changes/practitioner", (CreateSubjectRequest request) =>
            WireFile.From(writer.CreatePractitioner(request.Fields)));

        app.MapPost("/changes/in-subject", (CreateInSubjectRequest request) =>
            WireFile.From(writer.CreateInSubject(request.SubjectId, request.Type, request.Fields)));

        app.MapPost("/changes/update", (UpdateRequest request, VaultSession session) =>
            Find(session, request.Type, request.Id) is { } entity
                ? Results.Ok(WireFile.From(writer.Update(entity, request.Fields)))
                : Results.NotFound());

        app.MapPost("/changes/reclassify", (ReclassifyRequest request, VaultSession session) =>
            Find(session, request.Type, request.Id) is { } entity
                ? Results.Ok(WireFile.From(writer.Reclassify(entity, request.Field, request.Value)))
                : Results.NotFound());

        app.MapPost("/reports/run", (RunRequest request, VaultSession session) =>
        {
            var snapshot = session.Current;
            var report = snapshot.Content.Reports.SingleOrDefault(r => r.Name == request.Report && r.Version == request.Version);
            if (report is null) return Results.NotFound();
            var run = ReportRunner.RunMonth(report, request.Year, request.Month, snapshot.Entities.Values, snapshot.Content.Catalog());
            var file = writer.RunRecord(run);
            return Results.Ok(new { record = JsonNode.Parse(file.Content.Span), file = WireFile.From(file) });
        });
    }

    private static Entity? Find(VaultSession session, string type, string id) =>
        session.Current.Entities.GetValueOrDefault(new EntityRef(type, id));

    private static object Summary(VaultSession.Snapshot s) => new
    {
        changes = s.Content.Changes.Count,
        entities = s.Entities.Count,
        conflicts = s.Entities.Values.Count(e => e.Conflicts.Count > 0),
        reports = s.Content.Reports.Select(r => new { r.Name, r.Version, r.Label }),
        unreadable = s.Content.Unreadable.Select(u => new { u.Path, reason = u.Reason.ToString(), u.Detail }),
    };

    private static object EntityView(Entity e) => new
    {
        e.Reference.Type,
        e.Reference.Id,
        e.Subject,
        fields = e.Fields.ToDictionary(f => f.Key, f => f.Value),
        conflicts = e.Conflicts.ToDictionary(c => c.Key, c => c.Value.Select(h => new { h.ChangeId, h.Device, value = h.Value })),
    };
}
