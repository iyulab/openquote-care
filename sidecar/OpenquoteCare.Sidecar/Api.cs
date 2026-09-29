using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Nodes;
using Openquote.Classification;
using Openquote.Exports;
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

/// <param name="Undecryptable">On load: files the host found but could not decrypt, listed with the rest.</param>
public sealed record FilesRequest(IReadOnlyList<WireFile> Files, IReadOnlyList<UndecryptableFile>? Undecryptable = null);

/// <summary>A file the host could not decrypt: its path on disk, the vault path it would hold, and why.</summary>
public sealed record UndecryptableFile(string Path, string Plain, string Detail);

public sealed record CreateSubjectRequest(Dictionary<string, JsonNode?> Fields);


public sealed record CreateInSubjectRequest(string SubjectId, string Type, Dictionary<string, JsonNode?> Fields);

public sealed record CreateInGroupRequest(string GroupId, string Type, Dictionary<string, JsonNode?> Fields);

public sealed record DeviceNameRequest(string Name);

public sealed record UpdateRequest(string Type, string Id, Dictionary<string, JsonNode?> Fields);

public sealed record ReclassifyRequest(string Type, string Id, string Field, JsonNode Value);

public sealed record ResolveRequest(int TargetVersion, IReadOnlyList<CodedValue> Values);

public sealed record CompareRequest(string Earlier, string Later);

public sealed record RunRequest(string Report, int Version, int Year, int Month);

public sealed record ExportRequest(string Export, int Version, int Year, int Month);

// Responses. Typed rather than anonymous so the JSON contract is source-generated (SidecarJson):
// no reflection at run time, which is what lets the sidecar be published ahead-of-time compiled.

public sealed record SummaryView(
    string Device,
    IReadOnlyDictionary<string, string> Devices,
    int Changes,
    int Entities,
    int Conflicts,
    IReadOnlyList<ReportView> Reports,
    IReadOnlyList<ExportView> Exports,
    IReadOnlyList<SchemeVersionView> Unlinked,
    IReadOnlyList<UnreadableView> Unreadable);

/// <summary>A scheme version no crosswalk leads to from an earlier version of the same scheme.</summary>
public sealed record SchemeVersionView(string Scheme, int Version);

public sealed record ExportView(string Name, int Version, string Label, IReadOnlyList<SchemeLagView> Behind);

/// <summary>A scheme a form classifies by, at a version older than the latest one the vault holds.</summary>
public sealed record SchemeLagView(string Scheme, int Version, int Latest);

public sealed record ExportRowView(string Record, IReadOnlyList<string> Cells);

public sealed record ExportTableView(
    string Export,
    int Version,
    string From,
    string To,
    IReadOnlyList<string> Columns,
    IReadOnlyList<ExportRowView> Rows,
    IReadOnlyList<string> Pending,
    IReadOnlyList<string> Unmapped);

public sealed record ReportView(string Name, int Version, string Label, IReadOnlyList<SchemeLagView> Behind);

/// <summary>A file that could not be used: why, and what it was for (read from its path).</summary>
public sealed record UnreadableView(string Path, string Reason, string Detail, VaultFileKind Kind);

public sealed record EntityView(
    string Type,
    string Id,
    string? Subject,
    string? Group,
    IReadOnlyList<string> People,
    IReadOnlyDictionary<string, JsonElement> Fields,
    IReadOnlyDictionary<string, IReadOnlyList<HeadView>> Conflicts);

public sealed record HeadView(string ChangeId, string Device, JsonElement Value);

public sealed record SchemeView(string Scheme, int Version, IReadOnlyList<SchemeItem> Items);

public sealed record ResolutionView(string Kind, string? Code, IReadOnlyList<string> Candidates, IReadOnlyList<string> Crosswalks);

public sealed record RunListItem(string Id, string Device, string At, RunReportRef Report, PeriodView Period, int Total);

public sealed record RunReportRef(string Name, int Version);

public sealed record PeriodView(string From, string To);

public sealed record ComparisonView(
    JsonNode Earlier,
    JsonNode Later,
    IReadOnlyList<string> Late,
    IReadOnlyList<string> Removed,
    IReadOnlyList<string> Revised,
    IReadOnlyList<string> Moved,
    IReadOnlyList<string> Unchanged);

public sealed record RunResult(JsonNode? Record, WireFile File);

public sealed record ErrorView(string Error);

