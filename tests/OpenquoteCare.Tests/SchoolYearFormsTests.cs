using Openquote.Reports;
using Openquote.Vault;

namespace OpenquoteCare.Tests;

/// <summary>
/// The school pack's school-year report forms, run over the first step of the golden vault — 35 sessions
/// from March, each saying who it was with (30 the student, 3 a parent, 2 a teacher).
/// </summary>
public sealed class SchoolYearFormsTests
{
    private static readonly string Pack = Path.GetFullPath(Path.Combine(GoldenVault.School.Root, "..", "..", "packs", "care.school.kr"));

    private static ReportRun Run(string report)
    {
        var forms = VaultFiles.FromDirectory(Pack).Where(f => f.Path.StartsWith("reports/year-", StringComparison.Ordinal));
        var content = VaultReader.Read(GoldenVault.School.Through(1).Concat(forms));
        Assert.Empty(content.Unreadable);
        var form = content.Reports.Single(r => r.Name == report);
        return ReportRunner.RunContaining(form, new DateOnly(2026, 4, 1), GoldenVault.Entities(content).Values, content.Catalog());
    }

    private static int Sum(ReportRun run, Func<IReadOnlyList<string?>, bool> where) =>
        run.Cells.Where(c => where(c.Key)).Sum(c => c.Records.Count);

    [Theory]
    [InlineData("year-grade-class")]
    [InlineData("year-grade-gender")]
    [InlineData("year-client-type")]
    public void Every_session_of_the_school_year_is_in_a_cell(string report)
    {
        var run = Run(report);

        Assert.Equal((new DateOnly(2026, 3, 1), new DateOnly(2027, 2, 28)), (run.From, run.To));
        Assert.Equal((35, 13), (run.Total.Count, run.PeopleOf(run.Total)!.Count));
        Assert.Equal(35, Sum(run, _ => true));
        Assert.Empty(run.Pending.Concat(run.Unmapped).Concat(run.Blank).Concat(run.Conflicted));
    }

    [Fact]
    public void Sessions_with_a_parent_or_a_teacher_are_counted_apart_from_the_students()
    {
        var run = Run("year-client-type");

        Assert.Equal((30, 3, 2), (Sum(run, k => k[0] == "student"), Sum(run, k => k[0] == "parent"), Sum(run, k => k[0] == "teacher")));
    }
}
