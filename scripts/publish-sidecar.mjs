// Publishes the engine sidecar ahead-of-time compiled to sidecar/publish (what the installer bundles).
//
// Native AOT links with the Visual C++ tools, and the .NET linker step finds them through
// vswhere.exe, which the Visual Studio installer keeps in a folder that is not on PATH by default.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const env = { ...process.env }
const installer = join(process.env['ProgramFiles(x86)'] ?? String.raw`C:\Program Files (x86)`, 'Microsoft Visual Studio', 'Installer')
if (existsSync(join(installer, 'vswhere.exe'))) {
  // Environment names are case-insensitive on Windows, but not in this copy: PowerShell passes `Path`.
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  env[key] = `${env[key] ?? ''}${delimiter}${installer}`
}

const result = spawnSync(
  'dotnet',
  ['publish', 'sidecar/OpenquoteCare.Sidecar', '-c', 'Release', '-r', 'win-x64', '-o', 'sidecar/publish'],
  { stdio: 'inherit', env, shell: false },
)
if (result.error) console.error(`dotnet could not be started: ${result.error.message}`)
process.exit(result.status ?? 1)
