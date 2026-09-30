using System.Text.Json.Nodes;
using Openquote.Classification;
using Openquote.Reports;
using Openquote.Vault;

namespace OpenquoteCare.Tests;

/// <summary>
/// The engine must reproduce, number for number and record for record, the report runs that were
/// worked out by hand for the golden vault.
/// </summary>
public class GoldenVaultTests
{
    private static ReportRun Run(int step, int reportVersion, int month)
    {
        var content = VaultReader.Read(GoldenVault.School.Through(step));
        Assert.Empty(content.Unreadable);
        var report = content.Reports.Single(r => r.Name == "monthly-topic" && r.Version == reportVersion);
        return ReportRunner.RunMonth(report, 2026, month, GoldenVault.Entities(content).Values, content.Catalog());
    }

    private static SchemeCatalog CatalogThrough(int step) =>
        VaultReader.Read(GoldenVault.School.Through(step)).Catalog();

    private static JsonObject RunRecord(ReportRun run)
    {
        var json = JsonNode.Parse(ReportRunJson.Write(run, "00000000-0000-7000-8000-000000000000", "test", DateTimeOffset.UnixEpoch))!.AsObject();
        json.Remove("id");
        json.Remove("device");
        json.Remove("at");
        return json;
    }

    [Theory]
    [InlineData("r0", 1, 1, 2)] // a month with no records
    [InlineData("r1", 1, 1, 4)] // April on the first scheme version, before the late entry
    [InlineData("r2", 2, 2, 4)] // after the late entry and the revision: assigned, pending, unmapped
    [InlineData("r3", 3, 2, 4)] // after four pending records were reclassified by hand
    public void Reproduces_the_hand_computed_run(string name, int step, int reportVersion, int month)
    {
        var got = RunRecord(Run(step, reportVersion, month));

        Assert.True(JsonNode.DeepEquals(GoldenVault.School.Expected(name), got), $"{name} differs:\n{got.ToJsonString()}");
    }

    [Theory]
    [InlineData("r1-r2", 1, 1, 2, 2)]
    [InlineData("r2-r3", 2, 2, 3, 2)]
    public void Tells_late_entries_from_reclassified_records(string name, int stepA, int versionA, int stepB, int versionB)
    {
        var diff = ReportDiff.Compare(Run(stepA, versionA, 4), Run(stepB, versionB, 4), CatalogThrough(stepB));
        var expected = GoldenVault.School.Expected($"diff-{name}");

        string[] Ids(string key) => [.. expected[key]!.AsArray().Select(n => n!.GetValue<string>())];
        Assert.Equal(Ids("late"), diff.Late);
        Assert.Equal(Ids("removed"), diff.Removed);
        Assert.Equal(Ids("revised"), diff.Revised);
        Assert.Equal(Ids("moved"), diff.Moved);
        Assert.Equal(Ids("unchanged"), diff.Unchanged);
    }

    [Fact]
    public void The_late_entry_is_the_session_entered_after_the_april_run()
    {
        var diff = ReportDiff.Compare(Run(1, 1, 4), Run(2, 2, 4), CatalogThrough(2));

        Assert.Equal([GoldenVault.School.IdOf("Q22")], diff.Late);
    }

    [Fact]
    public void Unreadable_files_are_reported_and_change_no_number()
    {
        var content = VaultReader.Read(GoldenVault.School.Through(1).Concat(GoldenVault.School.Invalid()));

        Assert.Equal(
            [UnreadableReason.Malformed, UnreadableReason.NameMismatch],
            content.Unreadable.Select(u => u.Reason).Order());

        var report = content.Reports.Single(r => r.Version == 1);
        var run = ReportRunner.RunMonth(report, 2026, 4, GoldenVault.Entities(content).Values, content.Catalog());
        Assert.True(JsonNode.DeepEquals(GoldenVault.School.Expected("r1"), RunRecord(run)));
    }

    [Fact]
    public void Two_devices_editing_one_field_unseen_keep_both_values()
    {
        var content = VaultReader.Read(GoldenVault.School.Through(3));
        var session = GoldenVault.Entities(content).Values.Single(e => e.Reference.Id == GoldenVault.School.IdOf("Q05"));

        var heads = session.Conflicts["method"];
        Assert.Equal(["pc01", "pc02"], heads.Select(h => h.Device));
        Assert.Equal(["interview", "consult"], heads.Select(h => h.Value.GetProperty("code").GetString()));
    }

    [Fact]
    public void An_old_report_version_still_counts_reclassified_records_by_their_original_value()
    {
        // After step 3 four April sessions carry a version-2 topic; the version-1 form still
        // places them by the value they were entered with.
        var rerun = RunRecord(Run(3, 1, 4));
        var r1 = RunRecord(Run(1, 1, 4));

        var withoutLate = rerun["total"]!["count"]!.GetValue<int>() - 1; // the late entry arrived in step 2
        Assert.Equal(r1["total"]!["count"]!.GetValue<int>(), withoutLate);
        Assert.Equal(0, rerun["pending"]!["count"]!.GetValue<int>());
        Assert.Equal(0, rerun["unmapped"]!["count"]!.GetValue<int>());
    }
}
