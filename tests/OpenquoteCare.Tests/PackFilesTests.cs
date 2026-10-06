using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Openquote.Classification;
using Openquote.Fields;
using Openquote.Suggestions;
using Openquote.Vault;

namespace OpenquoteCare.Tests;

/// <summary>The data packs bundled with the app, read by the engine as a vault on each track would hold them.</summary>
public sealed class PackFilesTests
{
    private static readonly string Packs = Path.GetFullPath(Path.Combine(GoldenVault.School.Root, "..", "..", "packs"));

    private static JsonNode Json(string path) => JsonNode.Parse(File.ReadAllText(path))!;

    public static TheoryData<string> Tracks() =>
        [.. Json(Path.Combine(Packs, "tracks.json"))["tracks"]!.AsArray().Select(t => t!["id"]!.GetValue<string>())];

    // The folders of a track's packs and every pack they build on, as tracks.json and each pack's newest manifest say.
    private static IEnumerable<string> PacksOf(string track)
    {
        var manifests = Directory.GetDirectories(Packs)
            .Select(dir => (Dir: dir, Manifest: Directory.GetFiles(Path.Combine(dir, "packs"), "*.json", SearchOption.AllDirectories).Select(Json).MaxBy(m => m["version"]!.GetValue<int>())!))
            .ToDictionary(p => p.Manifest["pack"]!.GetValue<string>(), p => p);
        var seen = new List<string>();
        void Visit(string id)
        {
            if (seen.Contains(id)) return;
            foreach (var dependency in manifests[id].Manifest["depends"]?.AsObject().Select(d => d.Key) ?? []) Visit(dependency);
            seen.Add(id);
        }
        var chosen = Json(Path.Combine(Packs, "tracks.json"))["tracks"]!.AsArray().Single(t => t!["id"]!.GetValue<string>() == track)!;
        foreach (var id in chosen["packs"]!.AsArray()) Visit(id!.GetValue<string>());
        return seen.Select(id => manifests[id].Dir);
    }

    private static VaultContent VaultOn(string track) => VaultReader.Read(PacksOf(track).SelectMany(VaultFiles.FromDirectory));

    [Theory]
    [MemberData(nameof(Tracks))]
    public void Every_track_reads_clean(string track)
    {
        var content = VaultOn(track);

        Assert.Empty(content.Unreadable);
        Assert.Empty(content.CheckPacks());
        Assert.Empty(content.FieldCatalog().Issues);
        Assert.Empty(content.LabelCatalog().Conflicts);
        Assert.Empty(content.SuggestionCatalog().Conflicts);
    }

    [Fact]
    public void The_school_track_hides_the_core_classification_and_offers_its_own()
    {
        var fields = VaultOn("school-kr").FieldCatalog();

        Assert.True(fields.Find("session", "concern")!.Hidden);
        Assert.True(fields.Find("session", "mode")!.Hidden);
        Assert.Equal((FieldKind.Coded, true, false), (fields.Find("session", "topic")!.Kind, fields.Find("session", "topic")!.Required, fields.Find("session", "topic")!.Hidden));
        Assert.Equal("grade", fields.Find("session", "grade")!.DefaultFromSubject);
    }

    [Fact]
    public void A_school_session_says_who_it_was_with_its_title_and_how_long_it_took()
    {
        var content = VaultOn("school-kr");
        var fields = content.FieldCatalog();

        Assert.Equal((FieldKind.Coded, "client-type", false), (fields.Find("session", "client_type")!.Kind, fields.Find("session", "client_type")!.Scheme, fields.Find("session", "client_type")!.Required));
        Assert.Equal(FieldKind.Text, fields.Find("session", "title")!.Kind);
        Assert.Equal(FieldKind.Number, fields.Find("session", "minutes")!.Kind);
        var list = content.Exports.Where(e => e.Name == "session-list").MaxBy(e => e.Version)!;
        Assert.Equal(3, list.Version);
        Assert.Equal(["상담 상대", "실시한 검사", "상담 제목", "상담 시간(분)", "담당자"], list.Columns.Select(c => c.Label).TakeLast(5));
    }