/// <summary>The HTTP surface the shell calls. The sidecar never touches the disk: files come in as
/// plaintext from the host, and every change it makes is handed back as a file for the host to
/// encrypt, create, and then add.</summary>
internal static class Api
{
    public static void Map(WebApplication app, string device, TimeProvider clock)
    {
        var writer = new VaultWriter(device, clock);

        app.MapPost("/vault/load", (FilesRequest request, VaultSession session) =>
            Summary(device, session.Load(request.Files.Select(f => f.ToVaultFile()), request.Undecryptable ?? [])));

        app.MapPost("/vault/add", (FilesRequest request, VaultSession session) =>
        {
            try
            {
                return Results.Ok(Summary(device, session.Add(request.Files.Select(f => f.ToVaultFile()))));
            }
            catch (InvalidOperationException e)
            {
                return Results.Conflict(new ErrorView(e.Message));
            }
        });

        app.MapGet("/entities/{type}", (string type, VaultSession session) =>
            session.Current.Entities.Values
                .Where(e => e.Reference.Type == type && !e.Destroyed)
                .OrderBy(e => e.Reference.Id, StringComparer.Ordinal)
                .Select(ViewOf)
                .ToArray());

        app.MapGet("/summary", (VaultSession session) => Summary(device, session.Current));

        app.MapGet("/schemes", (VaultSession session) =>
            session.Current.Content.Schemes
                .OrderBy(s => s.Name, StringComparer.Ordinal).ThenBy(s => s.Version)
                .Select(s => new SchemeView(s.Name, s.Version, s.Items))
                .ToArray());

        app.MapPost("/classification/resolve", (ResolveRequest request, VaultSession session) =>
        {
            var catalog = session.Current.Content.Catalog();
            return request.Values
                .Select(v => catalog.Resolve(v, request.TargetVersion))
                .Select(r => new ResolutionView(r.Kind.ToString().ToLowerInvariant(), r.Code, r.Candidates, r.Crosswalks))
                .ToArray();
        });

        app.MapGet("/runs", (VaultSession session) =>
            session.Current.Content.Runs.Select(k => new RunListItem(
                k.Id,
                k.Device,
                k.At.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
                new RunReportRef(k.Run.Report.Name, k.Run.Report.Version),
                new PeriodView(k.Run.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), k.Run.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
                k.Run.Total.Count)).ToArray());

        app.MapPost("/runs/compare", (CompareRequest request, VaultSession session) =>
        {
            var runs = session.Current.Content.Runs;
            if (runs.FirstOrDefault(k => k.Id == request.Earlier) is not { } earlier
                || runs.FirstOrDefault(k => k.Id == request.Later) is not { } later)
                return Results.NotFound();
            var diff = ReportDiff.Compare(earlier.Run, later.Run, session.Current.Content.Catalog());
            return Results.Ok(new ComparisonView(
                RunView(earlier), RunView(later), diff.Late, diff.Removed, diff.Revised, diff.Moved, diff.Unchanged));
        });

        app.MapPost("/changes/subject", (CreateSubjectRequest request) =>
            WireFile.From(writer.CreateSubject(request.Fields)));

        app.MapPost("/changes/practitioner", (CreateSubjectRequest request) =>
            WireFile.From(writer.CreatePractitioner(request.Fields)));

        app.MapPost("/changes/in-subject", (CreateInSubjectRequest request) =>
            WireFile.From(writer.CreateInSubject(request.SubjectId, request.Type, request.Fields)));

        app.MapPost("/changes/group", (CreateSubjectRequest request) =>
            WireFile.From(writer.CreateGroup(request.Fields)));

        app.MapPost("/changes/in-group", (CreateInGroupRequest request) =>
            WireFile.From(writer.CreateInGroup(request.GroupId, request.Type, request.Fields)));

        // Names this device: renames the device entity it made, or makes one.
        app.MapPost("/changes/device-name", (DeviceNameRequest request, VaultSession session) =>
        {
            var fields = new Dictionary<string, JsonNode?> { [DeviceNames.NameField] = request.Name.Trim() };
            return WireFile.From(DeviceNames.EntityOf(session.Current.Entities.Values, device) is { } mine
                ? writer.Update(mine, fields)
                : writer.CreateDevice(fields));
        });

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
            return Results.Ok(new RunResult(JsonNode.Parse(file.Content.Span), WireFile.From(file)));
        });

        // Lays one month's records out as an export form's rows. Nothing is kept: the rows go to
        // the person, who takes them to the outside form.
        app.MapPost("/exports/run", (ExportRequest request, VaultSession session) =>
        {
            var snapshot = session.Current;
            var export = snapshot.Content.Exports.SingleOrDefault(e => e.Name == request.Export && e.Version == request.Version);
            if (export is null) return Results.NotFound();
            var from = new DateOnly(request.Year, request.Month, 1);
            var table = ExportRunner.Run(export, from, from.AddMonths(1).AddDays(-1), snapshot.Entities.Values, snapshot.Content.Catalog());
            return Results.Ok(new ExportTableView(
                export.Name,
                export.Version,
                table.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                table.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                [.. export.Columns.Select(c => c.Label)],
                [.. table.Rows.Select(r => new ExportRowView(r.Record, r.Cells))],
                table.Pending,
                table.Unmapped));
        });
    }

    private static Entity? Find(VaultSession session, string type, string id) =>
        session.Current.Entities.GetValueOrDefault(new EntityRef(type, id));

    private static SummaryView Summary(string device, VaultSession.Snapshot s)
    {
        var latest = s.Content.Schemes
            .GroupBy(x => x.Name, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Max(x => x.Version), StringComparer.Ordinal);
        return new(
            device,
            DeviceNames.Of(s.Entities.Values),
            s.Content.Changes.Count,
            s.Entities.Count,
            s.Entities.Values.Count(e => e.Conflicts.Count > 0),
            [.. s.Content.Reports.Select(r => new ReportView(r.Name, r.Version, r.Label, Behind([(r.RowScheme, r.RowVersion)], latest)))],
            [.. s.Content.Exports.Select(e => new ExportView(e.Name, e.Version, e.Label,
                Behind(e.Columns.OfType<CodedColumn>().Select(c => (c.Scheme, c.Version)), latest)))],
            Unlinked(s.Content),
            [.. s.Content.Unreadable.Select(u => new UnreadableView(u.Path, u.Reason.ToString(), u.Detail, u.Kind))
                .Concat(s.Undecryptable.Select(u => new UnreadableView(u.Path, "Undecryptable", u.Detail, VaultFileKind.Of(u.Plain))))
                .OrderBy(u => u.Path, StringComparer.Ordinal)]);
    }

    // Values are carried to a new version only through crosswalks; a version none leads to — even one
    // that only relabels — leaves every value recorded in an earlier version unmapped there.
    private static SchemeVersionView[] Unlinked(VaultContent content) =>
        [.. content.Schemes
            .Where(s => content.Schemes.Any(e => e.Name == s.Name && e.Version < s.Version)
                && !content.Crosswalks.Any(c => c.Scheme == s.Name && c.To == s.Version && c.From < s.Version))
            .OrderBy(s => s.Name, StringComparer.Ordinal).ThenBy(s => s.Version)
            .Select(s => new SchemeVersionView(s.Name, s.Version))];

    // A form classifies by fixed scheme versions; after a revision, values recorded in the new
    // version may not carry back to it, so a form left behind reads new records as empty or pending.
    private static SchemeLagView[] Behind(IEnumerable<(string Scheme, int Version)> uses, Dictionary<string, int> latest) =>
        [.. uses.Distinct()
            .Where(u => latest.TryGetValue(u.Scheme, out var l) && l > u.Version)
            .OrderBy(u => u.Scheme, StringComparer.Ordinal)
            .Select(u => new SchemeLagView(u.Scheme, u.Version, latest[u.Scheme]))];

    // A kept run as its record reads: the same shape /reports/run answers with.
    private static JsonNode RunView(KeptRun k) => JsonNode.Parse(ReportRunJson.Write(k.Run, k.Id, k.Device, k.At))!;

    private static EntityView ViewOf(Entity e) => new(
        e.Reference.Type,
        e.Reference.Id,
        e.Subject,
        e.Group,
        e.People,
        e.Fields,
        e.Conflicts.ToDictionary(
            c => c.Key,
            c => (IReadOnlyList<HeadView>)[.. c.Value.Select(h => new HeadView(h.ChangeId, h.Device, h.Value))]));
}

