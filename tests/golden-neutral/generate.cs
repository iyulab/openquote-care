// Materializes the neutral golden vault from the hand-written scenario.
//
//   dotnet run generate.cs
//
// Inputs:  scenario/*.csv, scenario/expected-totals.json, and the app's `care` and `en` packs (../../packs)
// Outputs: steps/1/ (vault files), expected/*.json
//
// The vault is what a vault made on the neutral English track holds: the two packs, copied as the
// app copies them, and the changes a counsellor's sessions write. Ids are UUIDv7 built from each
// change's timestamp plus a hash of its scenario key, so re-running writes identical files. The
// expected report runs and export rows are laid out straight from the scenario rows and checked
// against the hand-computed counts in expected-totals.json; any disagreement fails the run instead
// of writing files.

using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

var root = Path.GetDirectoryName(Path.GetFullPath(AppContext.GetData("EntryPointFilePath") as string ?? "generate.cs"))!;
var inv = CultureInfo.InvariantCulture;
DateTimeOffset At(string text) => DateTimeOffset.Parse(text, inv);
DateOnly Day(string text) => DateOnly.Parse(text, inv);
var scenario = Path.Combine(root, "scenario");
var packs = Path.GetFullPath(Path.Combine(root, "..", "..", "packs"));
var stepDir = Path.Combine(root, "steps", "1");
var expectedDir = Path.Combine(root, "expected");
string[] trackPacks = ["care", "en"];

var practitioners = Csv.Read(Path.Combine(scenario, "practitioners.csv"));
var subjects = Csv.Read(Path.Combine(scenario, "subjects.csv"));
var groups = Csv.Read(Path.Combine(scenario, "groups.csv"));
var sessions = Csv.Read(Path.Combine(scenario, "sessions.csv"));

var ids = new Dictionary<string, string>();
string IdOf(string key) => ids[key];
string NewId(string key, DateTimeOffset at) => ids[key] = Uuid7.Deterministic(at, "openquote-golden-neutral:" + key);

var changes = new List<Change>();

foreach (var p in practitioners)
{
    var at = At(p["created_at"]);
    var id = NewId(p["key"], at);
    changes.Add(new Change(id, p["device"], at, "practitioner", id, "practitioners", new JsonObject { ["name"] = p["name"] }));
}

foreach (var s in subjects)
{
    var at = At(s["created_at"]);
    var id = NewId(s["key"], at);
    changes.Add(new Change(id, s["device"], at, "subject", id, $"subjects/{id}", new JsonObject
    {
        ["name"] = s["name"],
        ["mgmt_no"] = Optional(s["mgmt_no"]),
        ["gender"] = Optional(s["gender"]),
        ["phone"] = Optional(s["phone"]),
    }));
}

foreach (var g in groups)
{
    var at = At(g["created_at"]);
    var id = NewId(g["key"], at);
    changes.Add(new Change(id, g["device"], at, "group", id, $"groups/{id}", new JsonObject
    {
        ["name"] = g["name"],
        ["members"] = Ids(g["members"].Split(' ').Select(IdOf)),
    }));
}

// A group session is kept in its group's folder and names its attendees; any other in its subject's.
string[] PeopleOf(Dictionary<string, string> s) =>
    s["group"] != "" ? [.. s["attendees"].Split(' ').Select(IdOf)] : [IdOf(s["subject"])];

foreach (var s in sessions)
{
    var at = At(s["entered_at"]);
    var id = NewId(s["key"], at);
    var fields = new JsonObject
    {
        ["date"] = s["date"],
        ["practitioner"] = IdOf(s["practitioner"]),
        ["concern"] = s["concern"] == "" ? null : Coded("care.concern", s["concern"]),
        ["mode"] = s["mode"] == "" ? null : Coded("care.mode", s["mode"]),
        ["note"] = Optional(s["note"]),
    };
    if (s["group"] != "") fields["attendees"] = Ids(PeopleOf(s));
    var folder = s["group"] != "" ? $"groups/{IdOf(s["group"])}" : $"subjects/{IdOf(s["subject"])}";
    changes.Add(new Change(id, s["device"], at, "session", id, folder, fields));
}

