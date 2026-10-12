// What names an installation of the app on this computer, for the installer checks to set aside and put back: the
// app data folders of the identifier and of the one the app had before (`src-tauri/src/earlier.rs`), and the keys
// the installer keeps its folder under, one per publisher — the identifier's second part.

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { withAppDataSetAside } from '@iyulab/tauri-kit-dev/installer'

/** The identifier the app was published under before; a build takes over its data folder when it first starts. */
export const EARLIER_IDENTIFIER = 'com.iyulab.openquote-care'

/** The installer's key holding the folder it installed into, for a publisher and a product. */
const installKey = (publisher, product) => `HKCU:\\Software\\${publisher}\\${product}`

function powershell(script) {
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  if (out.status !== 0) throw new Error(`powershell failed: ${out.stderr}`)
  return out.stdout.trim()
}

/** The folder an install-location key names, or null when there is no such key. */
export function installedFolder(publisher, product) {
  const key = installKey(publisher, product)
  const folder = powershell(`if (Test-Path '${key}') { (Get-ItemProperty '${key}').'(default)' } else { '<none>' }`)
  return folder === '<none>' ? null : folder
}

function setInstalledFolder(publisher, product, folder) {
  const key = installKey(publisher, product)
  powershell(
    folder === null
      ? `if (Test-Path '${key}') { Remove-Item '${key}' -Recurse -Force }`
      : `New-Item -Path '${key}' -Force | Out-Null; Set-ItemProperty -Path '${key}' -Name '(default)' -Value '${folder.replaceAll("'", "''")}'`,
  )
}

/**
 * Runs `check` with this computer's installation set aside — the app data folders of `identifier` and of the earlier
 * identifier, and the install-location keys of both publishers — and puts them back after, whatever the check left.
 */
export async function withInstallationSetAside({ identifier, productName }, check) {
  const publishers = [...new Set([EARLIER_IDENTIFIER, identifier].map((id) => id.split('.')[1]))]
  const kept = publishers.map((p) => [p, installedFolder(p, productName)])
  for (const [p] of kept) setInstalledFolder(p, productName, null)
  try {
    return await withAppDataSetAside(join(process.env.LOCALAPPDATA, EARLIER_IDENTIFIER), () =>
      identifier === EARLIER_IDENTIFIER ? check() : withAppDataSetAside(join(process.env.LOCALAPPDATA, identifier), check),
    )
  } finally {
    for (const [p, folder] of kept) setInstalledFolder(p, productName, folder)
  }
}
