using System.Globalization;
using Openquote.Classification;
using Openquote.Reports;
using Openquote.Vault;

namespace OpenquoteCare.Sidecar;

/// <summary>
/// The lists a records folder keeps beside the schemes its packs give: one per scheme, named
/// <c>local.&lt;scheme&gt;</c> (<c>local</c> is the id reserved for the vault itself), extending it. Every
/// item a person adds names the item of the shared scheme it counts as, so whatever the packs count
/// stays as it was; the list's own items are offered beside the shared ones.
/// </summary>
internal static class LocalLists
{
    private const string Prefix = "local.";
    private const string CodePrefix = "local-";

    /// <summary>Why an item cannot be added, as the screen names it.</summary>
    internal sealed class Refused(string reason) : Exception(reason);

    /// <summary>The name of the list a folder keeps beside <paramref name="scheme"/>.</summary>
    internal static string NameFor(string scheme) => Prefix + scheme;

    /// <summary>
    /// The files that add an item labelled <paramref name="label"/>, counted as <paramref name="anchor"/>,
    /// to the folder's list beside <paramref name="scheme"/>: the list's next version — every item it
    /// held and the new one, extending the version of the scheme in force on <paramref name="date"/> —
    /// and, after the first, the crosswalk that links each earlier item to itself.
    /// </summary>
    internal static IReadOnlyList<VaultFile> Add(IReadOnlyList<Scheme> schemes, SchemeCatalog catalog, string scheme, DateOnly date, string label, string anchor)
    {
        var name = NameFor(scheme);
        label = label.Trim();
        if (label.Length == 0) throw new Refused("label-empty");
        if ((catalog.InForce(scheme, date) ?? schemes.Where(s => s.Name == scheme).MaxBy(s => s.Version)) is not { } shared)
            throw new Refused("no-scheme");
        var versions = schemes.Where(s => s.Name == name).ToList();
        var current = versions.MaxBy(s => s.Version);
        // The list follows the shared scheme to the version in force, unless an item it holds has no
        // anchor there: then it keeps extending the version it did, which its crosswalks carry on.
        var extended = current is { Extends: { } held } && current.Items.Any(i => !shared.Contains(i.Anchor!))
            ? catalog.Find(held.Scheme, held.Version) ?? shared
            : shared;
        if (!extended.Contains(anchor)) throw new Refused("anchor-unknown");
        var items = current?.Items ?? [];
        if (items.Any(i => string.Equals(i.Label.Trim(), label, StringComparison.CurrentCultureIgnoreCase))
            || extended.Items.Any(i => string.Equals(i.Label.Trim(), label, StringComparison.CurrentCultureIgnoreCase)))
            throw new Refused("label-taken");

        // A code is never given twice, even one an earlier version held and a later one let go.
        var next = versions.SelectMany(s => s.Items)
            .Select(i => i.Code.StartsWith(CodePrefix, StringComparison.Ordinal)
                && int.TryParse(i.Code.AsSpan(CodePrefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0)
            .DefaultIfEmpty(0).Max() + 1;
        var version = (current?.Version ?? 0) + 1;
        var list = new Scheme(name, version, [.. items, new SchemeItem($"{CodePrefix}{next}", label, null, false) { Anchor = anchor }])
        {
            Extends = new SchemeVersion(extended.Name, extended.Version),
        };
        var files = new List<VaultFile> { DefinitionWriter.Scheme(list) };
        if (current is not null)
            files.Add(DefinitionWriter.Crosswalk(new Crosswalk(name, current.Version, version, [.. current.Items.Select(i => (i.Code, i.Code))])));
        return files;
    }

    /// <summary>
    /// The forms counting by the folder's own lists that it does not hold yet: for the newest version
    /// of each form that places records by a scheme the folder keeps a list beside, the same form
    /// placing them by that list instead — in its version in force, so the form follows the list as it
    /// grows, and records of the scheme's own items fall outside it. Named <c>local.&lt;scheme&gt;.&lt;form&gt;</c>
    /// at the form's version, labelled <paramref name="labelOf"/>'s name for the form followed by
    /// <paramref name="suffix"/>.
    /// </summary>
    internal static IReadOnlyList<VaultFile> Forms(VaultContent content, Func<ReportDefinition, string> labelOf, string suffix)
    {
        var lists = content.Schemes.Where(s => s.Name.StartsWith(Prefix, StringComparison.Ordinal))
            .Select(s => s.Name[Prefix.Length..]).ToHashSet(StringComparer.Ordinal);
        var held = content.Reports.Select(r => (r.Name, r.Version)).ToHashSet();
        var files = new List<VaultFile>();
        foreach (var form in content.Reports.GroupBy(r => r.Name, StringComparer.Ordinal).Select(g => g.MaxBy(r => r.Version)!))
        {
            foreach (var scheme in form.Dimensions.Where(d => d.Scheme is { } s && lists.Contains(s)).Select(d => d.Scheme!).Distinct(StringComparer.Ordinal))
            {
                var local = form with
                {
                    Name = $"{NameFor(scheme)}.{form.Name}",
                    Label = labelOf(form) + suffix,
                    Dimensions = [.. form.Dimensions.Select(d => d.Scheme == scheme ? d with { Scheme = NameFor(scheme), Version = null } : d)],
                };
                if (held.Contains((local.Name, local.Version)) || local.Problem() is not null) continue;
                files.Add(DefinitionWriter.Report(local));
            }
        }
        return files;
    }
}
