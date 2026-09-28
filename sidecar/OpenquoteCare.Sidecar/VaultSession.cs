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
    private Snapshot? _snapshot;

    internal sealed record Snapshot(VaultContent Content, IReadOnlyDictionary<EntityRef, Entity> Entities);

    /// <summary>Replaces the whole vault.</summary>
    public Snapshot Load(IEnumerable<VaultFile> files)
    {
        lock (_gate)
        {
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
        return _snapshot = new Snapshot(content, EntityMerger.Merge(content.Changes));
    }
}
