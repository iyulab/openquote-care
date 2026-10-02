// Checks that the error diagnostics connection a release embeds is one the collector takes: it reads
// the connection string the way the app does, sends one check report to it, and fails unless the
// collector accepts it. The release runs it after building, so a missing, malformed or wrong value
// fails there instead of leaving every installation silent with nothing to say so.
//
//   OPENQUOTE_DIAGNOSTICS_CONNECTION=... node scripts/check-diagnostics-connection.mjs <app version>
//
// The report is shaped like the app's own (one exception telemetry item) and carries no content: its
// version is `<app version>-check` and its kind `ReleaseCheck`, so readers can tell it from a failure.
import { pathToFileURL } from 'node:url'

/**
 * The sink a connection string names, read with the app's rule (tauri-kit-diagnostics `Sink::parse`):
 * it needs an `InstrumentationKey` and an `https://` `IngestionEndpoint`. Null when it names none.
 */
export function sink(connection) {
  const field = (name) => {
    for (const part of (connection ?? '').split(';')) {
      const trimmed = part.trim()
      if (trimmed.startsWith(`${name}=`) && trimmed.length > name.length + 1) return trimmed.slice(name.length + 1)
    }
    return undefined
  }
  const key = field('InstrumentationKey')
  const endpoint = field('IngestionEndpoint')
  if (!key || !endpoint?.startsWith('https://')) return null
  return { key, trackUrl: `${endpoint.replace(/\/+$/, '')}/v2.1/track` }
}

/** The check report for `version`, as the app shapes a report. */
export function checkReport(key, version, time = new Date().toISOString()) {
  return {
    name: 'Microsoft.ApplicationInsights.Exception',
    time,
    iKey: key,
    tags: { 'ai.cloud.role': 'release', 'ai.application.ver': `${version}-check`, 'ai.device.osVersion': `${process.platform} ${process.arch}` },
    data: {
      baseType: 'ExceptionData',
      baseData: {
        ver: 2,
        exceptions: [{ typeName: 'ReleaseCheck', message: 'ReleaseCheck', hasFullStack: false, stack: '' }],
        severityLevel: 3,
        properties: {},
      },
    },
  }
}

/** Whether the collector's answer says it took the one report sent. */
export function accepted(status, body) {
  return status === 200 && body?.itemsReceived === 1 && body?.itemsAccepted === 1
}

async function main() {
  const version = process.argv[2]
  if (!version) throw new Error('usage: check-diagnostics-connection.mjs <app version>')
  const target = sink(process.env.OPENQUOTE_DIAGNOSTICS_CONNECTION)
  if (!target) throw new Error('OPENQUOTE_DIAGNOSTICS_CONNECTION names no collector the app would send to')
  const response = await fetch(target.trackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([checkReport(target.key, version)]),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  // The answer names no key or address; the errors it lists say why an item was refused.
  if (!accepted(response.status, body)) throw new Error(`the collector did not take the check report: ${response.status} ${text}`)
  console.log(`the collector took a check report for ${version}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
