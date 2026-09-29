namespace OpenquoteCare.Sidecar;

/// <summary>
/// What an unexpected failure was, without anything it was about: the exception's type and the
/// method in the engine or the sidecar where it was thrown. The message is left out — it can quote
/// record content or a path.
/// </summary>
public sealed record FaultView(string Type, string? At);

/// <summary>The body of a 500 answer.</summary>
public sealed record FaultResponse(FaultView Fault);

internal static class Fault
{
    public static FaultView Of(Exception e) => new(e.GetType().FullName ?? e.GetType().Name, OwnFrame(e.StackTrace));

    /// <summary>
    /// The innermost frame in this product's own code — the engine (<c>Openquote.*</c>) or the sidecar —
    /// as <c>Namespace.Type.Method</c>. Read from the rendered trace, which is also what an ahead-of-time
    /// compiled build has.
    /// </summary>
    internal static string? OwnFrame(string? trace)
    {
        if (trace is null) return null;
        foreach (var line in trace.Split('\n'))
        {
            var frame = line.Trim();
            if (!frame.StartsWith("at ", StringComparison.Ordinal)) continue;
            frame = frame[3..];
            var call = frame.IndexOf('(', StringComparison.Ordinal);
            if (call > 0) frame = frame[..call];
            if (frame.StartsWith("Openquote", StringComparison.Ordinal)) return frame;
        }
        return null;
    }
}