    [Theory]
    [MemberData(nameof(Tracks))]
    public void Every_track_declares_a_practitioners_name_as_a_required_text_field(string track)
    {
        var name = VaultOn(track).FieldCatalog().Find("practitioner", "name");

        Assert.NotNull(name);
        Assert.Equal((FieldKind.Text, true, false), (name.Kind, name.Required, name.Hidden));
    }

    [Fact]
    public void A_school_session_starts_with_the_student()
    {
        var content = VaultOn("school-kr");

        Assert.Equal("student", content.FieldCatalog().Find("session", "client_type")!.DefaultValue);
        Assert.Equal(["year-assessment-level", "year-client-type", "year-grade-class", "year-grade-gender", "year-practitioner-minutes"],
            content.Reports.Where(r => r.Name.StartsWith("year-", StringComparison.Ordinal)).Select(r => r.Name).Order());
    }

    [Fact]
    public void A_school_session_may_carry_its_neis_category_three_levels_deep()
    {
        var content = VaultOn("school-kr");
        var neis = content.FieldCatalog().Find("session", "neis")!;
        var scheme = content.Schemes.Single(s => s.Name == "neis-counseling");
        var items = scheme.Items.ToDictionary(i => i.Code);
        var parents = scheme.Items.Select(i => i.Parent).OfType<string>().ToHashSet();
        var leaves = scheme.Items.Where(i => !parents.Contains(i.Code)).ToList();

        Assert.Equal((FieldKind.Coded, "neis-counseling", false), (neis.Kind, neis.Scheme, neis.Required));
        Assert.Equal("NEIS 분류", content.LabelCatalog().FieldLabel("session", "neis", ["ko"]));
        Assert.Equal(["상담", "검사", "자문", "교육", "연구", "의뢰"], scheme.Items.Where(i => i.Parent is null).Select(i => i.Label));
        // Every choice sits under a middle level under a top level, as the upload form asks for all three.
        Assert.All(leaves, leaf => Assert.Null(items[items[leaf.Parent!].Parent!].Parent));
        Assert.Equal(51, leaves.Count);
        Assert.Equal(["학업", "진로", "학교폭력", "성격/대인관계", "기타"],
            leaves.Where(l => l.Parent == "counseling/group").Select(l => l.Label));
        Assert.Equal(Suggestion.Confirm,
            content.SuggestionCatalog().For("neis-counseling", 1, items["counseling/individual/self-harm-suicide"]));
    }