// ---- expected, laid out from the scenario rows ----

var hand = JsonNode.Parse(File.ReadAllText(Path.Combine(scenario, "expected-totals.json")))!;
var problems = new List<string>();
void Expect(string name, string what, int want, int got)
{
    if (want != got) problems.Add($"{name}: {what} hand={want} scenario={got}");
}
string KeyOf(string id) => ids.First(kv => kv.Value == id).Key;

List<Dictionary<string, string>> InMonth(string month) =>
    [.. sessions.Where(s => s["date"].StartsWith(month + "-", StringComparison.Ordinal))];

JsonObject Report(string name, string month)
{
    var from = Day(month + "-01");
    var to = from.AddMonths(1).AddDays(-1);
    var cells = new SortedDictionary<(string Row, string Column), List<string>>();
    var blank = new List<string>();
    var people = new Dictionary<string, string[]>();
    foreach (var s in InMonth(month))
    {
        var id = IdOf(s["key"]);
        people[id] = PeopleOf(s);
        if (s["concern"] == "") { blank.Add(id); continue; }
        var key = (s["concern"], IdOf(s["practitioner"]));
        if (!cells.TryGetValue(key, out var list)) cells[key] = list = [];
        list.Add(id);
    }

    var h = hand[name]!;
    var want = new SortedDictionary<(string, string), int>();
    foreach (var (row, byPractitioner) in h["cells"]!.AsObject())
        foreach (var (practitioner, n) in byPractitioner!.AsObject())
            want[(row, IdOf(practitioner))] = n!.GetValue<int>();
    var got = cells.ToDictionary(kv => kv.Key, kv => kv.Value.Count);
    foreach (var k in want.Keys.Union(got.Keys))
    {
        want.TryGetValue(k, out var w);
        got.TryGetValue(k, out var g);
        if (w != g) problems.Add($"{name}: cell {k.Item1}/{KeyOf(k.Item2)} hand={w} scenario={g}");
    }
    Expect(name, "unmapped", h["unmapped"]!.GetValue<int>(), 0);
    Expect(name, "blank", h["blank"]?.GetValue<int>() ?? 0, blank.Count);
    Expect(name, "total", h["total"]!.GetValue<int>(), people.Count);
    Expect(name, "people", h["people"]!.GetValue<int>(), people.Values.SelectMany(p => p).Distinct().Count());

    // A session with no concern has no value to count: it is blank, listed apart from every cell and
    // from unmapped, which only a format 1 run record does — a run with none stays format 0.
    var v1 = blank.Count > 0;
    var run = new JsonObject
    {
        ["format"] = v1 ? "openquote.run/1" : "openquote.run/0",
        ["report"] = new JsonObject { ["report"] = "care.monthly-concern", ["version"] = 1 },
        ["schemes"] = new JsonObject { ["care.concern"] = new JsonObject { ["version"] = 1 } },
        ["period"] = new JsonObject { ["from"] = from.ToString("yyyy-MM-dd", inv), ["to"] = to.ToString("yyyy-MM-dd", inv) },
        ["cells"] = new JsonArray([.. cells.Select(kv => (JsonNode)(v1
            ? new JsonObject
            {
                ["key"] = new JsonArray(kv.Key.Row, kv.Key.Column),
                ["count"] = kv.Value.Count,
                ["records"] = Ids(kv.Value),
            }
            : new JsonObject
            {
                ["row"] = kv.Key.Row,
                ["column"] = kv.Key.Column,
                ["count"] = kv.Value.Count,
                ["records"] = Ids(kv.Value),
            }))]),
        ["pending"] = Set([]),
        ["unmapped"] = Set([]),
        ["total"] = Set([.. people.Keys]),
        ["people"] = new JsonObject(people.OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)Ids(kv.Value)))),
    };
    if (v1)
    {
        run.Insert(run.IndexOf("total"), "blank", Set(blank));
        run.Insert(run.IndexOf("total"), "conflicted", Set([]));
    }
    return run;
}

