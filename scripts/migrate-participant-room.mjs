import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const { values: args } = parseArgs({ options: {
  project: { type: 'string' },
  meeting: { type: 'string' },
  apply: { type: 'boolean' },
  'expected-source': { type: 'string' },
  'confirm-compatible-release': { type: 'boolean' },
  'accept-app-cutover': { type: 'boolean' },
  backup: { type: 'string' },
  'recalculate-test-room': { type: 'boolean' },
} })
const token = process.env.FIRESTORE_ACCESS_TOKEN
if (!token || !/^[\w-]+$/u.test(args.project ?? '') || !/^[\w-]+$/u.test(args.meeting ?? '')) {
  throw new Error('Usage: FIRESTORE_ACCESS_TOKEN must be set. node scripts/migrate-participant-room.mjs --project PROJECT --meeting ID')
}
if (args.apply && !args['confirm-compatible-release'] && !args['accept-app-cutover']) {
  throw new Error('Supply --confirm-compatible-release or --accept-app-cutover to apply')
}
if (args.apply && !/^[a-f0-9]{64}$/u.test(args['expected-source'] ?? '')) throw new Error('Run the dry-run first and pass its sourceHash as --expected-source')
if (args.apply && args['accept-app-cutover'] && !args.backup) throw new Error('Supply --backup for an app cutover')
if (args['recalculate-test-room'] && args.apply && !args.backup) throw new Error('Supply --backup to recalculate the confirmed test room')
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../cloudflare/account-deletion/src/roomMigration.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
})
const { migrateParticipantRoom } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
try {
  const saveBackup = args.backup
    ? (snapshot) => writeFile(args.backup, JSON.stringify(snapshot), { mode: 0o600 })
    : undefined
  console.log(JSON.stringify(await migrateParticipantRoom(
    args.project, token, args.meeting, Boolean(args.apply), args['expected-source'], saveBackup, args['recalculate-test-room'],
  )))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
