using System.Text.Json.Nodes;
using Openquote.Records;
using Openquote.Vault;

namespace OpenquoteCare.Tests;

/// <summary>The synthetic vault under <c>tests/golden</c>, read step by step.</summary>
internal static class GoldenVault
{
    public static string Root { get; } = FindRoot();

    /// <summary>The vault as it stands after <paramref name="step"/>: steps 1 through n together.</summary>
    public static IEnumerable<VaultFile> Through(int step) =>
        Enumerable.Range(1, step).SelectMany(i => VaultFiles.FromDirectory(Path.Combine(Root, "steps", $"{i}")));

    public static IEnumerable<VaultFile> Invalid() => VaultFiles.FromDirectory(Path.Combine(Root, "invalid"));

    public static JsonNode Expected(string name) => JsonNode.Parse(File.ReadAllText(Path.Combine(Root, "expected", $"{name}.json")))!;

    /// <summary>The id the generator gave the scenario row <paramref name="key"/> (for example a session key).</summary>
    public static string IdOf(string key) =>
        Expected("keys").AsObject().Single(kv => kv.Value!.GetValue<string>() == key).Key;

    public static IReadOnlyDictionary<EntityRef, Entity> Entities(VaultContent content) => EntityMerger.Merge(content.Changes);

    private static string FindRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "tests", "golden");
            if (Directory.Exists(Path.Combine(candidate, "steps"))) return candidate;
        }
        throw new DirectoryNotFoundException("tests/golden/steps not found above the test output; run tests/golden/generate.cs");
    }
}
