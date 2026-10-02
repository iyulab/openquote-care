// Checks that an installer's updater signature verifies against the public key the app carries — the
// check the installed app makes before it installs a new version. The release runs it on the final,
// Authenticode-signed installer, so a signature made over other bytes fails here, not on people's
// computers.
//
//   node scripts/verify-update-signature.mjs <installer> <installer.sig> [<tauri conf with the pubkey>]
//
// The key and the signature are minisign's, as Tauri writes them: each base64 of a text whose second
// line is base64 of the binary form. A signature of algorithm `ED` signs the BLAKE2b-512 hash of the
// file; `Ed`, the file itself.
import { createPublicKey, createHash, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** The binary form on the second line of a base64-wrapped minisign text. */
function payload(wrapped) {
  const line = Buffer.from(wrapped.trim(), 'base64').toString('utf8').split('\n')[1]
  if (!line) throw new Error('not a minisign key or signature')
  return { bytes: Buffer.from(line.trim(), 'base64'), lines: Buffer.from(wrapped.trim(), 'base64').toString('utf8').split('\n') }
}

export function verifies(file, signature, pubkey) {
  const key = payload(pubkey).bytes // "Ed" · key id (8) · key (32)
  const { bytes: sig, lines } = payload(signature) // algorithm (2) · key id (8) · signature (64)
  if (key.length !== 42 || sig.length !== 74) throw new Error('unexpected key or signature length')
  if (!key.subarray(2, 10).equals(sig.subarray(2, 10))) return false // signed by another key
  const algorithm = sig.subarray(0, 2).toString('latin1')
  const message = algorithm === 'ED' ? createHash('blake2b512').update(file).digest() : file
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki' })
  if (!verify(null, message, publicKey, sig.subarray(10))) return false
  // The trusted comment is signed too, together with the signature.
  const trusted = lines.find((l) => l.startsWith('trusted comment: '))
  const global = lines[lines.indexOf(trusted) + 1]
  if (!trusted || !global) return false
  return verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted.slice('trusted comment: '.length), 'utf8')]), publicKey, Buffer.from(global.trim(), 'base64'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [installer, sigFile, conf = 'src-tauri/tauri.updater.conf.json'] = process.argv.slice(2)
  if (!installer || !sigFile) {
    console.error('usage: node scripts/verify-update-signature.mjs <installer> <installer.sig> [<conf>]')
    process.exit(2)
  }
  const pubkey = JSON.parse(readFileSync(conf, 'utf8')).plugins.updater.pubkey
  if (verifies(readFileSync(installer), readFileSync(sigFile, 'utf8'), pubkey)) console.log(`${installer}: the updater signature verifies`)
  else {
    console.error(`${installer}: the updater signature does not verify against the key in ${conf}`)
    process.exit(1)
  }
}