// The session list form of the `care` pack: date, clients, people, concern, mode, practitioner — by
// date, then record id. A classified cell shows its scheme item's label; an empty one stays empty.
string LabelIn(string scheme, string code)
{
    var file = JsonNode.Parse(File.ReadAllText(Path.Combine(packs, "care", "schemes", scheme, "v1.json")))!;
    return file["items"]!.AsArray().Single(i => i!["code"]!.GetValue<string>() == code)!["label"]!.GetValue<string>();
}
string NameOf(string key) =>
    practitioners.Concat(subjects).Single(r => r["key"] == key)["name"];

JsonObject Export(string name, string month)
{
    var rows = InMonth(month)
        .Select(s => (Date: s["date"], Id: IdOf(s["key"]), Row: s))
        .OrderBy(x => x.Date, StringComparer.Ordinal).ThenBy(x => x.Id, StringComparer.Ordinal)
        .Select(x =>
        {
            var people = PeopleOf(x.Row).Order(StringComparer.Ordinal).ToArray();
            return (Id: x.Id, People: people.Length, Cells: new[]
            {
                x.Date,
                string.Join(", ", people.Select(p => NameOf(KeyOf(p)))),
                people.Length.ToString(inv),
                x.Row["concern"] == "" ? "" : LabelIn("care.concern", x.Row["concern"]),
                x.Row["mode"] == "" ? "" : LabelIn("care.mode", x.Row["mode"]),
                NameOf(x.Row["practitioner"]),
            });
        })
        .ToList();
    var h = hand[name]!;
    Expect(name, "rows", h["rows"]!.GetValue<int>(), rows.Count);
    Expect(name, "people", h["people"]!.GetValue<int>(), rows.Sum(r => r.People));
    var from = Day(month + "-01");
    return new JsonObject
    {
        ["export"] = new JsonObject { ["export"] = "care.session-list", ["version"] = 1 },
        ["period"] = new JsonObject { ["from"] = from.ToString("yyyy-MM-dd", inv), ["to"] = from.AddMonths(1).AddDays(-1).ToString("yyyy-MM-dd", inv) },
        ["rows"] = new JsonArray([.. rows.Select(r => (JsonNode)new JsonObject
        {
            ["record"] = r.Id,
            ["cells"] = new JsonArray([.. r.Cells.Select(c => (JsonNode)JsonValue.Create(c)!)]),
        })]),
    };
}

var reports = new Dictionary<string, JsonObject>();
foreach (var name in new[] { "r1", "r2", "r3" })
    reports[name] = Report(name, hand[name]!["month"]!.GetValue<string>());
var export = Export("export-1", hand["export-1"]!["month"]!.GetValue<string>());

if (problems.Count > 0)
{
    Console.Error.WriteLine("Scenario disagrees with expected-totals.json:");
    foreach (var p in problems) Console.Error.WriteLine("  " + p);
    return 1;
}

// ---- write ----

foreach (var dir in new[] { Path.Combine(root, "steps"), expectedDir })
    if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);

// The packs the neutral English track starts from, copied into the vault as the app copies them.
foreach (var pack in trackPacks)
    CopyTree(Path.Combine(packs, pack), stepDir);
Write(Path.Combine(stepDir, "vault.json"), new JsonObject { ["format"] = "openquote.vault/0", ["encryption"] = "none" });

foreach (var c in changes.OrderBy(c => c.Id, StringComparer.Ordinal))
    Write(Path.Combine(stepDir, c.Folder, $"{c.Id}.{c.Device}.json"), c.ToJson());

