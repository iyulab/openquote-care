// Checks that each golden vault is what its generator writes. The tests compare the engine with the
// expected files; this compares the expected files with the generator, so a file edited by hand
// (and lost on the next regeneration) is caught when it is made, not when someone regenerates.
//
//   node scripts/check-golden.mjs
//
// Each generator is run in place. A folder it leaves different is reported and keeps what the
// generator wrote, ready to be looked at with git diff.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const vaults = [join('tests', 'golden'), join('tests', 'golden-neutral')]

// Every file under the folder (but the generator itself), by path relative to it, with a hash of its bytes.
function snapshot(dir) {
  const files = new Map()
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name !== 'generate.cs') files.set(relative(dir, path), createHash('sha256').update(readFileSync(path)).digest('hex'))
    }
  }
  walk(dir)
  return files
}

let differs = false
for (const dir of vaults) {
  if (!existsSync(join(dir, 'generate.cs'))) continue
  const before = snapshot(dir)
  const run = spawnSync('dotnet', ['run', 'generate.cs'], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
  if (run.status !== 0) {
    process.stdout.write(run.stdout ?? '')
    console.error(`${dir}: the generator failed`)
    process.exit(1)
  }
  const after = snapshot(dir)
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((f) => before.get(f) !== after.get(f)).sort()
  if (changed.length) {
    differs = true
    console.error(`${dir}: the generator writes something else than the folder held:`)
    for (const f of changed) console.error(`  ${!after.has(f) ? 'removed' : !before.has(f) ? 'added' : 'changed'} ${f}`)
  } else console.log(`${dir}: as its generator writes it`)
}
process.exit(differs ? 1 : 0)
