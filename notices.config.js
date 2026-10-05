// The third-party notices the installer ships (`licenses/THIRD-PARTY-NOTICES.txt` next to the app):
// the window's npm packages, the shell's crates, and the engine sidecar's NuGet packages with the
// .NET runtime compiled into it. Regenerate with `npm run notices`; `npm run verify` and the release
// build fail when the committed file is not what the dependencies now say.
export default {
  out: 'LICENSES/THIRD-PARTY-NOTICES.txt',
  title: 'Openquote Care — third-party notices',
  npm: { lock: 'package-lock.json', installedAt: '.' },
  cargo: { cwd: 'src-tauri', target: 'x86_64-pc-windows-msvc' },
  nuget: {
    project: 'sidecar/OpenquoteCare.Sidecar/OpenquoteCare.Sidecar.csproj',
    // Restored as it is published (scripts/publish-sidecar.mjs): the runtime packs come only with the RID.
    properties: { RuntimeIdentifier: 'win-x64' },
  },
  pinned: { pins: 'notices/pins.json', dir: 'notices/texts' },
}