    [Fact]
    public void School_forms_add_up_the_minutes_of_sessions_and_the_list_names_every_assessment()
    {
        var w = new VaultWriter("dev1");
        var records = new List<VaultFile>();
        string Add(VaultFile f)
        {
            records.Add(f);
            return VaultReader.Read([f]).Changes[0].Entity.Id;
        }
        static JsonObject Tool(string code, bool primary = false)
        {
            var value = new JsonObject { ["scheme"] = "assessment-tool", ["version"] = 1, ["code"] = code };
            if (primary) value["primary"] = true;
            return value;
        }
        var one = Add(w.CreateSubject(new Dictionary<string, JsonNode?> { ["name"] = "가상 학생 1" }));
        var counsellor = Add(w.CreatePractitioner(new Dictionary<string, JsonNode?> { ["name"] = "상담자 가" }));
        Add(w.CreateInSubject(one, "session", new Dictionary<string, JsonNode?>
        {
            ["date"] = "2026-05-02", ["minutes"] = 70, ["practitioner"] = counsellor,
            ["assessments"] = new JsonArray(Tool("sct"), Tool("mmpi-a", primary: true)),
        }));
        Add(w.CreateInSubject(one, "session", new Dictionary<string, JsonNode?> { ["date"] = "2026-05-09", ["minutes"] = 50, ["practitioner"] = counsellor }));
        Add(w.CreateInSubject(one, "session", new Dictionary<string, JsonNode?> { ["date"] = "2026-05-16", ["practitioner"] = counsellor }));
        var content = VaultReader.Read(PacksOf("school-kr").SelectMany(VaultFiles.FromDirectory).Concat(records));
        var entities = Openquote.Records.EntityMerger.Merge(content.Changes).Values;

        var month = Openquote.Reports.ReportRunner.RunContaining(content.Reports.Single(r => r.Name == "month-practitioner-minutes"),
            new DateOnly(2026, 5, 1), entities, content.Catalog());
        var year = Openquote.Reports.ReportRunner.RunContaining(content.Reports.Single(r => r.Name == "year-practitioner-minutes"),
            new DateOnly(2026, 5, 1), entities, content.Catalog());
        var list = Openquote.Exports.ExportRunner.Run(content.Exports.Single(e => e.Name == "session-list" && e.Version == 3),
            new DateOnly(2026, 5, 1), new DateOnly(2026, 5, 31), entities, content.Catalog(), content.FieldCatalog());

        Assert.Equal((120m, 1), month.SumOf("minutes", month.Total)); // the session with no length is said, not counted as 0
        Assert.Equal((120m, 1), year.SumOf("minutes", year.Total));
        var column = content.Exports.Single(e => e.Name == "session-list" && e.Version == 3).Columns.Select(c => c.Label).ToList().IndexOf("실시한 검사");
        var assessments = list.Rows[0].Cells[column];
        Assert.Equal("MMPI-A(다면적 인성 청소년용), SCT(문장완성)", assessments);
    }

    [Theory]
    [MemberData(nameof(Tracks))]
    public void Closings_are_counted_by_how_they_ended_as_well_as_by_reason(string track)
    {
        var w = new VaultWriter("dev1");
        var records = new List<VaultFile>();
        string Add(VaultFile f)
        {
            records.Add(f);
            return VaultReader.Read([f]).Changes[0].Entity.Id;
        }
        static JsonObject Reason(string code) => new() { ["scheme"] = "care.closing-reason", ["version"] = 1, ["code"] = code };
        var one = Add(w.CreateSubject(new Dictionary<string, JsonNode?> { ["name"] = "Client One" }));
        foreach (var (day, reason) in new[] { ("2026-04-03", "completed"), ("2026-04-10", "lost-contact"), ("2026-04-17", "moved-away"), ("2026-04-24", "referred") })
            Add(w.CreateInSubject(one, "closing", new Dictionary<string, JsonNode?> { ["date"] = day, ["reason"] = Reason(reason) }));
        var content = VaultReader.Read(PacksOf(track).SelectMany(VaultFiles.FromDirectory).Concat(records));
        var entities = Openquote.Records.EntityMerger.Merge(content.Changes).Values;

        var run = Openquote.Reports.ReportRunner.RunContaining(content.Reports.Single(r => r.Name == "care.monthly-closing-type"),
            new DateOnly(2026, 4, 1), entities, content.Catalog());

        int Ended(string how) => run.Cells.Where(c => c.Key[0] == how).Sum(c => c.Records.Count);
        Assert.Equal((2, 1, 1), (Ended("planned"), Ended("early"), Ended("other"))); // completed and referred are planned endings
        Assert.Equal(4, run.Total.Count);
        Assert.Empty(run.Pending);
        Assert.Empty(run.Unmapped);
    }

