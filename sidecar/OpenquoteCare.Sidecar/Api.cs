using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Nodes;
using Openquote.Classification;
using Openquote.Exports;
using Openquote.Fields;
using Openquote.Packs;
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


/// <param name="Source">Per field, where its value came from (<c>manual</c> or <c>suggestion</c>); a field without an entry is <c>manual</c>.</param>
public sealed record CreateInSubjectRequest(string SubjectId, string Type, Dictionary<string, JsonNode?> Fields, Dictionary<string, string>? Source = null);

/// <param name="Source">As for <see cref="CreateInSubjectRequest"/>.</param>
public sealed record CreateInGroupRequest(string GroupId, string Type, Dictionary<string, JsonNode?> Fields, Dictionary<string, string>? Source = null);

public sealed record DeviceNameRequest(string Name);

public sealed record UpdateRequest(string Type, string Id, Dictionary<string, JsonNode?> Fields);

/// <param name="Value">The code a person chose, in the scheme version the record waits in.</param>
public sealed record ReclassifyRequest(string Type, string Id, string Field, CodedValue Value);

/// <summary>The pending records of a run of a report form, by id.</summary>
/// <param name="To">The last day of the period the run covered (<c>YYYY-MM-DD</c>): a form counting in the
/// version in force waits in the version in force that day. Today when left out.</param>
public sealed record PendingRequest(string Report, int Version, IReadOnlyList<string> Records, string? To = null);

public sealed record CompareRequest(string Earlier, string Later);

/// <summary>A run of a report form over a period.</summary>
/// <param name="From">The first day of the period (<c>YYYY-MM-DD</c>) — or, without <paramref name="To"/>, a day in it: the run then
/// covers the period of the form's unit that holds that day (its day, month or year). A form run over a range a person picks needs both.</param>
/// <param name="To">The last day of the period (<c>YYYY-MM-DD</c>), when the run covers exactly the days given.</param>
public sealed record RunRequest(string Report, int Version, string From, string? To = null);

public sealed record ExportRequest(string Export, int Version, int Year, int Month);

/// <summary>A scheme and the date a value is entered for.</summary>
public sealed record InForceRequest(string Scheme, DateOnly Date);

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
    IReadOnlyList<UnreadableView> Unreadable,
    IReadOnlyList<PackView> Packs,
    IReadOnlyList<PackIssueView> PackIssues,
    IReadOnlyList<FieldIssueView> FieldIssues,
    IReadOnlyList<LabelConflictView> LabelConflicts,
    IReadOnlyList<string> Locales);

/// <summary>A data pack the vault holds (its latest version).</summary>
public sealed record PackView(string Id, int Version, string Label, IReadOnlyDictionary<string, int> Depends);

/// <summary>How the vault's packs do not fit together: a missing or older dependency, a missing or shared file, a cycle.</summary>
public sealed record PackIssueView(string Kind, string Pack, string Detail);

/// <summary>A field definition the vault's packs disagree on or cannot apply.</summary>
public sealed record FieldIssueView(string Kind, string Type, string Field, string Detail);

/// <summary>Packs that label the same thing differently in one locale, none of them building on the others.</summary>
public sealed record LabelConflictView(string Locale, string Target, IReadOnlyList<string> Packs);

/// <summary>A scheme version no crosswalk leads to from an earlier version of the same scheme.</summary>
public sealed record SchemeVersionView(string Scheme, int Version);

/// <param name="Label">What people call the form, in the vault's locale.</param>
/// <param name="Offered">False when a column reads a field the vault's packs hide: the form is not offered.</param>
public sealed record ExportView(string Name, int Version, string Label, string Rows, string PeriodField, IReadOnlyList<SchemeLagView> Behind, bool Offered);

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
    IReadOnlyList<string> Unmapped,
    IReadOnlyList<string> Conflicted,
    IReadOnlyList<string> Withheld);

/// <summary>
/// One way a report form places what it counts. <c>Scheme</c> and <c>Version</c> are set for a
/// classified dimension; <c>Version</c> is null when it counts in the version in force.
/// </summary>
public sealed record DimensionView(string Field, string? Scheme, int? Version, bool OfSubject, bool All);

/// <summary>A condition of a report form: the field it reads, as a dimension does, and the codes or string values it lets through.</summary>
public sealed record FilterView(string Field, string? Scheme, int? Version, bool OfSubject, IReadOnlyList<string> In);

