// Materializes the golden vault from the hand-written scenario.
//
//   dotnet run generate.cs
//
// Inputs:  scenario/*.csv, scenario/static/<step>/, scenario/expected-totals.json
// Outputs: steps/<step>/ (vault files), expected/*.json
//
// Output is deterministic: ids are UUIDv7 built from each change's timestamp plus a hash of its
// scenario key, so re-running must produce byte-identical files. The expected report files are
// grouped straight from the scenario rows (their expect_v2 / reclassify_to columns are written by
// hand) and checked against the hand-computed counts in expected-totals.json; any disagreement fails
// the run instead of writing files.

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
var stepsDir = Path.Combine(root, "steps");
var expectedDir = Path.Combine(root, "expected");
var invalidDir = Path.Combine(root, "invalid");

// Report runs close each step: a change belongs to the first step whose run it precedes.
DateTimeOffset[] runAt =
[
    At("2026-05-04T09:00:00+09:00"), // r1, end of step 1
    At("2026-06-01T09:00:00+09:00"), // r2, end of step 2
    At("2026-06-04T09:00:00+09:00"), // r3, end of step 3
];
int StepOf(DateTimeOffset at)
{
    for (var i = 0; i < runAt.Length; i++)
        if (at < runAt[i]) return i + 1;
    throw new InvalidOperationException($"change at {at:o} is after the last report run");
}

var counselors = Csv.Read(Path.Combine(scenario, "counselors.csv"));
var subjects = Csv.Read(Path.Combine(scenario, "subjects.csv"));
var cases = Csv.Read(Path.Combine(scenario, "cases.csv"));
var sessions = Csv.Read(Path.Combine(scenario, "sessions.csv"));
var edits = Csv.Read(Path.Combine(scenario, "edits.csv"));

var ids = new Dictionary<string, string>();
string IdOf(string key) => ids[key];
string NewId(string key, DateTimeOffset at) => ids[key] = Uuid7.Deterministic(at, "openquote-golden:" + key);

var changes = new List<Change>();

foreach (var c in counselors)
{
    var at = At(c["created_at"]);
    var id = NewId(c["key"], at);
    changes.Add(new Change(id, c["device"], at, "practitioner", id, "create", [], "practitioners",
        new JsonObject { ["name"] = c["name"] }));
}

foreach (var s in subjects)
{
    var at = At(s["created_at"]);
    var id = NewId(s["key"], at);
    changes.Add(new Change(id, s["device"], at, "subject", id, "create", [], $"subjects/{id}", new JsonObject
    {
        ["mgmt_no"] = s["mgmt_no"],
        ["name"] = s["name"],
        ["birth"] = s["birth"],
        ["gender"] = s["gender"],
        ["school_level"] = Coded("school-level", 1, s["school_level"]),
        ["school"] = s["school"],
        ["grade"] = s["grade"],
        ["class"] = s["class"],
        ["guardian"] = s["guardian"],
        ["guardian_phone"] = s["guardian_phone"],
        ["phone"] = Optional(s["phone"]),
        ["referring_teacher"] = Optional(s["referring_teacher"]),
    }));
}

var subjectOfCase = new Dictionary<string, string>();
foreach (var c in cases)
{
    var at = At(c["opened"] + "T09:05:00+09:00");
    var id = NewId(c["key"], at);
    subjectOfCase[c["key"]] = c["subject"];
    changes.Add(new Change(id, c["device"], at, "case", id, "create", [], $"subjects/{IdOf(c["subject"])}", new JsonObject
    {
        ["subject"] = IdOf(c["subject"]),
        ["practitioner"] = IdOf(c["counselor"]),
        ["opened"] = c["opened"],
    }));
}

string FolderOfSession(string sessionKey) =>
    $"subjects/{IdOf(subjectOfCase[sessions.Single(r => r["key"] == sessionKey)["case"]])}";