    [Fact]
    public void A_school_session_names_the_assessments_given_and_forms_count_each_one()
    {
        var w = new VaultWriter("dev1");
        var records = new List<VaultFile>();
        string Add(VaultFile f)
        {
            records.Add(f);
            return VaultReader.Read([f]).Changes[0].Entity.Id;
        }
        static JsonObject Tool(string code, bool primary = false)
        {
            var value = new JsonObject { ["scheme"] = "assessment-tool", ["version"] = 1, ["code"] = code };
            if (primary) value["primary"] = true;
            return value;
        }
        static JsonObject Level(string code) => new() { ["scheme"] = "school-level", ["version"] = 1, ["code"] = code };
        var one = Add(w.CreateSubject(new Dictionary<string, JsonNode?> { ["name"] = "가상 학생 1", ["level"] = Level("middle") }));
        var two = Add(w.CreateSubject(new Dictionary<string, JsonNode?> { ["name"] = "가상 학생 2", ["level"] = Level("high") }));
        var counsellor = Add(w.CreatePractitioner(new Dictionary<string, JsonNode?> { ["name"] = "상담자 가" }));
        // A first meeting that was an interview and a battery of three; a later one with one assessment; one with none.
        Add(w.CreateInSubject(one, "session", new Dictionary<string, JsonNode?>
        {
            ["date"] = "2026-05-02", ["method"] = new JsonObject { ["scheme"] = "method", ["version"] = 1, ["code"] = "interview" },
            ["assessments"] = new JsonArray(Tool("mmpi-a", primary: true), Tool("sct"), Tool("htp")), ["practitioner"] = counsellor,
        }));
        Add(w.CreateInSubject(two, "session", new Dictionary<string, JsonNode?>
        {
            ["date"] = "2026-05-09", ["assessments"] = Tool("sct"), ["practitioner"] = counsellor,
        }));
        Add(w.CreateInSubject(two, "session", new Dictionary<string, JsonNode?> { ["date"] = "2026-05-16", ["practitioner"] = counsellor }));
        var content = VaultReader.Read(PacksOf("school-kr").SelectMany(VaultFiles.FromDirectory).Concat(records));
        var entities = Openquote.Records.EntityMerger.Merge(content.Changes).Values;
        var field = content.FieldCatalog().Find("session", "assessments")!;
        var tools = content.Schemes.Single(s => s.Name == "assessment-tool" && s.Version == 1);

        Assert.Equal((FieldKind.Coded, "assessment-tool", true, false), (field.Kind, field.Scheme, field.Many, field.Required));
        Assert.Equal("실시한 검사", content.LabelCatalog().FieldLabel("session", "assessments", ["ko"]));
        Assert.Contains(tools.Items, i => i.Code == "other");
        // Which assessment was given is a fact the counsellor records, never a suggestion.
        Assert.All(tools.Items, i => Assert.Equal(Suggestion.Off, content.SuggestionCatalog().For("assessment-tool", 1, i)));
        // A field taking several values is counted right only by an engine that reads format 1.
        Assert.Equal(1, content.RequiredVersion);

        var month = Openquote.Reports.ReportRunner.RunContaining(content.Reports.Single(r => r.Name == "month-assessment-tool"),
            new DateOnly(2026, 5, 1), entities, content.Catalog());
        int Count(Openquote.Reports.ReportRun run, string tool) => run.Cells.Where(c => c.Key[0] == tool).Sum(c => c.Records.Count);
        Assert.Equal((2, 1, 1, 0), (Count(month, "sct"), Count(month, "mmpi-a"), Count(month, "htp"), Count(month, "k-wisc-v")));
        Assert.Equal((3, 1), (month.Total.Count, month.Blank.Count)); // two sessions with an assessment, one without

        var year = Openquote.Reports.ReportRunner.RunContaining(content.Reports.Single(r => r.Name == "year-assessment-level"),
            new DateOnly(2026, 5, 1), entities, content.Catalog());
        Assert.Equal((1, 1), (year.Cells.Single(c => c.Key[0] == "sct" && c.Key[1] == "middle").Records.Count,
            year.Cells.Single(c => c.Key[0] == "sct" && c.Key[1] == "high").Records.Count));
    }