/// <param name="Label">What people call the form, in the vault's locale.</param>
/// <param name="Unit">The period the form is run over: <c>day</c>, <c>month</c>, <c>year</c> or <c>range</c>.</param>
/// <param name="StartMonth">The month a year starts in (1–12): 3 for a school year from March. 1 for every other unit.</param>
/// <param name="Dimensions">The dimensions a cell's key is made of, in key order.</param>
/// <param name="Measures">The numbers the form shows: <c>records</c>, <c>people</c>, <c>visits</c>.</param>
/// <param name="Filters">The conditions every record the form counts meets.</param>
/// <param name="Offered">False when a dimension or filter reads a field the vault's packs hide: the form is not offered.</param>
public sealed record ReportView(
    string Name,
    int Version,
    string Label,
    string Counts,
    string PeriodField,
    string Unit,
    int StartMonth,
    IReadOnlyList<DimensionView> Dimensions,
    IReadOnlyList<string> Measures,
    IReadOnlyList<FilterView> Filters,
    IReadOnlyList<SchemeLagView> Behind,
    bool Offered);

/// <summary>
/// A field of an entity type as the vault's packs declare it, with its label and the other names it goes by
/// resolved in the vault's locales. <c>Kind</c> is <c>text</c>, <c>date</c>, <c>number</c>, <c>coded</c>,
/// <c>reference</c> or <c>references</c>; <c>Tier</c> is <c>structured</c> or <c>narrative</c>. <c>Many</c> is true
/// for a coded field that takes several values, one of them primary.
/// </summary>
public sealed record FieldView(
    string Name,
    string Kind,
    string? Scheme,
    string? RefType,
    bool Required,
    bool Hidden,
    string Tier,
    string? DefaultFromSubject,
    string Label,
    IReadOnlyList<string> Aliases,
    bool Many);

/// <summary>The scheme version in force on a date, or null when the vault holds none.</summary>
public sealed record InForceView(int? Version);

/// <summary>A file that could not be used: why, and what it was for (read from its path).</summary>
public sealed record UnreadableView(string Path, string Reason, string Detail, VaultFileKind Kind);

public sealed record EntityView(
    string Type,
    string Id,
    string? Subject,
    string? Group,
    IReadOnlyList<string> People,
    IReadOnlyDictionary<string, JsonElement> Fields,
    IReadOnlyDictionary<string, IReadOnlyList<HeadView>> Conflicts,
    IReadOnlyList<string> MissingBase);

public sealed record HeadView(string ChangeId, string Device, JsonElement Value);

/// <summary>The changes an entity was built from, oldest first.</summary>
public sealed record EntityHistoryView(string Id, IReadOnlyList<ChangeView> Changes);

/// <summary>One change file: who wrote it, when, what it did, the fields it set, and where a value it set came from when not from a person typing or picking it.</summary>
public sealed record ChangeView(string Id, string Device, DateTimeOffset At, string Op, IReadOnlyDictionary<string, JsonElement> Fields, IReadOnlyDictionary<string, string> Source);

public sealed record SchemeView(string Scheme, int Version, IReadOnlyList<SchemeItem> Items);

/// <summary>A record waiting for a person: the field and value the form carries, and the codes to choose from.</summary>
public sealed record PendingView(string Record, string Field, string Scheme, int Version, JsonElement? Was, IReadOnlyList<string> Candidates);

public sealed record RunListItem(string Id, string Device, string At, RunReportRef Report, PeriodView Period, int Total);

public sealed record RunReportRef(string Name, int Version);

public sealed record PeriodView(string From, string To);

public sealed record ComparisonView(
    JsonNode Earlier,
    JsonNode Later,
    IReadOnlyList<string> Late,
    IReadOnlyList<string> Removed,
    IReadOnlyList<string> Revised,
    IReadOnlyList<string> Settled,
    IReadOnlyList<string> Moved,
    IReadOnlyList<string> Unchanged);

public sealed record RunResult(JsonNode? Record, WireFile File);

public sealed record ErrorView(string Error);

/// <summary>The earliest vault format the vault needs, as it is and with the files asked about.</summary>
public sealed record RequiredView(int Now, int With);

