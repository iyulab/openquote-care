using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Openquote.Fields;
using Openquote.Vault;

namespace OpenquoteCare.Tests;

/// <summary>The data packs bundled with the app, read by the engine as a vault on each track would hold them.</summary>
public sealed class PackFilesTests
{
    private static readonly string Packs = Path.GetFullPath(Path.Combine(GoldenVault.Root, "..", "..", "packs"));

    private static JsonNode Json(string path) => JsonNode.Parse(File.ReadAllText(path))!;

    public static TheoryData<string> Tracks() =>
        [.. Json(Path.Combine(Packs, "tracks.json"))["tracks"]!.AsArray().Select(t => t!["id"]!.GetValue<string>())];

    // The folders of a track's packs and every pack they build on, as tracks.json and the manifests say.
    private static IEnumerable<string> PacksOf(string track)
    {
        var manifests = Directory.GetDirectories(Packs)
            .Select(dir => (Dir: dir, Manifest: Directory.GetFiles(Path.Combine(dir, "packs"), "*.json", SearchOption.AllDirectories).Select(Json).Single()))
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
    public void The_neutral_tracks_hold_no_school_field()
    {
        foreach (var track in new[] { "care-en", "care-kr" })
        {
            var fields = VaultOn(track).FieldCatalog();
            Assert.Null(fields.Find("session", "topic"));
            Assert.Null(fields.Find("subject", "school"));
            Assert.False(fields.Find("session", "concern")!.Hidden);
        }
    }

    [Theory]
    [InlineData("care-en", "en")]
    [InlineData("care-kr", "ko")]
    [InlineData("school-kr", "ko")]
    public void Every_core_field_scheme_item_and_form_has_a_label_in_the_tracks_locale(string track, string locale)
    {
        var content = VaultOn(track);
        var labels = content.LabelCatalog();
        var fields = content.FieldCatalog();

        foreach (var type in new[] { "session", "subject" })
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