foreach (var s in sessions)
{
    var at = At(s["entered_at"]);
    var id = NewId(s["key"], at);
    changes.Add(new Change(id, s["device"], at, "session", id, "create", [], FolderOfSession(s["key"]), new JsonObject
    {
        ["case"] = IdOf(s["case"]),
        ["practitioner"] = IdOf(s["counselor"]),
        ["date"] = s["date"],
        ["client_type"] = Coded("client-type", 1, s["client_type"]),
        ["method"] = s["method"] == "" ? null : Coded("method", 1, s["method"]),
        ["topic"] = Coded("topic", 1, s["topic_v1"]),
    }));

    if (s["reclassify_to"] != "")
    {
        var rat = At(s["reclassify_at"]);
        var rid = NewId(s["key"] + "#reclassify", rat);
        changes.Add(new Change(rid, s["reclassify_device"], rat, "session", id, "reclassify", [id], FolderOfSession(s["key"]),
            new JsonObject { ["topic"] = Coded("topic", 2, s["reclassify_to"]) }));
    }
}

// Each edit was written without seeing the other: both name only the create as their base.
foreach (var e in edits)
{
    var at = At(e["at"]);
    var id = NewId(e["key"], at);
    var target = IdOf(e["session"]);
    changes.Add(new Change(id, e["device"], at, "session", target, "update", [target], FolderOfSession(e["session"]),
        new JsonObject { [e["field"]] = Coded(e["field"], 1, e["value"]) }));
}

// ---- expected reports, grouped from the scenario rows ----

var hand = JsonNode.Parse(File.ReadAllText(Path.Combine(scenario, "expected-totals.json")))!;
var problems = new List<string>();

JsonObject Report(string name, int reportVersion, string month, int step)
{
    var from = Day(month + "-01");
    var to = from.AddMonths(1).AddDays(-1);
    var cells = new SortedDictionary<(string Row, string Column), List<string>>();
    var pending = new List<string>();
    var unmapped = new List<string>();

    foreach (var s in sessions)
    {
        var date = Day(s["date"]);
        if (date < from || date > to) continue;
        if (StepOf(At(s["entered_at"])) > step) continue;

        string row;
        if (reportVersion == 1) row = s["topic_v1"];
        else
        {
            var reclassified = s["reclassify_to"] != "" && StepOf(At(s["reclassify_at"])) <= step;
            row = reclassified ? s["reclassify_to"] : s["expect_v2"];
        }

        var id = IdOf(s["key"]);
        switch (row)
        {
            case "pending": pending.Add(id); break;
            case "unmapped": unmapped.Add(id); break;
            default:
                var key = (row, IdOf(s["counselor"]));
                if (!cells.TryGetValue(key, out var list)) cells[key] = list = [];
                list.Add(id);
                break;
        }
    }

    // Check against the hand-computed counts.
    var h = hand[name]!;
    var handCells = new SortedDictionary<(string, string), int>();
    foreach (var (row, byCounselor) in h["cells"]!.AsObject())
        foreach (var (counselor, n) in byCounselor!.AsObject())
            handCells[(row, IdOf(counselor))] = n!.GetValue<int>();
    var gotCells = cells.ToDictionary(kv => kv.Key, kv => kv.Value.Count);
    foreach (var k in handCells.Keys.Union(gotCells.Keys))
    {
        handCells.TryGetValue(k, out var want);
        gotCells.TryGetValue(k, out var got);
        if (want != got) problems.Add($"{name}: cell {k.Item1}/{CounselorKey(k.Item2)} hand={want} scenario={got}");
    }
    var total = cells.Values.Sum(l => l.Count) + pending.Count + unmapped.Count;
    Expect(name, "pending", h["pending"]!.GetValue<int>(), pending.Count);
    Expect(name, "unmapped", h["unmapped"]!.GetValue<int>(), unmapped.Count);
    Expect(name, "total", h["total"]!.GetValue<int>(), total);

    var schemeRef = new JsonObject { ["version"] = reportVersion };
    if (reportVersion == 2) schemeRef["crosswalks"] = new JsonArray("1-2");

    return new JsonObject
    {
        ["format"] = "openquote.run/0",
        ["report"] = new JsonObject { ["report"] = "monthly-topic", ["version"] = reportVersion },
        ["schemes"] = new JsonObject { ["topic"] = schemeRef },
        ["period"] = new JsonObject { ["from"] = from.ToString("yyyy-MM-dd", inv), ["to"] = to.ToString("yyyy-MM-dd", inv) },
        ["cells"] = new JsonArray(cells.Select(kv => (JsonNode)new JsonObject
        {
            ["row"] = kv.Key.Row,
            ["column"] = kv.Key.Column,
            ["count"] = kv.Value.Count,
            ["records"] = Ids(kv.Value),
        }).ToArray()),
        ["pending"] = Set(pending),
        ["unmapped"] = Set(unmapped),
        ["total"] = Set(cells.Values.SelectMany(l => l).Concat(pending).Concat(unmapped).ToList()),
    };
}

