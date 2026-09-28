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
        var summary = await Post("/vault/load", Files(GoldenVault.Through(3)));
        Assert.Equal(79, summary["changes"]!.GetValue<int>());
        Assert.Equal(73, summary["entities"]!.GetValue<int>());
        Assert.Equal(1, summary["conflicts"]!.GetValue<int>());
        Assert.Empty(summary["unreadable"]!.AsArray());

        var result = await Post("/reports/run", new { report = "monthly-topic", version = 2, year = 2026, month = 4 });

        var record = result["record"]!.AsObject();
        Assert.Equal("pc09", record["device"]!.GetValue<string>());
        foreach (var key in new[] { "id", "device", "at" }) record.Remove(key);
        Assert.True(JsonNode.DeepEquals(GoldenVault.Expected("r3"), record));
        Assert.Matches(@"^runs/\d{4}/[0-9a-f-]{36}\.pc09\.json$", result["file"]!["path"]!.GetValue<string>());
    }

    [Fact]
    public async Task Lists_every_scheme_version_with_its_items()
    {
        await Post("/vault/load", Files(GoldenVault.Through(2)));

        var schemes = await Get("/schemes");

        var topics = schemes.AsArray().Where(s => s!["scheme"]!.GetValue<string>() == "topic").ToList();
        Assert.Equal([1, 2], topics.Select(t => t!["version"]!.GetValue<int>()));
        var item = topics[1]!["items"]!.AsArray().First(i => i!["code"]!.GetValue<string>() == "relation-peer")!;
        Assert.False(string.IsNullOrEmpty(item["label"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Summarises_the_loaded_vault_on_request()
    {
        var loaded = await Post("/vault/load", Files(GoldenVault.Through(3)));

        var summary = await Get("/summary");

        Assert.True(JsonNode.DeepEquals(loaded, summary));
        Assert.Contains(summary["reports"]!.AsArray(), r => r!["name"]!.GetValue<string>() == "monthly-topic" && r["version"]!.GetValue<int>() == 2);
    }

    [Fact]
    public async Task Carries_values_to_a_later_version_and_names_the_candidates_of_a_split()
    {
        await Post("/vault/load", Files(GoldenVault.Through(2)));
        JsonObject Topic(string code) => new() { ["scheme"] = "topic", ["version"] = 1, ["code"] = code };

        var resolved = (await Post("/classification/resolve", new
        {
            targetVersion = 2,
            values = new[] { Topic("family"), Topic("relation"), Topic("other") },
        })).AsArray();

        Assert.Equal("assigned", resolved[0]!["kind"]!.GetValue<string>());
        Assert.Equal("family", resolved[0]!["code"]!.GetValue<string>());
        Assert.Equal("pending", resolved[1]!["kind"]!.GetValue<string>());
        Assert.Equal(["relation-peer", "relation-teacher"], resolved[1]!["candidates"]!.AsArray().Select(c => c!.GetValue<string>()));
        Assert.Equal("unmapped", resolved[2]!["kind"]!.GetValue<string>());
    }

    [Fact]
    public async Task Lists_the_runs_it_keeps_and_explains_how_two_differ()
    {
        // The report as it stood after step 2, then after step 3 — the golden r2 and r3.
        await Post("/vault/load", Files(GoldenVault.Through(2)));
        var r2 = await Post("/reports/run", new { report = "monthly-topic", version = 2, year = 2026, month = 4 });
        await Post("/vault/load", Files(GoldenVault.Through(3).Append(FileOf(r2["file"]!))));
        var r3 = await Post("/reports/run", new { report = "monthly-topic", version = 2, year = 2026, month = 4 });
        await Post("/vault/add", new { files = new[] { r3["file"] } });

        var runs = (await Get("/runs")).AsArray();
        Assert.Equal(2, runs.Count);
        Assert.Equal("2026-04-01", runs[0]!["period"]!["from"]!.GetValue<string>());

        var compared = await Post("/runs/compare", new { earlier = runs[0]!["id"]!.GetValue<string>(), later = runs[1]!["id"]!.GetValue<string>() });

        var expected = GoldenVault.Expected("diff-r2-r3");
        foreach (var key in new[] { "late", "removed", "moved", "unchanged" })
            Assert.True(JsonNode.DeepEquals(expected[key], compared[key]), key);
        Assert.Equal(r3["record"]!["total"]!.ToJsonString(), compared["later"]!["total"]!.ToJsonString());
    }

    private static Openquote.Vault.VaultFile FileOf(JsonNode wire) =>
        new(wire["path"]!.GetValue<string>(), Convert.FromBase64String(wire["content"]!.GetValue<string>()));

    [Fact]
    public async Task Names_the_subject_each_record_belongs_to()
    {
        await Post("/vault/load", Files(GoldenVault.Through(0)));
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
    public async Task Reports_unreadable_files_when_loading()
    {
        var summary = await Post("/vault/load", Files(GoldenVault.Through(1).Concat(GoldenVault.Invalid())));

        Assert.Equal(2, summary["unreadable"]!.AsArray().Count);
    }

    [Fact]
    public async Task Hands_back_every_change_as_a_file_and_takes_it_in_once_written()
    {
        await Post("/vault/load", Files(GoldenVault.Through(2)));

        var subjectFile = await Post("/changes/subject", new { fields = new { name = "new subject" } });
        var added = await Post("/vault/add", new { files = new[] { subjectFile } });
        Assert.Equal(74, added["entities"]!.GetValue<int>());

        // The same file cannot be added twice, just as it cannot be created twice on disk.
        await Post("/vault/add", new { files = new[] { subjectFile } }, HttpStatusCode.Conflict);

        var subjectId = subjectFile["path"]!.GetValue<string>().Split('/')[1];
        var practitionerFile = await Post("/changes/practitioner", new { fields = new { name = "new practitioner" } });
        Assert.StartsWith("practitioners/", practitionerFile["path"]!.GetValue<string>(), StringComparison.Ordinal);
        await Post("/vault/add", new { files = new[] { practitionerFile } });
        var practitioner = GoldenVault.IdOf("A");
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

        var pending = await Post("/reports/run", new { report = "monthly-topic", version = 2, year = 2026, month = 4 });
        Assert.Equal(7, pending["record"]!["pending"]!["count"]!.GetValue<int>()); // six from the scenario, plus this one

        var reclassify = await Post("/changes/reclassify", new
        {
            type = "session",
            id = sessionId,
            field = "topic",
            value = new JsonObject { ["scheme"] = "topic", ["version"] = 2, ["code"] = "relation-peer" },
        });
        await Post("/vault/add", new { files = new[] { reclassify } });

        var after = await Post("/reports/run", new { report = "monthly-topic", version = 2, year = 2026, month = 4 });
        Assert.Equal(6, after["record"]!["pending"]!["count"]!.GetValue<int>());
        Assert.Equal(25, after["record"]!["total"]!["count"]!.GetValue<int>());
    }

    [Fact]
    public async Task An_unknown_entity_or_report_is_not_found()
    {
        await Post("/vault/load", Files(GoldenVault.Through(1)));

        await Post("/changes/update", new { type = "session", id = "nope", fields = new { note = "x" } }, HttpStatusCode.NotFound);
        await Post("/reports/run", new { report = "monthly-topic", version = 9, year = 2026, month = 4 }, HttpStatusCode.NotFound);
    }
}
