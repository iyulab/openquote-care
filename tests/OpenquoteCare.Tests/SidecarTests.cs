using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using OpenquoteCare.Sidecar;

namespace OpenquoteCare.Tests;

public sealed class SidecarTests : IAsyncLifetime
{
    private const string Token = "0123456789abcdef0123456789abcdef-test";
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    public async ValueTask InitializeAsync()
    {
        _app = SidecarHost.Build([], Token, "pc09", TimeProvider.System, port: 0);
        await _app.StartAsync();
        _http = new HttpClient { BaseAddress = new Uri(_app.Urls.First()) };
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
    }

    public async ValueTask DisposeAsync()
    {
        _http.Dispose();
        await _app.DisposeAsync();
    }

    private static object Files(IEnumerable<Openquote.Vault.VaultFile> files) =>
        new { files = files.Select(f => new { path = f.Path, content = Convert.ToBase64String(f.Content.Span) }) };

    private async Task<JsonNode> Post(string path, object body, HttpStatusCode expect = HttpStatusCode.OK)
    {
        using var response = await _http.PostAsJsonAsync(path, body, TestContext.Current.CancellationToken);
        Assert.Equal(expect, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        return text.Length == 0 ? new JsonObject() : JsonNode.Parse(text)!;
    }

    private async Task<JsonNode> Get(string path)
    {
        using var response = await _http.GetAsync(path, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken))!;
    }