/// <summary>The HTTP surface the shell calls. The sidecar never touches the disk: files come in as
/// plaintext from the host, and every change it makes is handed back as a file for the host to
/// encrypt, create, and then add.</summary>
internal static class Api
{
    public static void Map(WebApplication app, string device, TimeProvider clock)
    {
        var writer = new VaultWriter(device, clock);

        // What vault format writing these files would call for: a host raises the declaration first,
        // only once a person has chosen to, so earlier apps refuse the folder rather than miscount it.
        app.MapPost("/vault/required", (FilesRequest request, VaultSession session) =>
            new RequiredView(session.Current.Content.RequiredVersion, session.RequiredWith(request.Files.Select(f => f.ToVaultFile()))));

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

        // Every change each entity of a type was built from, oldest first: read for a copy of the
        // records that keeps their history, not for each screen.
        app.MapGet("/entities/{type}/history", (string type, VaultSession session) =>
            session.Current.Entities.Values
                .Where(e => e.Reference.Type == type && !e.Destroyed)
                .OrderBy(e => e.Reference.Id, StringComparer.Ordinal)
                .Select(e => new EntityHistoryView(
                    e.Reference.Id,
                    [.. e.Changes
                        .OrderBy(c => c.At)
                        .ThenBy(c => c.Id, StringComparer.Ordinal)
                        .Select(c => new ChangeView(c.Id, c.Device, c.At, c.Op.ToString().ToLowerInvariant(), c.Fields, c.Source))]))
                .ToArray());

        app.MapGet("/summary", (VaultSession session) => Summary(device, session.Current));

        // Items are named in the vault's locale: a label a pack gives, else the item's own.
        app.MapGet("/schemes", (VaultSession session) =>
        {
            var snapshot = session.Current;
            return snapshot.Content.Schemes
                .OrderBy(s => s.Name, StringComparer.Ordinal).ThenBy(s => s.Version)
                .Select(s => new SchemeView(s.Name, s.Version, [.. s.Items.Select(i =>
                    i with { Label = snapshot.Labels.SchemeLabel(s.Name, s.Version, i.Code, snapshot.Locales) ?? i.Label })]))
                .ToArray();
        });

        app.MapPost("/schemes/in-force", (InForceRequest request, VaultSession session) =>
            new InForceView(session.Current.Content.Catalog().InForce(request.Scheme, request.Date)?.Version));

        // The fields the vault's packs declare for a type, in declaration order; none for a vault without field definitions.
        app.MapGet("/fields/{type}", (string type, VaultSession session) =>
        {
            var snapshot = session.Current;
            return snapshot.Fields.For(type)
                .Select(f => new FieldView(
                    f.Name,
                    f.Kind.ToString().ToLowerInvariant(),
                    f.Scheme,
                    f.RefType,
                    f.Required,
                    f.Hidden,
                    f.Tier.ToString().ToLowerInvariant(),
                    f.DefaultFromSubject,
                    snapshot.Labels.FieldLabel(type, f.Name, snapshot.Locales) ?? f.Label ?? f.Name,
                    snapshot.Labels.FieldAliases(type, f.Name, snapshot.Locales),
                    f.Many))
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
            // The engine refuses two runs that do not count the same thing over the same period.
            ReportDiff diff;
            try
            {
                diff = ReportDiff.Compare(earlier.Run, later.Run, session.Current.Content.Catalog());
            }
            catch (ArgumentException e)
            {
                return Results.UnprocessableEntity(new ErrorView(e.Message));
            }
            return Results.Ok(new ComparisonView(
                RunView(earlier), RunView(later), diff.Late, diff.Removed, diff.Revised, diff.Settled, diff.Moved, diff.Unchanged));
        });

        app.MapPost("/changes/subject", (CreateSubjectRequest request) =>
            WireFile.From(writer.CreateSubject(request.Fields)));

        app.MapPost("/changes/practitioner", (CreateSubjectRequest request) =>
            WireFile.From(writer.CreatePractitioner(request.Fields)));

        app.MapPost("/changes/in-subject", (CreateInSubjectRequest request) =>
            WireFile.From(writer.CreateInSubject(request.SubjectId, request.Type, request.Fields, request.Source)));

        app.MapPost("/changes/group", (CreateSubjectRequest request) =>
            WireFile.From(writer.CreateGroup(request.Fields)));

        app.MapPost("/changes/in-group", (CreateInGroupRequest request) =>
            WireFile.From(writer.CreateInGroup(request.GroupId, request.Type, request.Fields, request.Source)));

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

        // The engine accepts only a code the record is waiting for; a stale screen or another
        // device's view that offers anything else is answered, not written.
        app.MapPost("/changes/reclassify", (ReclassifyRequest request, VaultSession session) =>
        {
            if (Find(session, request.Type, request.Id) is not { } entity) return Results.NotFound();
            try
            {
                return Results.Ok(WireFile.From(writer.Reclassify(entity, request.Field, request.Value, session.Current.Content.Catalog())));
            }
            catch (ArgumentException e)
            {
                return Results.UnprocessableEntity(new ErrorView(e.Message));
            }
        });

        // Where each pending record of a form's run waits, by the engine's own rule — the screen
        // never carries values itself. A record waits in the first classified dimension of the
        // record that is pending for it; one no longer pending (chosen since) is left out.
        app.MapPost("/reports/pending", (PendingRequest request, VaultSession session) =>
        {
            var snapshot = session.Current;
            var report = snapshot.Content.Reports.SingleOrDefault(r => r.Name == request.Report && r.Version == request.Version);
            if (report is null) return Results.NotFound();
            var catalog = snapshot.Content.Catalog();
            var to = request.To is { } day ? DateOnly.ParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture) : DateOnly.FromDateTime(DateTime.Today);
            if (report.For(to, catalog) is not { } form) return Results.Ok(Array.Empty<PendingView>());
            var classified = form.Dimensions.Where(d => d.Classified && !d.OfSubject).ToArray();
            return Results.Ok(request.Records
                .Select(id => snapshot.Entities.GetValueOrDefault(new EntityRef(report.Counts, id)))
                .OfType<Entity>()
                .Select(e => classified
                    .Select(d => (Entity: e, Dimension: d, Resolution: e.Classify(d.Field, d.Scheme!, d.Version!.Value, catalog)))
                    .FirstOrDefault(x => x.Resolution.Kind == ResolutionKind.Pending))
                .Where(x => x.Entity is not null)
                .Select(x => new PendingView(x.Entity.Reference.Id, x.Dimension.Field, x.Dimension.Scheme!, x.Dimension.Version!.Value,
                    x.Entity.LatestValue(x.Dimension.Field, v => CodedValues.From(v) is { } c
                        && c.Values.Any(value => catalog.Reaches(value, x.Dimension.Scheme!, x.Dimension.Version!.Value))),
                    x.Resolution.Candidates))
                .ToArray());
        });