    [Fact]
    public void The_neis_upload_form_lays_out_a_session_in_the_upload_s_columns_and_order()
    {
        var w = new VaultWriter("dev1");
        var records = new List<VaultFile>();
        string Add(VaultFile f)
        {
            records.Add(f);
            return VaultReader.Read([f]).Changes[0].Entity.Id;
        }
        static JsonObject Neis(string code) => new() { ["scheme"] = "neis-counseling", ["version"] = 1, ["code"] = code };
        var one = Add(w.CreateSubject(new Dictionary<string, JsonNode?> { ["name"] = "가상 학생 1", ["gender"] = "남" }));
        var two = Add(w.CreateSubject(new Dictionary<string, JsonNode?> { ["name"] = "가상 학생 2", ["gender"] = "여" }));
        var group = Add(w.CreateGroup(new Dictionary<string, JsonNode?> { ["name"] = "또래 집단" }));
        var counsellor = Add(w.CreatePractitioner(new Dictionary<string, JsonNode?> { ["name"] = "상담자 가", ["affiliation"] = "전문상담교사" }));
        Add(w.CreateInSubject(one, "session", new Dictionary<string, JsonNode?>
        {
            ["date"] = "2026-05-02", ["neis"] = Neis("counseling/individual/academic"), ["grade"] = "1학년", ["title"] = "성적 하락", ["minutes"] = 70,
            ["practitioner"] = counsellor,
        }));
        Add(w.CreateInGroup(group, "session", new Dictionary<string, JsonNode?>
        {
            ["date"] = "2026-08-19", ["neis"] = Neis("counseling/group/personality-relationships"), ["title"] = "친구 관계", ["minutes"] = 50,
            ["attendees"] = new JsonArray(one, two),
        }));
        var content = VaultReader.Read(PacksOf("school-kr").SelectMany(VaultFiles.FromDirectory).Concat(records));
        var form = content.Exports.Single(e => e.Name == "neis-upload");
        var entities = Openquote.Records.EntityMerger.Merge(content.Changes).Values;

        var table = Openquote.Exports.ExportRunner.Run(form, new DateOnly(2026, 3, 1), new DateOnly(2027, 2, 28), entities, content.Catalog(), content.FieldCatalog());

        Assert.Equal(
            ["상담분류", "Wee클래스", "대분류", "중분류", "상담구분", "상담인원", "학년도", "상담일자", "학년", "성별", "상담제목", "상담내용",
             "상담시간(시)", "상담시간(분)", "상담사소속", "상담매체구분", "이름"],
            form.Columns.Select(c => c.Label));
        Assert.Collection(table.Rows,
            r => Assert.Equal(["전문상담", "Wee클래스", "상담", "개인상담", "학업", "1", "2026", "20260502", "1학년", "남", "성적 하락", "성적 하락", "1", "10", "전문상담교사", "", "가상 학생 1"], r.Cells),
            r => Assert.Equal(["전문상담", "Wee클래스", "상담", "집단상담", "성격/대인관계", "2", "2026", "20260819", "", "혼성", "친구 관계", "친구 관계", "0", "50", "", "", "가상 학생 1, 가상 학생 2"], r.Cells));
        Assert.Empty(table.Pending.Concat(table.Unmapped).Concat(table.Conflicted).Concat(table.Withheld));
    }

    [Fact]
    public void A_school_practitioner_has_an_affiliation_the_neutral_track_does_not()
    {
        var affiliation = VaultOn("school-kr").FieldCatalog().Find("practitioner", "affiliation");

        Assert.NotNull(affiliation);
        Assert.Equal((FieldKind.Text, false), (affiliation.Kind, affiliation.Required));
        Assert.Null(VaultOn("care-en").FieldCatalog().Find("practitioner", "affiliation"));
    }