void Expect(string name, string what, int want, int got)
{
    if (want != got) problems.Add($"{name}: {what} hand={want} scenario={got}");
}

string CounselorKey(string id) => ids.First(kv => kv.Value == id).Key;
string SessionKey(string id) => ids.First(kv => kv.Value == id).Key;

// Months other than the report scenarios, checked by count only.
foreach (var (month, n) in hand["months_v1_step1"]!.AsObject())
{
    var got = sessions.Count(s => s["date"].StartsWith(month, StringComparison.Ordinal) && StepOf(At(s["entered_at"])) == 1);
    Expect("months_v1_step1", month, n!.GetValue<int>(), got);
}

var reports = new Dictionary<string, JsonObject>();
foreach (var name in new[] { "r0", "r1", "r2", "r3" })
{
    var h = hand[name]!;
    reports[name] = Report(name, h["report"]!.GetValue<int>(), h["month"]!.GetValue<string>(), h["step"]!.GetValue<int>());
}

JsonObject Diff(string a, string b)
{
    Dictionary<string, string> Placement(JsonObject run)
    {
        var map = new Dictionary<string, string>();
        foreach (var cell in run["cells"]!.AsArray())
            foreach (var r in cell!["records"]!.AsArray())
                map[r!.GetValue<string>()] = cell["row"]!.GetValue<string>();
        foreach (var r in run["pending"]!["records"]!.AsArray()) map[r!.GetValue<string>()] = "(pending)";
        foreach (var r in run["unmapped"]!["records"]!.AsArray()) map[r!.GetValue<string>()] = "(unmapped)";
        return map;
    }
    var pa = Placement(reports[a]);
    var pb = Placement(reports[b]);
    var late = pb.Keys.Except(pa.Keys).ToList();
    var removed = pa.Keys.Except(pb.Keys).ToList();
    // A record whose place changed moved because of the revision unless a person reclassified it
    // between the two runs — read from the scenario, not from the crosswalk.
    var stepA = hand[a]!["step"]!.GetValue<int>();
    var stepB = hand[b]!["step"]!.GetValue<int>();
    bool ReclassifiedBetween(string id) => sessions.Any(s => IdOf(s["key"]) == id && s["reclassify_to"] != ""
        && StepOf(At(s["reclassify_at"])) is var at && at > stepA && at <= stepB);
    var differ = pa.Keys.Intersect(pb.Keys).Where(k => pa[k] != pb[k]).ToList();
    var revised = differ.Where(k => !ReclassifiedBetween(k)).ToList();
    var moved = differ.Where(ReclassifiedBetween).ToList();
    var unchanged = pa.Keys.Intersect(pb.Keys).Where(k => pa[k] == pb[k]).ToList();
    return new JsonObject
    {
        ["from"] = a,
        ["to"] = b,
        ["late"] = Ids(late),
        ["removed"] = Ids(removed),
        ["revised"] = Ids(revised),
        ["moved"] = Ids(moved),
        ["unchanged"] = Ids(unchanged),
    };
}

var diffs = new Dictionary<string, JsonObject> { ["r1-r2"] = Diff("r1", "r2"), ["r2-r3"] = Diff("r2", "r3") };
foreach (var (name, handDiff) in hand["diffs"]!.AsObject())
{
    var got = diffs[name];
    foreach (var (field, want) in handDiff!.AsObject())
    {
        var gotKeys = got[field]!.AsArray().Select(n => SessionKey(n!.GetValue<string>())).Order(StringComparer.Ordinal).ToList();
        if (want is JsonArray arr)
        {
            var wantKeys = arr.Select(n => n!.GetValue<string>()).Order(StringComparer.Ordinal).ToList();
            if (!wantKeys.SequenceEqual(gotKeys))
                problems.Add($"diff {name}.{field}: hand=[{string.Join(",", wantKeys)}] scenario=[{string.Join(",", gotKeys)}]");
        }
        else Expect($"diff {name}", field, want!.GetValue<int>(), gotKeys.Count);
    }
}

if (problems.Count > 0)
{
    Console.Error.WriteLine("Scenario disagrees with expected-totals.json:");
    foreach (var p in problems) Console.Error.WriteLine("  " + p);
    return 1;
}