    [Fact]
    public void Listens_on_the_loopback_address_only()
    {
        Assert.Equal("127.0.0.1", new Uri(_app.Urls.First()).Host);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("Bearer wrong")]
    [InlineData("0123456789abcdef0123456789abcdef-test")]
    public async Task Refuses_a_request_without_the_token(string? authorization)
    {
        using var client = new HttpClient { BaseAddress = _http.BaseAddress };
        if (authorization is not null) client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", authorization);

        using var response = await client.GetAsync("/entities/session", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Says_so_when_no_vault_is_loaded()
    {
        using var response = await _http.GetAsync("/entities/session", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Loads_the_golden_vault_and_reproduces_its_run()
    {
        var summary = await Post("/vault/load", Files(GoldenVault.School.Through(3)));
        Assert.Equal(81, summary["changes"]!.GetValue<int>());
        Assert.Equal(75, summary["entities"]!.GetValue<int>());
        Assert.Equal(1, summary["conflicts"]!.GetValue<int>());
        Assert.Empty(summary["unreadable"]!.AsArray());

        var result = await Post("/reports/run", new { report = "monthly-topic", version = 2, from = "2026-04-01" });

        var record = result["record"]!.AsObject();
        Assert.Equal("pc09", record["device"]!.GetValue<string>());
        foreach (var key in new[] { "id", "device", "at" }) record.Remove(key);
        Assert.True(JsonNode.DeepEquals(GoldenVault.School.Expected("r3"), record));
        Assert.Matches(@"^runs/\d{4}/[0-9a-f-]{36}\.pc09\.json$", result["file"]!["path"]!.GetValue<string>());
    }

    [Fact]
    public async Task Lists_every_scheme_version_with_its_items()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(2)));

        var schemes = await Get("/schemes");

        var topics = schemes.AsArray().Where(s => s!["scheme"]!.GetValue<string>() == "topic").ToList();
        Assert.Equal([1, 2], topics.Select(t => t!["version"]!.GetValue<int>()));
        var item = topics[1]!["items"]!.AsArray().First(i => i!["code"]!.GetValue<string>() == "relation-peer")!;
        Assert.False(string.IsNullOrEmpty(item["label"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Summarises_the_loaded_vault_on_request()
    {
        var loaded = await Post("/vault/load", Files(GoldenVault.School.Through(3)));

        var summary = await Get("/summary");

        Assert.True(JsonNode.DeepEquals(loaded, summary));
        Assert.Contains(summary["reports"]!.AsArray(), r => r!["name"]!.GetValue<string>() == "monthly-topic" && r["version"]!.GetValue<int>() == 2);
    }

    [Fact]
    public async Task Names_a_scheme_version_no_crosswalk_leads_to()
    {
        var linked = await Post("/vault/load", Files(GoldenVault.School.Through(3)));
        Assert.Empty(linked["unlinked"]!.AsArray());

        const string relabelled = """{"format":"openquote.scheme/0","scheme":"method","version":2,"items":[{"code":"individual","label":"Individual"}]}""";
        var summary = await Post("/vault/load", Files(GoldenVault.School.Through(3).Append(
            new Openquote.Vault.VaultFile("schemes/method/v2.json", System.Text.Encoding.UTF8.GetBytes(relabelled)))));

        var unlinked = summary["unlinked"]!.AsArray().Single()!;
        Assert.Equal(("method", 2), (unlinked["scheme"]!.GetValue<string>(), unlinked["version"]!.GetValue<int>()));
    }

    [Fact]
    public async Task Names_the_forms_left_behind_a_scheme_revision()
    {
        const string form = """
            {"format":"openquote.export/0","export":"list","version":1,"label":"List","rows":"session","period":{"field":"date"},
             "columns":[{"label":"date","field":"date"},{"label":"topic","field":"topic","scheme":"topic","version":1},{"label":"method","field":"method","scheme":"method","version":1}]}
            """;
        var exportFile = new Openquote.Vault.VaultFile("exports/list/v1.json", System.Text.Encoding.UTF8.GetBytes(form));

        var summary = await Post("/vault/load", Files(GoldenVault.School.Through(3).Append(exportFile)));

        var reports = summary["reports"]!.AsArray().ToDictionary(r => r!["version"]!.GetValue<int>(), r => r!["behind"]!.AsArray());
        var lag = reports[1].Single()!;
        Assert.Equal(("topic", 1, 2), (lag["scheme"]!.GetValue<string>(), lag["version"]!.GetValue<int>(), lag["latest"]!.GetValue<int>()));
        Assert.Empty(reports[2]);
        var exportLag = summary["exports"]!.AsArray().Single()!["behind"]!.AsArray().Single()!;
        Assert.Equal("topic", exportLag["scheme"]!.GetValue<string>());
    }

    private static Openquote.Vault.VaultFile Def(string path, string json) => new(path, System.Text.Encoding.UTF8.GetBytes(json));

    // Two packs: "base" and "region" building on it, each labelling the date field in its own locale.
    private static readonly Openquote.Vault.VaultFile[] TwoPacks =
    [
        Def("packs/base/v1.json", """{"format":"openquote.pack/0","pack":"base","version":1,"label":"Base","provides":["labels/base/v1.en.json"]}"""), Def("labels/base/v1.en.json", """{"format":"openquote.labels/0","pack":"base","version":1,"locale":"en","fields":{"session":{"date":"Date"}}}"""),
        Def("packs/region/v1.json", """{"format":"openquote.pack/0","pack":"region","version":1,"label":"Region","depends":{"base":1},"provides":["labels/region/v1.fr.json","reports/missing/v1.json"]}"""), Def("labels/region/v1.fr.json", """{"format":"openquote.labels/0","pack":"region","version":1,"locale":"fr","fields":{"session":{"date":"Date du jour"}}}"""),
    ];

    // A pack declaring the session and subject fields of the golden vault, labelled in English, and one building on it
    // that hides the method field and the school of a subject. Forms read those fields, or do not.
    private static readonly Openquote.Vault.VaultFile[] FieldPacks =
    [
        Def("packs/core/v1.json", """{"format":"openquote.pack/0","pack":"core","version":1,"label":"Core","provides":["fields/core/session/v1.json","fields/core/subject/v1.json","labels/core/v1.en.json","schemes/kind/v1.json","schemes/kind/v2.json","reports/by-method/v1.json","exports/by-method/v1.json","exports/by-school/v1.json","exports/plain/v1.json"]}"""), Def("fields/core/session/v1.json", """{"format":"openquote.fields/0","pack":"core","type":"session","version":1,"fields":[ {"name":"date","kind":"date","required":true,"label":"Date"}, {"name":"practitioner","kind":"reference","type":"practitioner","required":true}, {"name":"topic","kind":"coded","scheme":"topic","required":true}, {"name":"method","kind":"coded","scheme":"method"}, {"name":"grade","kind":"text","default":{"subject":"grade"}}, {"name":"note","kind":"text","tier":"narrative","label":"Notes"}]}"""),
        Def("fields/core/subject/v1.json", """{"format":"openquote.fields/0","pack":"core","type":"subject","version":1,"fields":[ {"name":"name","kind":"text","required":true,"label":"Name"}, {"name":"school","kind":"text"}]}"""),
        Def("labels/core/v1.en.json", """{"format":"openquote.labels/0","pack":"core","version":1,"locale":"en", "schemes":{"method":{"1":{"interview":"Interview"}}}, "fields":{"session":{"topic":"Topic"}}, "aliases":{"subject":{"name":["Full name","Client"]}}, "reports":{"monthly-topic":{"1":"Sessions by topic"}}, "exports":{"plain":{"1":{"columns":{"0":"Day"}}}}}"""),
        Def("schemes/kind/v1.json", """{"format":"openquote.scheme/0","scheme":"kind","version":1,"effective":{"from":"2025-03-01","to":"2026-02-28"},"items":[{"code":"a","label":"A"}]}"""), Def("schemes/kind/v2.json", """{"format":"openquote.scheme/0","scheme":"kind","version":2,"effective":{"from":"2026-03-01"},"items":[{"code":"a","label":"A"}]}"""),
        Def("reports/by-method/v1.json", """{"format":"openquote.report/0","report":"by-method","version":1,"label":"By method","counts":"session","period":{"unit":"month","field":"date"},"rows":{"field":"method","scheme":"method","version":1}}"""), Def("exports/by-method/v1.json", """{"format":"openquote.export/0","export":"by-method","version":1,"label":"By method","rows":"session","period":{"field":"date"},"columns":[{"label":"Date","field":"date"},{"label":"Method","field":"method","scheme":"method","version":1}]}"""),
        Def("exports/by-school/v1.json", """{"format":"openquote.export/0","export":"by-school","version":1,"label":"By school","rows":"session","period":{"field":"date"},"columns":[{"label":"Date","field":"date"},{"label":"School","person":"school"}]}"""), Def("exports/plain/v1.json", """{"format":"openquote.export/0","export":"plain","version":1,"label":"Plain","rows":"session","period":{"field":"date"},"columns":[{"label":"Date","field":"date"},{"label":"Practitioner","field":"practitioner","ref":"name"}]}"""),
        Def("packs/narrow/v1.json", """{"format":"openquote.pack/0","pack":"narrow","version":1,"label":"Narrow","depends":{"core":1},"provides":["fields/narrow/session/v1.json","fields/narrow/subject/v1.json"]}"""), Def("fields/narrow/session/v1.json", """{"format":"openquote.fields/0","pack":"narrow","type":"session","version":1,"constrain":[{"name":"method","hidden":true}]}"""),
        Def("fields/narrow/subject/v1.json", """{"format":"openquote.fields/0","pack":"narrow","type":"subject","version":1,"constrain":[{"name":"school","hidden":true}]}"""),
    ];

    [Fact]
    public async Task Lists_the_fields_of_a_type_with_labels_in_the_vault_locale()
    {
        await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. FieldPacks]));

        var session = (await Get("/fields/session")).AsArray().ToDictionary(f => f!["name"]!.GetValue<string>(), f => f!);
        Assert.Equal(["date", "practitioner", "topic", "method", "grade", "note"], session.Keys);
        Assert.Equal("Topic", session["topic"]!["label"]!.GetValue<string>());                // from the vault's labels
        Assert.Equal("Date", session["date"]!["label"]!.GetValue<string>());                  // the definition's own
        Assert.Equal("practitioner", session["practitioner"]!["label"]!.GetValue<string>());  // neither: its name
        Assert.Equal(("coded", "topic", true), (session["topic"]!["kind"]!.GetValue<string>(), session["topic"]!["scheme"]!.GetValue<string>(), session["topic"]!["required"]!.GetValue<bool>()));
        Assert.Equal(("reference", "practitioner"), (session["practitioner"]!["kind"]!.GetValue<string>(), session["practitioner"]!["refType"]!.GetValue<string>()));
        Assert.True(session["method"]!["hidden"]!.GetValue<bool>());
        Assert.Equal("narrative", session["note"]!["tier"]!.GetValue<string>());
        Assert.Equal("grade", session["grade"]!["defaultFromSubject"]!.GetValue<string>());

        var name = (await Get("/fields/subject")).AsArray().Single(f => f!["name"]!.GetValue<string>() == "name")!;
        Assert.Equal(["Full name", "Client"], name["aliases"]!.AsArray().Select(a => a!.GetValue<string>()));
    }

    [Fact]
    public async Task Lists_no_fields_for_a_vault_without_field_definitions()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(1)));

