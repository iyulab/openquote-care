using System.Text.Json.Nodes;
using Openquote.Records;
using Openquote.Vault;

namespace OpenquoteCare.Tests;

/// <summary>A synthetic vault under <c>tests/&lt;folder&gt;</c>, read step by step.</summary>
internal sealed class GoldenVault
{
    /// <summary><c>tests/golden</c>: Korean school counselling across a classification revision, from before packs had manifests.</summary>
    public static GoldenVault School { get; } = new("golden");

    /// <summary><c>tests/golden-neutral</c>: a vault on the neutral English track, the core and English packs only.</summary>
    public static GoldenVault Neutral { get; } = new("golden-neutral");

    private GoldenVault(string folder) => Root = FindRoot(folder);

    public string Root { get; }

    /// <summary>The vault as it stands after <paramref name="step"/>: steps 1 through n together.</summary>
    public IEnumerable<VaultFile> Through(int step) =>
        Enumerable.Range(1, step).SelectMany(i => VaultFiles.FromDirectory(Path.Combine(Root, "steps", $"{i}")));

    public IEnumerable<VaultFile> Invalid() => VaultFiles.FromDirectory(Path.Combine(Root, "invalid"));

    public JsonNode Expected(string name) => JsonNode.Parse(File.ReadAllText(Path.Combine(Root, "expected", $"{name}.json")))!;

    /// <summary>The id the generator gave the scenario row <paramref name="key"/> (for example a session key).</summary>
    public string IdOf(string key) =>
        Expected("keys").AsObject().Single(kv => kv.Value!.GetValue<string>() == key).Key;

    public static IReadOnlyDictionary<EntityRef, Entity> Entities(VaultContent content) => EntityMerger.Merge(content.Changes);

    private static string FindRoot(string folder)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "tests", folder);
            if (Directory.Exists(Path.Combine(candidate, "steps"))) return candidate;
        }
        throw new DirectoryNotFoundException($"tests/{folder}/steps not found above the test output; run tests/{folder}/generate.cs");
    }
}