foreach (var (name, report) in reports) Write(Path.Combine(expectedDir, $"{name}.json"), report);
Write(Path.Combine(expectedDir, "export-1.json"), export);
Write(Path.Combine(expectedDir, "keys.json"),
    new JsonObject(ids.OrderBy(kv => kv.Key, StringComparer.Ordinal)
        .Select(kv => KeyValuePair.Create(kv.Value, (JsonNode?)JsonValue.Create(kv.Key)))));

Console.WriteLine($"{changes.Count} changes, packs {string.Join(" + ", trackPacks)}, {reports.Count} reports, 1 export.");
return 0;

// ---- helpers ----

static JsonObject Coded(string scheme, string code) => new() { ["scheme"] = scheme, ["version"] = 1, ["code"] = code };

static JsonNode? Optional(string value) => value == "" ? null : JsonValue.Create(value);

static JsonArray Ids(IEnumerable<string> ids) =>
    new([.. ids.Order(StringComparer.Ordinal).Select(i => (JsonNode)JsonValue.Create(i)!)]);

static JsonObject Set(List<string> ids) => new() { ["count"] = ids.Count, ["records"] = Ids(ids) };

static string EnsureDir(string path)
{
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    return path;
}

static void Write(string path, JsonNode node) =>
    File.WriteAllText(EnsureDir(path), node.ToJsonString(new JsonSerializerOptions
    {
        WriteIndented = true,
        NewLine = "\n",
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    }) + "\n", new UTF8Encoding(false));

static void CopyTree(string from, string to)
{
    foreach (var file in Directory.GetFiles(from, "*", SearchOption.AllDirectories))
        File.Copy(file, EnsureDir(Path.Combine(to, Path.GetRelativePath(from, file))));
}

sealed record Change(string Id, string Device, DateTimeOffset At, string Entity, string EntityId, string Folder, JsonObject Fields)
{
    public JsonObject ToJson() => new()
    {
        ["format"] = "openquote.change/0",
        ["id"] = Id,
        ["device"] = Device,
        ["at"] = At.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
        ["entity"] = new JsonObject { ["type"] = Entity, ["id"] = EntityId },
        ["op"] = "create",
        ["base"] = new JsonArray(),
        ["fields"] = Fields.DeepClone(),
    };
}

static class Uuid7
{
    // RFC 9562 UUIDv7 with the random bits taken from a hash of the seed, so the same
    // (timestamp, seed) always yields the same id.
    public static string Deterministic(DateTimeOffset at, string seed)
    {
        var ms = at.ToUnixTimeMilliseconds();
        var h = SHA256.HashData(Encoding.UTF8.GetBytes(seed));
        Span<byte> b = stackalloc byte[16];
        for (var i = 0; i < 6; i++) b[i] = (byte)(ms >> (8 * (5 - i)));
        b[6] = (byte)(0x70 | (h[0] & 0x0F));
        b[7] = h[1];
        b[8] = (byte)(0x80 | (h[2] & 0x3F));
        h.AsSpan(3, 7).CopyTo(b[9..]);
        var hex = Convert.ToHexStringLower(b);
        return $"{hex[..8]}-{hex[8..12]}-{hex[12..16]}-{hex[16..20]}-{hex[20..]}";
    }
}

static class Csv
{
    // The scenario CSVs never quote or embed commas, so a plain split is enough.
    public static List<Dictionary<string, string>> Read(string path)
    {
        var lines = File.ReadAllLines(path).Where(l => l.Length > 0).ToArray();
        var header = lines[0].Split(',');
        return [.. lines.Skip(1).Select(line =>
        {
            var cols = line.Split(',');
            if (cols.Length != header.Length)
                throw new FormatException($"{Path.GetFileName(path)}: expected {header.Length} columns: {line}");
            return header.Zip(cols).ToDictionary(p => p.First, p => p.Second);
        })];
    }
}
