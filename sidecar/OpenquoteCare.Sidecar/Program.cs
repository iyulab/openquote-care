// The engine host for the desktop shell. The shell starts it with two environment variables:
//
//   OPENQUOTE_SIDECAR_TOKEN   a fresh random secret; every request must carry it as a bearer token
//   OPENQUOTE_DEVICE          this computer's device id, stamped on every file the sidecar produces
//
// It listens on 127.0.0.1 only, on a port the system picks, and announces that port as its first
// line of standard output: "openquote-sidecar ready port=<n>".

using System.Security.Cryptography;
using System.Text;
using OpenquoteCare.Sidecar;

var token = Environment.GetEnvironmentVariable("OPENQUOTE_SIDECAR_TOKEN");
var device = Environment.GetEnvironmentVariable("OPENQUOTE_DEVICE");
if (string.IsNullOrEmpty(token) || token.Length < 32 || string.IsNullOrEmpty(device))
{
    Console.Error.WriteLine("OPENQUOTE_SIDECAR_TOKEN (32+ characters) and OPENQUOTE_DEVICE are required");
    return 2;
}

var app = SidecarHost.Build(args, token, device, TimeProvider.System, port: 0);
await app.StartAsync();
var port = new Uri(app.Urls.First()).Port;
Console.WriteLine($"openquote-sidecar ready port={port}");
await app.WaitForShutdownAsync();
return 0;

namespace OpenquoteCare.Sidecar
{
    /// <summary>Builds the sidecar app; separate from startup so tests can host it in memory.</summary>
    public static class SidecarHost
    {
        public static WebApplication Build(string[] args, string token, string device, TimeProvider clock, int? port)
        {
            var builder = WebApplication.CreateSlimBuilder(args);
            builder.Logging.ClearProviders();
            if (port is { } p) builder.WebHost.ConfigureKestrel(k => k.Listen(System.Net.IPAddress.Loopback, p));
            builder.Services.AddSingleton<VaultSession>();

            var app = builder.Build();
            var expected = Encoding.UTF8.GetBytes("Bearer " + token);
            app.Use(async (context, next) =>
            {
                var given = Encoding.UTF8.GetBytes(context.Request.Headers.Authorization.ToString());
                if (!CryptographicOperations.FixedTimeEquals(given, expected))
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return;
                }
                try
                {
                    await next(context);
                }
                catch (InvalidOperationException e) when (e.Message == "no vault is loaded")
                {
                    context.Response.StatusCode = StatusCodes.Status409Conflict;
                }
            });
            Api.Map(app, device, clock);
            return app;
        }
    }
}