        Assert.Empty((await Get("/fields/session")).AsArray());
    }

    [Fact]
    public async Task Labels_scheme_items_in_the_vault_locale_and_falls_back_to_the_items_own()
    {
        await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. FieldPacks]));

        var method = (await Get("/schemes")).AsArray().Single(s => s!["scheme"]!.GetValue<string>() == "method")!["items"]!.AsArray()
            .ToDictionary(i => i!["code"]!.GetValue<string>(), i => i!["label"]!.GetValue<string>());
        Assert.Equal("Interview", method["interview"]);
        Assert.Equal("전화", method["phone"]);
    }

    [Fact]
    public async Task Offers_the_scheme_version_in_force_on_a_date()
    {
        await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. FieldPacks]));

        Assert.Equal(1, (await Post("/schemes/in-force", new { scheme = "kind", date = "2026-02-28" }))["version"]!.GetValue<int>());
        Assert.Equal(2, (await Post("/schemes/in-force", new { scheme = "kind", date = "2026-03-01" }))["version"]!.GetValue<int>());
        Assert.Null((await Post("/schemes/in-force", new { scheme = "nothing", date = "2026-03-01" }))["version"]);
    }

    [Fact]
    public async Task Does_not_offer_a_form_that_reads_a_hidden_field()
    {
        var summary = await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. FieldPacks]));

        var reports = summary["reports"]!.AsArray().ToDictionary(r => r!["name"]!.GetValue<string>(), r => r!["offered"]!.GetValue<bool>());
        Assert.Equal(new Dictionary<string, bool> { ["monthly-topic"] = true, ["by-method"] = false }, reports);
        var exports = summary["exports"]!.AsArray().ToDictionary(e => e!["name"]!.GetValue<string>(), e => e!["offered"]!.GetValue<bool>());
        Assert.Equal(new Dictionary<string, bool> { ["by-method"] = false, ["by-school"] = false, ["plain"] = true }, exports);
    }

    [Fact]
    public async Task Offers_every_form_of_a_vault_without_field_definitions()
    {
        var summary = await Post("/vault/load", Files(GoldenVault.School.Through(1)));

        Assert.All(summary["reports"]!.AsArray(), r => Assert.True(r!["offered"]!.GetValue<bool>()));
    }

    [Fact]
    public async Task Names_forms_and_export_columns_in_the_vault_locale()
    {
        var summary = await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. FieldPacks]));

        Assert.Equal("Sessions by topic", summary["reports"]!.AsArray().Single(r => r!["name"]!.GetValue<string>() == "monthly-topic")!["label"]!.GetValue<string>());
        var table = await Post("/exports/run", new { export = "plain", version = 1, from = "2026-03-01", to = "2026-03-31" });
        Assert.Equal(["Day", "Practitioner"], table["columns"]!.AsArray().Select(c => c!.GetValue<string>()));
    }

    [Fact]
    public async Task Summarises_the_packs_the_vault_holds_and_what_does_not_fit()
    {
        var summary = await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. TwoPacks]));

        Assert.Equal(["base", "region"], summary["packs"]!.AsArray().Select(p => p!["id"]!.GetValue<string>()));
        Assert.Equal(1, summary["packs"]![1]!["depends"]!["base"]!.GetValue<int>());
        var issue = Assert.Single(summary["packIssues"]!.AsArray());
        Assert.Equal("region", issue!["pack"]!.GetValue<string>()); // it lists a report form the vault does not hold
    }

    [Fact]
    public async Task Orders_the_vault_locales_most_specific_pack_first()
    {
        var summary = await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. TwoPacks]));

        Assert.Equal(["fr", "en"], summary["locales"]!.AsArray().Select(l => l!.GetValue<string>()));
    }

    [Fact]
    public async Task A_vault_without_labels_names_no_locale_and_no_pack()
    {
        var summary = await Post("/vault/load", Files(GoldenVault.School.Through(1)));

        Assert.Empty(summary["locales"]!.AsArray());
        Assert.Empty(summary["packs"]!.AsArray());
        Assert.Empty(summary["packIssues"]!.AsArray());
    }

    [Fact]
    public async Task Says_which_coded_fields_take_several_values()
    {
        var many = new Openquote.Vault.VaultFile("fields/y/session/v1.json", System.Text.Encoding.UTF8.GetBytes(
            """{"format":"openquote.fields/1","pack":"y","type":"session","version":1,"fields":[{"name":"concerns","kind":"coded","scheme":"topic","many":true},{"name":"mode","kind":"coded","scheme":"mode"}]}"""));
        await Post("/vault/load", Files([.. GoldenVault.School.Through(1), many]));

        var fields = (await Get("/fields/session")).AsArray().ToDictionary(f => f!["name"]!.GetValue<string>(), f => f!);

        Assert.True(fields["concerns"]["many"]!.GetValue<bool>());
        Assert.False(fields["mode"]["many"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Says_what_vault_format_files_would_need_before_the_host_writes_them()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(1)));
        var many = new Openquote.Vault.VaultFile("fields/y/session/v1.json", System.Text.Encoding.UTF8.GetBytes(
            """{"format":"openquote.fields/1","pack":"y","type":"session","version":1,"fields":[{"name":"concerns","kind":"coded","scheme":"topic","many":true}]}"""));

        var required = await Post("/vault/required", Files([many]));
        var nothing = await Post("/vault/required", Files([]));

        Assert.Equal((0, 1), (required["now"]!.GetValue<int>(), required["with"]!.GetValue<int>()));
        Assert.Equal(0, nothing["with"]!.GetValue<int>());
    }

    [Fact]
    public async Task Names_the_fields_a_report_form_counts_by()
    {
        var summary = await Post("/vault/load", Files(GoldenVault.School.Through(1)));

        var report = summary["reports"]!.AsArray().First(r => r!["name"]!.GetValue<string>() == "monthly-topic")!;
        Assert.Equal("session", report["counts"]!.GetValue<string>());
        Assert.Equal("date", report["periodField"]!.GetValue<string>());
        Assert.Equal("month", report["unit"]!.GetValue<string>());
        Assert.Equal(["topic", "practitioner"], report["dimensions"]!.AsArray().Select(d => d!["field"]!.GetValue<string>()));
        Assert.Equal("topic", report["dimensions"]![0]!["scheme"]!.GetValue<string>());
        Assert.Null(report["dimensions"]![1]!["scheme"]);
        Assert.Empty(report["filters"]!.AsArray());
        Assert.Equal(["records", "people"], report["measures"]!.AsArray().Select(m => m!.GetValue<string>()));
    }

    [Fact]
    public async Task Lists_the_pending_records_of_a_run_with_the_codes_each_may_take()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(2)));
        var run = await Post("/reports/run", new { report = "monthly-topic", version = 2, from = "2026-04-01" });
        var records = run["record"]!["pending"]!["records"]!.AsArray().Select(r => r!.GetValue<string>()).ToArray();

        var pending = (await Post("/reports/pending", new { report = "monthly-topic", version = 2, records })).AsArray();

        Assert.Equal(records, pending.Select(p => p!["record"]!.GetValue<string>()));
        Assert.All(pending, p =>
        {
            Assert.Equal("topic", p!["field"]!.GetValue<string>());
            Assert.Equal(2, p["version"]!.GetValue<int>());
            Assert.Equal(1, p["was"]!["version"]!.GetValue<int>());
            Assert.True(p["candidates"]!.AsArray().Count > 1);
        });
        Assert.Contains(pending, p => p!["candidates"]!.AsArray().Select(c => c!.GetValue<string>()).SequenceEqual(["relation-peer", "relation-teacher"]));
    }

    [Fact]
    public async Task Refuses_a_code_the_record_is_not_waiting_for()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(2)));
        var run = await Post("/reports/run", new { report = "monthly-topic", version = 2, from = "2026-04-01" });
        var id = run["record"]!["pending"]!["records"]![0]!.GetValue<string>();

        var refused = await Post("/changes/reclassify", new
        {
            type = "session",
            id,
            field = "topic",
            value = new JsonObject { ["scheme"] = "topic", ["version"] = 2, ["code"] = "no-such-code" },
        }, HttpStatusCode.UnprocessableEntity);

        Assert.Contains("no-such-code", refused["error"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Lists_the_runs_it_keeps_and_explains_how_two_differ()
    {
        // The report as it stood after step 2, then after step 3 — the golden r2 and r3.
        await Post("/vault/load", Files(GoldenVault.School.Through(2)));
        var r2 = await Post("/reports/run", new { report = "monthly-topic", version = 2, from = "2026-04-01" });
        await Post("/vault/load", Files(GoldenVault.School.Through(3).Append(FileOf(r2["file"]!))));
        var r3 = await Post("/reports/run", new { report = "monthly-topic", version = 2, from = "2026-04-01" });
        await Post("/vault/add", new { files = new[] { r3["file"] } });

        var runs = (await Get("/runs")).AsArray();
        Assert.Equal(2, runs.Count);
        Assert.Equal("2026-04-01", runs[0]!["period"]!["from"]!.GetValue<string>());

        var compared = await Post("/runs/compare", new { earlier = runs[0]!["id"]!.GetValue<string>(), later = runs[1]!["id"]!.GetValue<string>() });

        var expected = GoldenVault.School.Expected("diff-r2-r3");
        foreach (var key in new[] { "late", "removed", "revised", "moved", "unchanged" })
            Assert.True(JsonNode.DeepEquals(expected[key], compared[key]), key);
        Assert.Equal(r3["record"]!["total"]!.ToJsonString(), compared["later"]!["total"]!.ToJsonString());
    }

    [Fact]
    public async Task Refuses_to_compare_runs_over_different_periods()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(2)));
        var april = await Post("/reports/run", new { report = "monthly-topic", version = 2, from = "2026-04-01" });
        var march = await Post("/reports/run", new { report = "monthly-topic", version = 2, from = "2026-03-01" });
        await Post("/vault/add", new { files = new[] { april["file"], march["file"] } });
        var runs = (await Get("/runs")).AsArray();
        string IdOf(string from) => runs.Single(r => r!["period"]!["from"]!.GetValue<string>() == from)!["id"]!.GetValue<string>();

        var refused = await Post("/runs/compare", new { earlier = IdOf("2026-04-01"), later = IdOf("2026-03-01") },
            HttpStatusCode.UnprocessableEntity);

        Assert.Contains("period", refused["error"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    private static Openquote.Vault.VaultFile FileOf(JsonNode wire) =>
        new(wire["path"]!.GetValue<string>(), Convert.FromBase64String(wire["content"]!.GetValue<string>()));

    private static object Draft(string date) => new
    {
        type = "session",
        date,
        fields = new { date, method = new { scheme = "method", version = 1, code = "interview" } },
    };

    [Fact]
    public async Task Suggests_codes_the_scheme_allows_with_the_settled_records_that_hold_them()
    {
        await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. FieldPacks]));
        var allowed = (await Get("/schemes")).AsArray()
            .Single(s => s!["scheme"]!.GetValue<string>() == "topic" && s["version"]!.GetValue<int>() == 1)!["items"]!.AsArray()
            .Where(i => i!["suggest"]!.GetValue<bool>()).Select(i => i!["code"]!.GetValue<string>()).ToHashSet();
        var sessions = (await Get("/entities/session")).AsArray().Select(s => s!["id"]!.GetValue<string>()).ToHashSet();

        var answer = await Post("/suggestions", Draft("2026-03-20"));

        Assert.True(answer["remembered"]!.GetValue<int>() > 0);
        var topic = Assert.Single(answer["fields"]!.AsArray(), f => f!["field"]!.GetValue<string>() == "topic")!;
        Assert.Equal(("topic", 1), (topic["scheme"]!.GetValue<string>(), topic["version"]!.GetValue<int>()));
        var codes = topic["codes"]!.AsArray();
        Assert.NotEmpty(codes);
        Assert.All(codes, c => Assert.Contains(c!["code"]!.GetValue<string>(), allowed));
        Assert.All(codes.SelectMany(c => c!["similar"]!.AsArray()), id => Assert.Contains(id!.GetValue<string>(), sessions));
        Assert.Contains(codes, c => c!["similar"]!.AsArray().Count > 0);
    }

    [Fact]
    public async Task Learns_again_once_the_vault_holds_more_records()
    {
        await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. FieldPacks]));
        var before = (await Post("/suggestions", Draft("2026-05-20")))["remembered"]!.GetValue<int>();

        await Post("/vault/load", Files([.. GoldenVault.School.Through(2), .. FieldPacks]));
        var after = (await Post("/suggestions", Draft("2026-05-20")))["remembered"]!.GetValue<int>();

        Assert.True(after > before, $"{after} settled records after loading more, {before} before");
    }

    [Fact]
    public async Task Suggests_nothing_for_a_type_without_coded_fields_to_suggest_for()
    {
        await Post("/vault/load", Files([.. GoldenVault.School.Through(1), .. FieldPacks]));

        var answer = await Post("/suggestions", new { type = "subject", date = "2026-03-20", fields = new { name = "someone" } });

        Assert.Empty(answer["fields"]!.AsArray());
    }

    [Fact]
    public async Task Names_the_subject_each_record_belongs_to()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(0)));
        var subjectFile = await Post("/changes/subject", new { fields = new { name = "someone" } });
        await Post("/vault/add", new { files = new[] { subjectFile } });
        var subjectId = subjectFile["path"]!.GetValue<string>().Split('/')[1];
        var sessionFile = await Post("/changes/in-subject", new { subjectId, type = "session", fields = new { date = "2026-04-01" } });
        await Post("/vault/add", new { files = new[] { sessionFile } });

        var sessions = (await Get("/entities/session")).AsArray();

        var mine = sessions.Where(s => s!["subject"]?.GetValue<string>() == subjectId).ToList();
        Assert.Single(mine);
        Assert.Equal("2026-04-01", mine[0]!["fields"]!["date"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_group_session_names_its_group_and_everyone_who_took_part()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(1)));

        var sessions = (await Get("/entities/session")).AsArray();

        var group = sessions.Single(s => s!["id"]!.GetValue<string>() == GoldenVault.School.IdOf("Q25"))!;
        Assert.Equal(GoldenVault.School.IdOf("G01"), group["group"]!.GetValue<string>());
        Assert.Null(group["subject"]);
        Assert.Equal(3, group["people"]!.AsArray().Count);
        var alone = sessions.Single(s => s!["id"]!.GetValue<string>() == GoldenVault.School.IdOf("Q01"))!;
        Assert.Equal([alone["subject"]!.GetValue<string>()], alone["people"]!.AsArray().Select(p => p!.GetValue<string>()));
    }

    [Fact]
    public async Task Records_a_group_and_a_session_it_holds()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(0)));
        var subjectFile = await Post("/changes/subject", new { fields = new { name = "someone" } });
        var groupFile = await Post("/changes/group", new { fields = new { name = "a group" } });
        await Post("/vault/add", new { files = new[] { subjectFile, groupFile } });
        var subjectId = subjectFile["path"]!.GetValue<string>().Split('/')[1];
        var groupId = groupFile["path"]!.GetValue<string>().Split('/')[1];
        Assert.StartsWith("groups/", groupFile["path"]!.GetValue<string>(), StringComparison.Ordinal);

        var sessionFile = await Post("/changes/in-group", new { groupId, type = "session", fields = new { date = "2026-04-01", attendees = new[] { subjectId } } });
        await Post("/vault/add", new { files = new[] { sessionFile } });

        var session = (await Get("/entities/session")).AsArray().Single()!;
        Assert.Equal(groupId, session["group"]!.GetValue<string>());
        Assert.Equal(subjectId, session["people"]!.AsArray().Single()!.GetValue<string>());
        Assert.Single((await Get("/entities/group")).AsArray());
    }

    [Fact]
    public async Task Keeps_which_values_were_taken_from_a_suggestion()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(0)));
        var subjectFile = await Post("/changes/subject", new { fields = new { name = "someone" } });
        await Post("/vault/add", new { files = new[] { subjectFile } });
        var subjectId = subjectFile["path"]!.GetValue<string>().Split('/')[1];

        var sessionFile = await Post("/changes/in-subject", new
        {
            subjectId,
            type = "session",
            fields = new { date = "2026-04-01", topic = new { scheme = "topic", version = 1, code = "family" } },
            source = new { topic = "suggestion" },
        });
        await Post("/vault/add", new { files = new[] { sessionFile } });

        var change = (await Get("/entities/session/history")).AsArray().Single()!["changes"]!.AsArray().Single()!;
        Assert.True(JsonNode.DeepEquals(new JsonObject { ["topic"] = "suggestion" }, change["source"]));
    }

    [Fact]
    public async Task Lists_the_changes_each_entity_was_built_from_oldest_first()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(0)));
        var created = await Post("/changes/subject", new { fields = new { name = "someone" } });
        await Post("/vault/add", new { files = new[] { created } });
        var id = created["path"]!.GetValue<string>().Split('/')[1];
        var renamed = await Post("/changes/update", new { type = "subject", id, fields = new { name = "someone else" } });
        await Post("/vault/add", new { files = new[] { renamed } });

        var history = (await Get("/entities/subject/history")).AsArray().Single(h => h!["id"]!.GetValue<string>() == id)!;
        var changes = history["changes"]!.AsArray();
        Assert.Equal(["create", "update"], changes.Select(c => c!["op"]!.GetValue<string>()));
        Assert.Equal(["someone", "someone else"], changes.Select(c => c!["fields"]!["name"]!.GetValue<string>()));
        Assert.All(changes, c => Assert.False(string.IsNullOrEmpty(c!["device"]!.GetValue<string>())));
        Assert.True(changes[0]!["at"]!.GetValue<DateTimeOffset>() <= changes[1]!["at"]!.GetValue<DateTimeOffset>());
    }

    [Fact]
    public async Task Lays_a_month_out_as_an_export_forms_rows()
    {
        const string form = """
            {"format":"openquote.export/0","export":"list","version":1,"label":"List","rows":"session","period":{"field":"date"},
             "columns":[{"label":"date","field":"date"},{"label":"people","people":"count"},{"label":"topic","field":"topic","scheme":"topic","version":1}]}
            """;
        var exportFile = new Openquote.Vault.VaultFile("exports/list/v1.json", System.Text.Encoding.UTF8.GetBytes(form));
        var summary = await Post("/vault/load", Files(GoldenVault.School.Through(1).Append(exportFile)));
        Assert.Equal("list", summary["exports"]!.AsArray().Single()!["name"]!.GetValue<string>());

        var table = await Post("/exports/run", new { export = "list", version = 1, from = "2026-04-01", to = "2026-04-30" });

        Assert.Equal(["date", "people", "topic"], table["columns"]!.AsArray().Select(c => c!.GetValue<string>()));
        var rows = table["rows"]!.AsArray();
        Assert.Equal(24, rows.Count);
        var group = rows.Single(r => r!["record"]!.GetValue<string>() == GoldenVault.School.IdOf("Q25"))!;
        Assert.Equal("3", group["cells"]![1]!.GetValue<string>());
        Assert.Equal(rows.Select(r => r!["cells"]![0]!.GetValue<string>()).Order(StringComparer.Ordinal), rows.Select(r => r!["cells"]![0]!.GetValue<string>()));
    }

    [Fact]
    public async Task Answers_an_unexpected_failure_with_its_type_and_place_but_not_its_message()
    {
        var answer = await Post("/vault/load", new { files = new[] { new { path = "subjects/s1/x.json", content = "not base64 — 가상 학생" } } },
            HttpStatusCode.InternalServerError);

        Assert.Equal("System.FormatException", answer["fault"]!["type"]!.GetValue<string>());
        Assert.StartsWith("OpenquoteCare.Sidecar.", answer["fault"]!["at"]!.GetValue<string>());
        Assert.DoesNotContain("가상", answer.ToJsonString());
        Assert.Equal(["fault"], answer.AsObject().Select(p => p.Key));
    }

    [Fact]
    public async Task Reports_unreadable_files_when_loading()
    {
        var summary = await Post("/vault/load", Files(GoldenVault.School.Through(1).Concat(GoldenVault.School.Invalid())));

        var unreadable = summary["unreadable"]!.AsArray();
        Assert.Equal(2, unreadable.Count);
        Assert.All(unreadable, u => Assert.NotNull(u!["kind"]!["kind"]));
    }

    [Fact]
    public async Task Lists_the_files_the_host_could_not_decrypt_with_what_they_were_for_and_keeps_them_listed()
    {
        var files = GoldenVault.School.Through(1).Select(f => new { path = f.Path, content = Convert.ToBase64String(f.Content.Span) });
        var undecryptable = new[] { new { path = "schemes/topic/v2.json.age", plain = "schemes/topic/v2.json", detail = "no identity matched" } };
        var loaded = await Post("/vault/load", new { files, undecryptable });

        var listed = Assert.Single(loaded["unreadable"]!.AsArray())!;
        Assert.Equal("schemes/topic/v2.json.age", listed["path"]!.GetValue<string>());
        Assert.Equal("Undecryptable", listed["reason"]!.GetValue<string>());
        Assert.Equal("scheme", listed["kind"]!["kind"]!.GetValue<string>());
        Assert.Equal("topic", listed["kind"]!["name"]!.GetValue<string>());
        Assert.Equal(2, listed["kind"]!["version"]!.GetValue<int>());

        var subjectFile = await Post("/changes/subject", new { fields = new { name = "new subject" } });
        var added = await Post("/vault/add", new { files = new[] { subjectFile } });
        Assert.Single(added["unreadable"]!.AsArray());
        Assert.Single((await Get("/summary"))["unreadable"]!.AsArray());
    }

    [Fact]
    public async Task Hands_back_every_change_as_a_file_and_takes_it_in_once_written()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(2)));

        var subjectFile = await Post("/changes/subject", new { fields = new { name = "new subject" } });
        var added = await Post("/vault/add", new { files = new[] { subjectFile } });
        Assert.Equal(76, added["entities"]!.GetValue<int>());

        // The same file cannot be added twice, just as it cannot be created twice on disk.
        await Post("/vault/add", new { files = new[] { subjectFile } }, HttpStatusCode.Conflict);

        var subjectId = subjectFile["path"]!.GetValue<string>().Split('/')[1];
        var practitionerFile = await Post("/changes/practitioner", new { fields = new { name = "new practitioner" } });
        Assert.StartsWith("practitioners/", practitionerFile["path"]!.GetValue<string>(), StringComparison.Ordinal);
        await Post("/vault/add", new { files = new[] { practitionerFile } });
        var practitioner = GoldenVault.School.IdOf("A");
        var sessionFile = await Post("/changes/in-subject", new
        {
            subjectId,
            type = "session",
            fields = new JsonObject
            {
                ["date"] = "2026-04-30",
                ["practitioner"] = practitioner,
                ["topic"] = new JsonObject { ["scheme"] = "topic", ["version"] = 1, ["code"] = "relation" },
            },
        });
        await Post("/vault/add", new { files = new[] { sessionFile } });
        var sessionId = sessionFile["path"]!.GetValue<string>().Split('/')[2].Split('.')[0];

        var pending = await Post("/reports/run", new { report = "monthly-topic", version = 2, from = "2026-04-01" });
        Assert.Equal(7, pending["record"]!["pending"]!["count"]!.GetValue<int>()); // six from the scenario, plus this one

        var reclassify = await Post("/changes/reclassify", new
        {
            type = "session",
            id = sessionId,
            field = "topic",
            value = new JsonObject { ["scheme"] = "topic", ["version"] = 2, ["code"] = "relation-peer" },
        });
        await Post("/vault/add", new { files = new[] { reclassify } });

        var after = await Post("/reports/run", new { report = "monthly-topic", version = 2, from = "2026-04-01" });
        Assert.Equal(6, after["record"]!["pending"]!["count"]!.GetValue<int>());
        var stillPending = (await Post("/reports/pending", new { report = "monthly-topic", version = 2, records = new[] { sessionId } })).AsArray();
        Assert.Empty(stillPending); // chosen, so no longer waiting
        Assert.Equal(26, after["record"]!["total"]!["count"]!.GetValue<int>());
    }

    [Fact]
    public async Task An_unknown_entity_or_report_is_not_found()
    {
        await Post("/vault/load", Files(GoldenVault.School.Through(1)));

        await Post("/changes/update", new { type = "session", id = "nope", fields = new { note = "x" } }, HttpStatusCode.NotFound);
        await Post("/reports/run", new { report = "monthly-topic", version = 9, from = "2026-04-01" }, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Runs_a_form_over_the_period_of_its_unit_holding_a_day_or_over_the_days_given()
    {
        var pack = Path.GetFullPath(Path.Combine(GoldenVault.School.Root, "..", "format1"));
        await Post("/vault/load", Files(GoldenVault.School.Through(1).Concat(Openquote.Vault.VaultFiles.FromDirectory(pack))));
        var summary = await Get("/summary");
        var year = summary["reports"]!.AsArray().Single(r => r!["name"]!.GetValue<string>() == "test.format1.year-grade-class")!;
        Assert.Equal(("year", 3), (year["unit"]!.GetValue<string>(), year["startMonth"]!.GetValue<int>()));
        Assert.True(year["offered"]!.GetValue<bool>());
        var girls = summary["reports"]!.AsArray().Single(r => r!["name"]!.GetValue<string>() == "test.format1.month-girls")!;
        var filter = girls["filters"]!.AsArray().Single()!;
        Assert.Equal(("gender", true, "F"), (filter["field"]!.GetValue<string>(), filter["ofSubject"]!.GetValue<bool>(), filter["in"]!.AsArray().Single()!.GetValue<string>()));

        // A day in it: the school year from March that holds it.
        var schoolYear = (await Post("/reports/run", new { report = "test.format1.year-grade-class", version = 1, from = "2026-04-15" }))["record"]!;
        Assert.Equal(("2026-03-01", "2027-02-28"), (schoolYear["period"]!["from"]!.GetValue<string>(), schoolYear["period"]!["to"]!.GetValue<string>()));
        Assert.Equal(35, schoolYear["total"]!["count"]!.GetValue<int>());

        // A range runs over exactly the days given, and only so.
        var range = (await Post("/reports/run", new { report = "test.format1.range-concerns", version = 1, from = "2026-03-01", to = "2026-03-31" }))["record"]!;
        Assert.Equal(("2026-03-01", "2026-03-31"), (range["period"]!["from"]!.GetValue<string>(), range["period"]!["to"]!.GetValue<string>()));
        Assert.Equal(10, range["total"]!["count"]!.GetValue<int>());
        await Post("/reports/run", new { report = "test.format1.range-concerns", version = 1, from = "2026-03-01" }, HttpStatusCode.BadRequest);
        await Post("/reports/run", new { report = "test.format1.range-concerns", version = 1, from = "2026-03-31", to = "2026-03-01" }, HttpStatusCode.BadRequest);
        await Post("/reports/run", new { report = "monthly-topic", version = 1, from = "April" }, HttpStatusCode.BadRequest);
    }
}
