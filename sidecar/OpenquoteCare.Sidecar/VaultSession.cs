using Openquote.Fields;
using Openquote.Labels;
using Openquote.Packs;
using Openquote.Records;
using Openquote.Vault;

namespace OpenquoteCare.Sidecar;

/// <summary>
/// The open vault, as plaintext files the host decrypted and handed over. Everything derived from
/// them (merged entities, the scheme catalog) is rebuilt from the files, never kept on its own.
/// </summary>
internal sealed class VaultSession
{
    private readonly Lock _gate = new();
    private readonly Dictionary<string, VaultFile> _files = new(StringComparer.Ordinal);
    private IReadOnlyList<UndecryptableFile> _undecryptable = [];
    private Snapshot? _snapshot;

    /// <param name="Locales">
    /// The locales the vault's packs label things in, the most specific pack's first: a pack comes after
    /// everything it builds on, so the last in pack order speaks for the vault. Empty when the vault holds
    /// no labels (every vault made before packs carried them).
    /// </param>
    internal sealed record Snapshot(
        VaultContent Content,
        IReadOnlyDictionary<EntityRef, Entity> Entities,
        IReadOnlyList<UndecryptableFile> Undecryptable,
        FieldCatalog Fields,
        LabelCatalog Labels,
        IReadOnlyList<string> Locales);

    /// <summary>Replaces the whole vault, with the files the host could not decrypt.</summary>
    public Snapshot Load(IEnumerable<VaultFile> files, IReadOnlyList<UndecryptableFile> undecryptable)
    {
        lock (_gate)
        {
            _undecryptable = undecryptable;
            _files.Clear();
            foreach (var f in files) _files[f.Path] = f;
            return Rebuild();
        }
    }

    /// <summary>Adds files the host has just written. A path already held is refused, as on disk.</summary>
    public Snapshot Add(IEnumerable<VaultFile> files)
    {
        lock (_gate)
        {
            var incoming = files.ToList();
            var taken = incoming.Where(f => _files.ContainsKey(f.Path)).Select(f => f.Path).ToList();
            if (taken.Count > 0) throw new InvalidOperationException($"already in the vault: {string.Join(", ", taken)}");
            foreach (var f in incoming) _files[f.Path] = f;
            return Rebuild();
        }
    }

    public Snapshot Current
    {
        get
        {
            lock (_gate) return _snapshot ?? throw new InvalidOperationException("no vault is loaded");
        }
    }

    private Snapshot Rebuild()
    {
        var content = VaultReader.Read(_files.Values);
        return _snapshot = new Snapshot(content, EntityMerger.Merge(content.Changes), _undecryptable,
            content.FieldCatalog(), content.LabelCatalog(), LocalesOf(content));
    }

    private static string[] LocalesOf(VaultContent content)
    {
        var rank = new PackGraph(content.Packs).Order().Select((id, i) => (id, i)).ToDictionary(x => x.id, x => x.i, StringComparer.Ordinal);
        return [.. content.Labels
            .OrderByDescending(l => rank.GetValueOrDefault(l.Pack, -1))
            .ThenBy(l => l.Pack, StringComparer.Ordinal)
            .Select(l => l.Locale)
            .Distinct(StringComparer.OrdinalIgnoreCase)];
    }
}
