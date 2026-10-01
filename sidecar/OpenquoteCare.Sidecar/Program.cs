// The engine host for the desktop shell. The shell starts it with two environment variables:
//
//   OPENQUOTE_SIDECAR_TOKEN   a fresh random secret; every request must carry it as a bearer token
//   OPENQUOTE_DEVICE          this computer's device id, stamped on every file the sidecar produces
//
// It listens on 127.0.0.1 only, on a port the system picks, and announces that port as its first
// line of standard output: "openquote-sidecar ready port=<n>".

using OpenquoteCare.Sidecar;
using TauriKit.Sidecar.Loopback;

var token = LoopbackHost.ReadToken("OPENQUOTE_SIDECAR_TOKEN");
var device = Environment.GetEnvironmentVariable("OPENQUOTE_DEVICE");
if (token is null || string.IsNullOrEmpty(device))
{
    Console.Error.WriteLine("OPENQUOTE_SIDECAR_TOKEN (32+ characters) and OPENQUOTE_DEVICE are required");
    return 2;
}

var app = SidecarHost.Build(args, token, device, TimeProvider.System, port: 0);
await app.RunAnnouncingAsync("openquote-sidecar ready port=");
return 0;

namespace OpenquoteCare.Sidecar
{
    /// <summary>Builds the sidecar app; separate from startup so tests can host it in memory.</summary>
    public static class SidecarHost
    {
        public static WebApplication Build(string[] args, string token, string device, TimeProvider clock, int? port)
        {
            var builder = LoopbackHost.CreateSlimBuilder(args, port);
            builder.Services.AddSingleton<VaultSession>();
            builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, SidecarJson.Default));

            var app = builder.Build();
            app.UseBearerToken(token);
            app.UseFaults(new FaultOptions
            {
                // A failure is placed at the innermost frame in the engine or this sidecar; its message,
                // which can quote record content or a path, is never sent.
                OwnNamespaces = ["Openquote.", "OpenquoteCare."],
                StatusFor = e => e is InvalidOperationException { Message: "no vault is loaded" } ? StatusCodes.Status409Conflict : null,
            });
            Api.Map(app, device, clock);
            return app;
        }
    }
}