/// <summary>The sidecar's JSON contract, generated at compile time.</summary>
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
[JsonSerializable(typeof(FilesRequest))]
[JsonSerializable(typeof(CreateSubjectRequest))]
[JsonSerializable(typeof(CreateInSubjectRequest))]
[JsonSerializable(typeof(CreateInGroupRequest))]
[JsonSerializable(typeof(DeviceNameRequest))]
[JsonSerializable(typeof(UpdateRequest))]
[JsonSerializable(typeof(ReclassifyRequest))]
[JsonSerializable(typeof(ResolveRequest))]
[JsonSerializable(typeof(CompareRequest))]
[JsonSerializable(typeof(RunRequest))]
[JsonSerializable(typeof(ExportRequest))]
[JsonSerializable(typeof(ExportTableView))]
[JsonSerializable(typeof(SummaryView))]
[JsonSerializable(typeof(EntityView[]))]
[JsonSerializable(typeof(SchemeView[]))]
[JsonSerializable(typeof(ResolutionView[]))]
[JsonSerializable(typeof(RunListItem[]))]
[JsonSerializable(typeof(ComparisonView))]
[JsonSerializable(typeof(RunResult))]
[JsonSerializable(typeof(WireFile))]
[JsonSerializable(typeof(ErrorView))]
[JsonSerializable(typeof(FaultResponse))]
internal sealed partial class SidecarJson : JsonSerializerContext;
