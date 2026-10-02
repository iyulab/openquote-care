using Openquote.Reports;
using Openquote.Vault;

namespace OpenquoteCare.Tests;

/// <summary>
/// <c>tests/format1</c>: a test pack of format 1 report forms and a field taking several values,
/// run over the first step of the golden vault — whose students carry a grade, a class and a gender.
/// The expected numbers were counted from the step's change files by a script that does not use the engine.
/// </summary>
public sealed class Format1PackTests
{
    private const string TeacherA = "019ca6b1-dc00-71ef-96f6-3a3386e49a8b";
    private const string TeacherB = "019ca6b2-c660-733b-b869-66d84b107ea2";

    private static readonly string Pack = Path.GetFullPath(Path.Combine(GoldenVault.School.Root, "..", "format1"));

    private static VaultContent Content() =>
        VaultReader.Read(GoldenVault.School.Through(1).Concat(VaultFiles.FromDirectory(Pack)));

    private static ReportRun Run(string report, DateOnly day)
    {
        var content = Content();
        var form = content.Reports.Single(r => r.Name == report);
        return ReportRunner.RunContaining(form, day, GoldenVault.Entities(content).Values, content.Catalog());
    }

    private static ReportCell Cell(ReportRun run, params string?[] key) =>
        run.Cells.Single(c => c.Key.SequenceEqual(key));

    [Fact]
    public void The_pack_reads_clean_and_needs_format_1()
    {
        var content = Content();

        Assert.Empty(content.Unreadable);
        Assert.Empty(content.CheckPacks());
        Assert.Empty(content.FieldCatalog().Issues);
        Assert.Equal(0, content.DeclaredVersion);
        Assert.Equal(1, content.RequiredVersion); // the field taking several values
        Assert.True(content.FieldCatalog().Find("session", "concerns")!.Many);
        Assert.Equal("parent", content.FieldCatalog().Find("session", "counterpart")!.DefaultValue);
        Assert.Equal("45", content.FieldCatalog().Find("session", "period_minutes")!.DefaultValue);
        Assert.Equal(3, content.Reports.Count(r => r.Name.StartsWith("test.format1.", StringComparison.Ordinal)));
    }

    [Fact]
    public void A_school_year_by_grade_class_and_topic()
    {
        var run = Run("test.format1.year-grade-class", new DateOnly(2026, 4, 1));

        Assert.Equal((new DateOnly(2026, 3, 1), new DateOnly(2027, 2, 28)), (run.From, run.To));
        Assert.Equal(17, run.Cells.Count);
        Assert.Equal((35, 13, 37), (run.Total.Count, run.PeopleOf(run.Total)!.Count, run.VisitsOf(run.Total)));
        Assert.Equal(5, Cell(run, "2", "3", "depression").Records.Count);
        Assert.Equal(3, Cell(run, "5", "2", "learning").Records.Count);
        // The group session is about three students in different grades and classes: no single value.
        var group = Cell(run, null, null, "emotional-behavioral");
        Assert.Equal((1, 3, 3), (group.Records.Count, run.PeopleOf(group.Records)!.Count, run.VisitsOf(group.Records)));
        Assert.Empty(run.Pending.Concat(run.Unmapped).Concat(run.Blank).Concat(run.Conflicted));
    }

    [Fact]
    public void A_month_of_girls_only_by_topic_and_counsellor()
    {
        var run = Run("test.format1.month-girls", new DateOnly(2026, 4, 15));

        Assert.Equal((new DateOnly(2026, 4, 1), new DateOnly(2026, 4, 30)), (run.From, run.To));
        // 24 April sessions: 11 about boys and the group session of mixed students are not in the run.
        Assert.Equal((12, 12), (run.Total.Count, run.VisitsOf(run.Total)));
        Assert.Equal(9, run.Cells.Count);
        Assert.Equal(3, Cell(run, "depression", TeacherA).Records.Count);
        Assert.Equal(2, Cell(run, "relation", TeacherB).Records.Count);
        Assert.Equal([ReportMeasure.Records, ReportMeasure.Visits], run.Report.Measures);
    }

    [Fact]
    public void A_range_by_every_topic_covered_holds_records_without_one_apart()
    {
        var content = Content();
        var form = content.Reports.Single(r => r.Name == "test.format1.range-concerns");
        var run = ReportRunner.Run(form, new DateOnly(2026, 3, 1), new DateOnly(2026, 5, 31), GoldenVault.Entities(content).Values, content.Catalog());

        Assert.True(run.Multiple);
        Assert.Empty(run.Cells);
        Assert.Equal(35, run.Blank.Count); // no session of the golden vault has the field yet
    }
}