        app.MapPost("/reports/run", (RunRequest request, VaultSession session) =>
        {
            var snapshot = session.Current;
            var report = snapshot.Content.Reports.SingleOrDefault(r => r.Name == request.Report && r.Version == request.Version);
            if (report is null) return Results.NotFound();
            if (!DateOnly.TryParseExact(request.From, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var from))
                return Results.BadRequest();
            ReportRun run;
            if (request.To is null)
            {
                if (report.Period.Unit == PeriodUnit.Range) return Results.BadRequest(); // its days are the ones a person picks
                run = ReportRunner.RunContaining(report, from, snapshot.Entities.Values, snapshot.Content.Catalog());
            }
            else
            {
                if (!DateOnly.TryParseExact(request.To, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var to) || to < from)
                    return Results.BadRequest();
                run = ReportRunner.Run(report, from, to, snapshot.Entities.Values, snapshot.Content.Catalog());
            }
            var file = writer.RunRecord(run);
            return Results.Ok(new RunResult(JsonNode.Parse(file.Content.Span), WireFile.From(file)));
        });

        // Candidates for the coded fields of a record being entered — a person takes or leaves them;
        // nothing is filled in or kept.
        app.MapPost("/suggestions", (SuggestRequest request, Suggestions suggestions, CancellationToken cancellationToken) =>
            suggestions.SuggestAsync(request, cancellationToken));