    [Fact]
    public void The_neutral_track_holds_no_school_field()
    {
        var fields = VaultOn("care-en").FieldCatalog();
        Assert.Null(fields.Find("session", "topic"));
        Assert.Null(fields.Find("subject", "school"));
        Assert.False(fields.Find("session", "concern")!.Hidden);
    }

    [Fact]
    public void The_neutral_track_suggests_every_concern_sets_safety_apart_and_never_suggests_a_mode()
    {
        var content = VaultOn("care-en");
        var suggestions = content.SuggestionCatalog();
        Suggestion For(string scheme, SchemeItem item) => suggestions.For(scheme, 1, item);
        var concern = content.Schemes.Single(s => s.Name == "care.concern" && s.Version == 1);
        var mode = content.Schemes.Single(s => s.Name == "care.mode" && s.Version == 1);

        Assert.Equal(Suggestion.Confirm, For("care.concern", concern.Items.Single(i => i.Code == "safety")));
        Assert.All(concern.Items.Where(i => i.Code != "safety"), i => Assert.Equal(Suggestion.Offer, For("care.concern", i)));
        Assert.All(mode.Items, i => Assert.Equal(Suggestion.Off, For("care.mode", i)));
    }

    [Theory]
    [InlineData("care-en", "en")]
    [InlineData("school-kr", "ko")]
    public void Every_core_field_scheme_item_and_form_has_a_label_in_the_tracks_locale(string track, string locale)
    {
        var content = VaultOn(track);
        var labels = content.LabelCatalog();
        var fields = content.FieldCatalog();

        foreach (var type in new[] { "session", "subject", "practitioner" })
            foreach (var field in fields.For(type).Where(f => !f.Hidden))
                Assert.True(labels.FieldLabel(type, field.Name, [locale]) is not null, $"{track}: {type}.{field.Name}");
        if (track == "school-kr") return; // the school track hides the core's classifications and forms
        foreach (var scheme in content.Schemes.Where(s => s.Name.StartsWith("care.", StringComparison.Ordinal)))
            foreach (var item in scheme.Items)
                Assert.True(labels.SchemeLabel(scheme.Name, scheme.Version, item.Code, [locale]) is not null, $"{track}: {scheme.Name} {item.Code}");
        Assert.NotNull(labels.ReportLabel("care.monthly-concern", 1, [locale]));
        Assert.NotNull(labels.ExportLabel("care.session-list", 1, [locale]));
    }

    // What a version of the app before packs named themselves put in every new vault. A vault it made is taken onto
    // the school track only while the bundle still provides these bytes unchanged.
    [Theory]
    [InlineData("exports/session-list/v1.json", "44dda45ff05ec1c9e498bbea199c728751e5ab291512aa086956caca6cce95a8")]
    [InlineData("reports/monthly-topic/v1.json", "e9802e36feb26ccb2e0df85eb0f63c563df4c658fe2f7e1c8b43ea6841a31a7e")]
    [InlineData("schemes/client-type/v1.json", "2a615ca1b07f10952939e7730318b687d918ccd864e55be367eb1997e29b1e5a")]
    [InlineData("schemes/method/v1.json", "abe779e1d0b3b7effe0134b32dd0e1b08cb89cca4225bcf6d73e8122e3651620")]
    [InlineData("schemes/school-level/v1.json", "f303c677e32883ca64c1f8fa97c881a2a2a8c6eeec1542e2c5577ed21592cc95")]
    [InlineData("schemes/topic/v1.json", "14adf16076f41e8725a1037fa6ea6a2f39cbb7dbd144b6c6989f04b6f440c219")]
    public void Every_file_an_earlier_version_put_in_a_new_vault_is_still_provided_unchanged(string path, string sha256)
    {
        var file = PacksOf("school-kr").SelectMany(VaultFiles.FromDirectory).Single(f => f.Path == path);

        Assert.Equal(sha256, Convert.ToHexStringLower(SHA256.HashData(file.Content.Span)));
    }
}