// ---- write ----

foreach (var dir in new[] { stepsDir, expectedDir, invalidDir })
    if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);

foreach (var stepStatic in Directory.GetDirectories(Path.Combine(scenario, "static")))
    CopyTree(stepStatic, Path.Combine(stepsDir, StepDir(int.Parse(Path.GetFileName(stepStatic), inv))));

foreach (var c in changes.OrderBy(c => c.Id, StringComparer.Ordinal))
{
    var path = Path.Combine(stepsDir, StepDir(StepOf(c.At)), c.Folder, $"{c.Id}.{c.Device}.json");
    Write(path, c.ToJson());
}

foreach (var (name, report) in reports) Write(Path.Combine(expectedDir, $"{name}.json"), report);
foreach (var (name, diff) in diffs) Write(Path.Combine(expectedDir, $"diff-{name}.json"), diff);

// Scenario key for every id (entities and changes), so a failing comparison can be read in terms of sessions.csv.
Write(Path.Combine(expectedDir, "keys.json"),
    new JsonObject(ids.OrderBy(kv => kv.Key, StringComparer.Ordinal)
        .Select(kv => KeyValuePair.Create(kv.Value, (JsonNode?)JsonValue.Create(kv.Key)))));

// Unreadable files for read validation, overlaid on step 1 by tests that want them.
{
    var sample = changes.First(c => c.Entity == "session");
    var json = Serialize(sample.ToJson());
    var badAt = At("2026-04-30T12:00:00+09:00");
    var truncatedId = Uuid7.Deterministic(badAt, "openquote-golden:invalid-truncated");
    File.WriteAllText(EnsureDir(Path.Combine(invalidDir, sample.Folder, $"{truncatedId}.pc01.json")), json[..(json.Length / 2)]);
    var mismatchId = Uuid7.Deterministic(badAt, "openquote-golden:invalid-name-mismatch");
    File.WriteAllText(EnsureDir(Path.Combine(invalidDir, sample.Folder, $"{mismatchId}.pc02.json")), json);
}

Console.WriteLine($"{changes.Count} changes in {runAt.Length} steps, {reports.Count} reports, {diffs.Count} diffs.");
return 0;

// ---- helpers ----

static string StepDir(int step) => $"{step}";

static JsonObject Coded(string scheme, int version, string code) =>
    new() { ["scheme"] = scheme, ["version"] = version, ["code"] = code };

static JsonNode? Optional(string value) => value == "" ? null : JsonValue.Create(value);

static JsonArray Ids(IEnumerable<string> ids) =>
    new(ids.Order(StringComparer.Ordinal).Select(i => (JsonNode)JsonValue.Create(i)!).ToArray());

static JsonObject Set(List<string> ids) => new() { ["count"] = ids.Count, ["records"] = Ids(ids) };

static string EnsureDir(string path)
{
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    return path;
}

static string Serialize(JsonNode node) =>
    node.ToJsonString(new JsonSerializerOptions
    {
        WriteIndented = true,
        NewLine = "\n",
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    }) + "\n";

static void Write(string path, JsonNode node) => File.WriteAllText(EnsureDir(path), Serialize(node), new UTF8Encoding(false));

static void CopyTree(string from, string to)
{
    foreach (var file in Directory.GetFiles(from, "*", SearchOption.AllDirectories))
    {
        var target = Path.Combine(to, Path.GetRelativePath(from, file));
        File.Copy(file, EnsureDir(target));
    }
}

sealed record Change(string Id, string Device, DateTimeOffset At, string Entity, string EntityId, string Op,
    string[] Base, string Folder, JsonObject Fields)
{
    public JsonObject ToJson() => new()
    {
        ["format"] = "openquote.change/0",
        ["id"] = Id,
        ["device"] = Device,
        ["at"] = At.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
        ["entity"] = new JsonObject { ["type"] = Entity, ["id"] = EntityId },
        ["op"] = Op,
        ["base"] = new JsonArray(Base.Select(b => (JsonNode)JsonValue.Create(b)!).ToArray()),
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
        return lines.Skip(1).Select(line =>
        {
            var cols = line.Split(',');
            if (cols.Length != header.Length)
                throw new FormatException($"{Path.GetFileName(path)}: expected {header.Length} columns: {line}");
            return header.Zip(cols).ToDictionary(p => p.First, p => p.Second);
        }).ToList();
    }
}