        // Lays one month's records out as an export form's rows. Nothing is kept: the rows go to
        // the person, who takes them to the outside form.
        app.MapPost("/exports/run", (ExportRequest request, VaultSession session) =>
        {
            var snapshot = session.Current;
            var export = snapshot.Content.Exports.SingleOrDefault(e => e.Name == request.Export && e.Version == request.Version);
            if (export is null) return Results.NotFound();
            var from = new DateOnly(request.Year, request.Month, 1);
            var table = ExportRunner.Run(export, from, from.AddMonths(1).AddDays(-1), snapshot.Entities.Values, snapshot.Content.Catalog(),
                snapshot.Content.FieldCatalog());
            return Results.Ok(new ExportTableView(
                export.Name,
                export.Version,
                table.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                table.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                [.. export.Columns.Select((c, i) => snapshot.Labels.ExportColumnLabel(export.Name, export.Version, i, snapshot.Locales) ?? c.Label)],
                [.. table.Rows.Select(r => new ExportRowView(r.Record, r.Cells))],
                table.Pending,
                table.Unmapped,
                table.Conflicted,
                table.Withheld));
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
            [.. s.Content.Reports.Select(r => new ReportView(r.Name, r.Version,
                s.Labels.ReportLabel(r.Name, r.Version, s.Locales) ?? r.Label, r.Counts, r.Period.Field, UnitOf(r.Period.Unit), r.Period.StartMonth,
                [.. r.Dimensions.Select(d => new DimensionView(d.Field, d.Scheme, d.Version, d.OfSubject, d.All))],
                [.. r.Measures.Select(m => m.ToString().ToLowerInvariant())],
                [.. r.Filters.Select(f => new FilterView(f.On.Field, f.On.Scheme, f.On.Version, f.On.OfSubject, f.In))],
                Behind(r.Schemes.Where(x => r.VersionOf(x) is not null).Select(x => (x, r.VersionOf(x)!.Value)), latest),
                !r.Dimensions.Concat(r.Filters.Select(f => f.On)).Any(d => Hidden(s.Fields, d.OfSubject ? "subject" : r.Counts, d.Field))))],
            [.. s.Content.Exports.Select(e => new ExportView(e.Name, e.Version,
                s.Labels.ExportLabel(e.Name, e.Version, s.Locales) ?? e.Label, e.Rows, e.PeriodField,
                Behind(e.Columns.OfType<CodedColumn>().Select(c => (c.Scheme, c.Version)), latest),
                !e.Columns.Any(c => ReadsHidden(s.Fields, e.Rows, c))))],
            Unlinked(s.Content),
            [.. s.Content.Unreadable.Select(u => new UnreadableView(u.Path, u.Reason.ToString(), u.Detail, u.Kind))
                .Concat(s.Undecryptable.Select(u => new UnreadableView(u.Path, "Undecryptable", u.Detail, VaultFileKind.Of(u.Plain))))
                .OrderBy(u => u.Path, StringComparer.Ordinal)],
            [.. new PackGraph(s.Content.Packs).Latest.OrderBy(p => p.Id, StringComparer.Ordinal)
                .Select(p => new PackView(p.Id, p.Version, p.Label, p.Depends))],
            [.. s.Content.CheckPacks().Select(i => new PackIssueView(i.Kind.ToString(), i.Pack, i.Detail))],
            [.. s.Fields.Issues.Select(i => new FieldIssueView(i.Kind.ToString(), i.Type, i.Field, i.Detail))],
            [.. s.Labels.Conflicts.Select(c => new LabelConflictView(c.Locale, c.Target, c.Packs))],
            s.Locales);
    }

    // A form standing on a field the packs hide is not offered: hiding a field hides what is built on it.
    private static string UnitOf(PeriodUnit unit) => unit switch
    {
        PeriodUnit.Day => "day",
        PeriodUnit.Year => "year",
        PeriodUnit.Range => "range",
        _ => "month",
    };

    private static bool Hidden(FieldCatalog fields, string type, string? field) =>
        field is not null && fields.Find(type, field) is { Hidden: true };

    private static bool ReadsHidden(FieldCatalog fields, string rows, ExportColumn column) => column switch
    {
        FieldColumn c => Hidden(fields, rows, c.Field),
        CodedColumn c => Hidden(fields, rows, c.Field),
        ReferenceColumn c => Hidden(fields, rows, c.Field),
        YearColumn c => Hidden(fields, rows, c.Field),
        PersonColumn c => Hidden(fields, "subject", c.Field),
        _ => false,
    };

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
            c => (IReadOnlyList<HeadView>)[.. c.Value.Select(h => new HeadView(h.ChangeId, h.Device, h.Value))]),
        e.MissingBase);
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
[JsonSerializable(typeof(PendingRequest))]
[JsonSerializable(typeof(CompareRequest))]
[JsonSerializable(typeof(RunRequest))]
[JsonSerializable(typeof(ExportRequest))]
[JsonSerializable(typeof(InForceRequest))]
[JsonSerializable(typeof(SuggestRequest))]
[JsonSerializable(typeof(SuggestionsView))]
[JsonSerializable(typeof(InForceView))]
[JsonSerializable(typeof(FieldView[]))]
[JsonSerializable(typeof(ExportTableView))]
[JsonSerializable(typeof(SummaryView))]
[JsonSerializable(typeof(EntityView[]))]
[JsonSerializable(typeof(EntityHistoryView[]))]
[JsonSerializable(typeof(SchemeView[]))]
[JsonSerializable(typeof(PendingView[]))]
[JsonSerializable(typeof(RunListItem[]))]
[JsonSerializable(typeof(ComparisonView))]
[JsonSerializable(typeof(RunResult))]
[JsonSerializable(typeof(WireFile))]
[JsonSerializable(typeof(ErrorView))]
[JsonSerializable(typeof(RequiredView))]
internal sealed partial class SidecarJson : JsonSerializerContext;
