using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Openquote.Exports;
using Openquote.Reports;
using Openquote.Vault;

namespace OpenquoteCare.Tests;

/// <summary>
/// A vault on the neutral English track — the core and English packs, nothing of a field or a
/// region — must count and list its sessions exactly as they were worked out by hand.
/// </summary>
public partial class NeutralGoldenVaultTests
{
    private static readonly GoldenVault Vault = GoldenVault.Neutral;

    private static VaultContent Content()
    {
        var content = VaultReader.Read(Vault.Through(1));
        Assert.Empty(content.Unreadable);
        return content;
    }

    private static ReportRun Run(VaultContent content, int month) =>
        ReportRunner.RunMonth(content.Reports.Single(r => r.Name == "care.monthly-concern"), 2026, month,
            GoldenVault.Entities(content).Values, content.Catalog());

    private static JsonObject RunRecord(ReportRun run)
    {
        var json = JsonNode.Parse(ReportRunJson.Write(run, "00000000-0000-7000-8000-000000000000", "test", DateTimeOffset.UnixEpoch))!.AsObject();
        json.Remove("id");
        json.Remove("device");
        json.Remove("at");
        return json;
    }

    private static ExportTable April(VaultContent content, ExportDefinition form) =>
        ExportRunner.Run(form, new DateOnly(2026, 4, 1), new DateOnly(2026, 4, 30), GoldenVault.Entities(content).Values,
            content.Catalog(), content.FieldCatalog());

    [Theory]
    [InlineData("r1", 3)] // March: one practitioner's client seen twice, a session at 23:30 on the last day
    [InlineData("r2", 4)] // April: a session without a concern, one without a mode, a group session
    [InlineData("r3", 5)] // May: a concern suggested only set apart, to be confirmed
    public void Reproduces_the_neutral_run(string name, int month)
    {
        var got = RunRecord(Run(Content(), month));

        Assert.True(JsonNode.DeepEquals(Vault.Expected(name), got), $"{name} differs:\n{got.ToJsonString()}");
    }

    [Fact]
    public void The_neutral_vault_holds_no_school_or_korean_pack()
    {
        var content = Content();

        Assert.Equal(["care", "en"], content.Packs.Select(p => p.Id).Distinct().Order(StringComparer.Ordinal));
        Assert.Empty(content.CheckPacks());
        Assert.Equal(["en"], content.Labels.Select(l => l.Locale).Distinct());
        Assert.DoesNotContain(content.Schemes, s => s.Name.Contains("school", StringComparison.Ordinal));
        foreach (var file in Directory.GetFiles(Path.Combine(Vault.Root, "steps"), "*", SearchOption.AllDirectories))
            Assert.False(Hangul().IsMatch(File.ReadAllText(file)), $"{Path.GetRelativePath(Vault.Root, file)} holds Korean");
    }

    [Fact]
    public void The_neutral_vault_holds_the_packs_as_the_app_bundles_them()
    {
        var packs = Path.GetFullPath(Path.Combine(Vault.Root, "..", "..", "packs"));
        var step = Path.Combine(Vault.Root, "steps", "1");
        foreach (var pack in new[] { "care", "en" })
            foreach (var file in Directory.GetFiles(Path.Combine(packs, pack), "*", SearchOption.AllDirectories))
            {
                var copy = Path.Combine(step, Path.GetRelativePath(Path.Combine(packs, pack), file));
                Assert.True(File.Exists(copy) && File.ReadAllBytes(copy).AsSpan().SequenceEqual(File.ReadAllBytes(file)),
                    $"{Path.GetRelativePath(packs, file)} changed since the vault was generated; run tests/golden-neutral/generate.cs");
            }
    }

    [Fact]
    public void A_session_without_a_concern_is_counted_apart_from_the_rows()
    {
        var run = Run(Content(), 4);
        var none = Vault.IdOf("S08");

        Assert.Empty(run.Unmapped); // no value to count is not a gap in the crosswalks
        Assert.Equal([none], run.Blank);
        Assert.DoesNotContain(none, run.Cells.SelectMany(c => c.Records));
        Assert.Contains(none, run.Total);
        Assert.Equal(run.Total.Count - 1, run.Cells.Sum(c => c.Count));
    }

    [Fact]
    public void Exports_the_neutral_session_list_and_withholds_written_content()
    {
        var content = Content();
        var form = content.Exports.Single(e => e.Name == "care.session-list");

        var table = April(content, form);

        var expected = Vault.Expected("export-1")["rows"]!.AsArray();
        Assert.Equal(expected.Select(r => r!["record"]!.GetValue<string>()), table.Rows.Select(r => r.Record));
        Assert.Equal(expected.Select(r => string.Join(" | ", r!["cells"]!.AsArray().Select(c => c!.GetValue<string>()))),
            table.Rows.Select(r => string.Join(" | ", r.Cells)));
        Assert.Empty(table.Pending);
        Assert.Empty(table.Unmapped); // an empty concern is an empty cell in a list, not a gap
        Assert.Empty(table.Withheld);

        // A form that asks for the notes gets an empty column, named — the notes never reach a cell.
        var withNotes = form with { Columns = [.. form.Columns, new FieldColumn("Notes", "note")] };
        var guarded = April(content, withNotes);

        Assert.Equal(["Notes"], guarded.Withheld);
        Assert.All(guarded.Rows, r => Assert.Equal("", r.Cells[^1]));
        Assert.DoesNotContain(guarded.Rows.SelectMany(r => r.Cells), c => c.Contains("Synthetic note", StringComparison.Ordinal));
    }

    [GeneratedRegex(@"[가-힣]")]
    private static partial Regex Hangul();
}
