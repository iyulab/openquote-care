// Writes a release's notes from its section of CHANGELOG.md, followed by the engine version it ships.
// The release workflow uses it for the draft release, so the notes are reviewed with the change that
// adds them rather than typed into the draft afterwards.
//
//   node scripts/release-notes.mjs <version> <engine version>
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The body of `## [<version>]`, trimmed; undefined when the changelog has no such heading.
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))
  if (start < 0) return undefined
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## ['))
  const body = lines.slice(start + 1, end < 0 ? undefined : end)
  // The comparison links at the foot of the file belong to no section.
  const footer = (line) => line.trim() === '' || /^\[[^\]]+\]: /.test(line)
  while (body.length && footer(body.at(-1))) body.pop()
  return body.join('\n').trim()
}

export function releaseNotes(changelog, version, engine) {
  const section = changelogSection(changelog, version)
  if (!section) throw new Error(`CHANGELOG.md has no notes for ${version}`)
  return `${section}\n\nEngine ${engine}.\n`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [version, engine] = process.argv.slice(2)
  if (!version || !engine) {
    console.error('usage: node scripts/release-notes.mjs <version> <engine version>')
    process.exit(1)
  }
  try {
    process.stdout.write(releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version, engine))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
