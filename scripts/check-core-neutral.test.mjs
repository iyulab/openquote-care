// node --test scripts/check-core-neutral.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { audit, coreFiles } from './check-core-neutral.mjs'

const rules = (text, path = 'src/a.ts', allow = []) => audit([{ path, text }], allow).map((f) => f.rule)

test('flags Korean text in core code', () => {
  assert.deepEqual(rules("const label = '주제'"), ['Korean text'])
})

test('flags a field or region term, in code or comments', () => {
  assert.deepEqual(rules('// copies the grade from the subject'), ['field or region term'])
  assert.deepEqual(rules("const fallback = 'ko'"), ['field or region term'])
  assert.deepEqual(rules('const kind = f.kind'), [])
})

test('flags a fixed collation locale, and not a comparison of values', () => {
  assert.deepEqual(rules("names.sort((a, b) => a.localeCompare(b, 'ko-KR'))"), ['field or region term', 'fixed collation locale'])
  assert.deepEqual(rules("rows.sort((a, b) => a.localeCompare(b, 'sv'))"), ['fixed collation locale'])
  assert.deepEqual(rules("dates.sort((a, b) => text(b, 'date').localeCompare(text(a, 'date')))"), [])
  assert.deepEqual(rules("new Intl.Collator('de')"), ['fixed locale'])
})

test('skips Rust test modules and locale tables', () => {
  assert.deepEqual(rules('fn main() {}\n#[cfg(test)]\nmod tests { const X: &str = "학교"; }', 'src-tauri/src/a.rs'), [])
  const root = mkdtempSync(join(tmpdir(), 'core-neutral-'))
  for (const dir of ['src/locales', 'src/__tests__', 'src/vault']) mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'src/locales/ko.ts'), "export const ko = { a: '가' }")
  writeFileSync(join(root, 'src/__tests__/a.test.ts'), "expect('가')")
  writeFileSync(join(root, 'src/vault/screen.ts'), 'export {}')
  assert.deepEqual(coreFiles(root), ['src/vault/screen.ts'])
})

test('an allowed line needs a reason', () => {
  const line = "const tag = 'ko'"
  assert.deepEqual(rules(line, 'src/a.ts', [{ file: 'src/a.ts', pattern: "'ko'", reason: 'the example in a doc test' }]), [])
  assert.deepEqual(rules(line, 'src/a.ts', [{ file: 'src/a.ts', pattern: "'ko'" }]), ['exception without a reason', 'field or region term'])
})
