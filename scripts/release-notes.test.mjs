import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { changelogSection, releaseNotes } from './release-notes.mjs'

const changelog = `# Changelog

## [Unreleased]

## [0.12.0] - 2026-10-07

### Added
- Closings counted by how they ended.

## [0.11.1] - 2026-10-06

### Fixed
- What you type stays.

[Unreleased]: https://example.test/compare/v0.12.0...HEAD
[0.12.0]: https://example.test/compare/v0.11.1...v0.12.0
`

test('the notes are the version section and the engine it ships', () => {
  assert.equal(releaseNotes(changelog, '0.12.0', '0.17.0'), '### Added\n- Closings counted by how they ended.\n\nEngine 0.17.0.\n')
})

test('the last section stops before the comparison links', () => {
  assert.equal(changelogSection(changelog, '0.11.1'), '### Fixed\n- What you type stays.')
})

test('a version with no section, or an empty one, has no notes', () => {
  assert.throws(() => releaseNotes(changelog, '0.13.0', '0.17.0'), /no notes for 0.13.0/)
  assert.throws(() => releaseNotes(changelog, 'Unreleased', '0.17.0'), /no notes/)
})

test('the app version has notes in the changelog', () => {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  assert.ok(changelogSection(readFileSync('CHANGELOG.md', 'utf8'), version), `CHANGELOG.md has a section for ${version}`)
})
