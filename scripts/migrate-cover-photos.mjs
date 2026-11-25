import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({ options: {
  project: { type: 'string' },
  cloud: { type: 'string' },
  copy: { type: 'boolean' },
  limit: { type: 'string', default: '5' },
  meeting: { type: 'string' },
  budget: { type: 'string' },
  after: { type: 'string' },
  help: { type: 'boolean' },
} })
if (args.help) {
  console.log('node scripts/migrate-cover-photos.mjs --project PROJECT --cloud CLOUD [--copy --budget FILE [--meeting MEETING_ID | --limit 5 --after MEETING_ID]]')
  process.exit(0)
}

const copy = args.copy === true
if (args.meeting !== undefined && (!copy || args.after !== undefined || !/^[\w-]+$/u.test(args.meeting))) {
  throw new Error('--meeting requires --copy, a valid meeting ID, and no --after')
}
const limit = Number(args.limit)
const token = process.env.FIRESTORE_ACCESS_TOKEN
if (!token || !args.project || !/^[\w-]+$/.test(args.project) ||
  !args.cloud || !/^[\w-]+$/.test(args.cloud) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
  throw new Error('Set FIRESTORE_ACCESS_TOKEN and supply --project, --cloud, and a --limit between 1 and 50')
}

const MAX_BYTES = 200 * 1024
const MAX_SOURCE_BYTES = 16 * 1024 ** 2
const root = `projects/${args.project}/databases/(default)/documents`
const api = args.project === 'demo-ddingdone' ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com'
const base = `${api}/v1/${root}`
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const string = (stringValue) => ({ stringValue })
const field = (doc, key) => doc?.fields?.[key]?.stringValue

async function firestore(path, body) {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET', headers: auth,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  if (res.status === 404 && !body) return null
  if (!res.ok) throw new Error(`FIRESTORE_HTTP_${res.status}`)
  return res.json()
}

function legacySource(meeting, id) {
  const publicId = field(meeting, 'photoPublicId')
  const value = field(meeting, 'photoUrl')
  if (!publicId || !publicId.startsWith(`ddingdone/${id}/`) || !value) return null
  const url = new URL(value)
  const prefix = `/${args.cloud}/image/upload/`
  if (url.origin !== 'https://res.cloudinary.com' || !url.pathname.startsWith(prefix)) return null
  const suffix = decodeURIComponent(url.pathname.slice(prefix.length))
  if (suffix.replace(/^v\d+\//, '').replace(/\.[a-zA-Z0-9]+$/, '') !== publicId) return null
  return { url, publicId, value }
}

async function listCandidates(readLimit) {
  const candidates = []
  const invalidIds = []
  let scanned = 0
  let pageToken
  do {
    const search = new URLSearchParams({ pageSize: String(Math.min(200, readLimit - scanned)) })
    search.append('mask.fieldPaths', 'photoUrl')
    search.append('mask.fieldPaths', 'photoPublicId')
    if (pageToken) search.set('pageToken', pageToken)
    const page = await firestore('/meetings?' + search)
    for (const meeting of page?.documents ?? []) {
      scanned += 1
      if (!field(meeting, 'photoUrl') && !field(meeting, 'photoPublicId')) continue
      const id = meeting.name.split('/').at(-1)
      let source
      try { source = legacySource(meeting, id) } catch { /* report this reference */ }
      if (source) candidates.push(id)
      else invalidIds.push(id)
    }
    pageToken = page?.nextPageToken
    if (pageToken && scanned >= readLimit) throw new Error('READ_HEADROOM_EXCEEDED')
  } while (pageToken)
  return { candidates, invalidIds, scanned }
}

async function download(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (!response.ok || !response.body) throw new Error('LEGACY_DOWNLOAD_FAILED')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > MAX_SOURCE_BYTES) throw new Error('LEGACY_FILE_TOO_LARGE')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function convert(dir, maxSide, quality) {
  execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality),
    '-Z', String(maxSide), join(dir, 'input'), '--out', join(dir, 'output.jpg')], {
    stdio: 'ignore', timeout: 15000,
  })
}

async function jpeg(dir, source) {
  await writeFile(join(dir, 'input'), source)
  for (const [side, quality] of [[1200, 82], [1200, 70], [960, 70], [720, 65], [480, 60]]) {
    convert(dir, side, quality)
    const bytes = await readFile(join(dir, 'output.jpg'))
    if (bytes.length > 0 && bytes.length <= MAX_BYTES) return bytes
  }
  throw new Error('PHOTO_COMPRESSION_FAILED')
}

function checksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function matchesSource(room, source) {
  return field(room, 'photoUrl') === source.value && field(room, 'photoPublicId') === source.publicId &&
    !room.fields?.withdrawalLockRequestId?.stringValue && room.fields?.roomCleanupPending?.booleanValue !== true
}

function coverBytes(cover, version) {
  const encoded = cover?.fields?.bytes?.bytesValue
  if (field(cover, 'version') !== version || !encoded) throw new Error('PHOTO_VERIFICATION_FAILED')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('PHOTO_VERIFICATION_FAILED')
  return bytes
}

async function copyPhoto(id) {
  const path = `/meetings/${encodeURIComponent(id)}`
  const original = await firestore(path)
  const source = legacySource(original, id)
  if (!source || !matchesSource(original, source)) throw new Error('PHOTO_SOURCE_CHANGED')
  const coverPath = path + '/photos/cover'
  const dir = await mkdtemp(join(tmpdir(), 'ddingdone-photo-'))
  try {
    const expected = await jpeg(dir, await download(source.url))
    let version = field(original, 'photoVersion')
    if (!version) {
      version = randomUUID()
      await firestore(':commit', { writes: [
        { update: { name: root + coverPath, fields: {
          version: string(version), bytes: { bytesValue: expected.toString('base64') },
        } }, currentDocument: { exists: false } },
        { update: { name: original.name, fields: { photoVersion: string(version) } },
          updateMask: { fieldPaths: ['photoVersion'] }, currentDocument: { updateTime: original.updateTime } },
      ] })
    }
    const [current, cover] = await Promise.all([firestore(path), firestore(coverPath)])
    if (!current || !matchesSource(current, source) || field(current, 'photoVersion') !== version) {
      throw new Error('PHOTO_SOURCE_CHANGED')
    }
    const bytes = coverBytes(cover, version)
    if (!bytes.equals(expected)) throw new Error('PHOTO_COPY_DIFFERS_FROM_SOURCE')
    await writeFile(join(dir, 'input'), bytes)
    convert(dir, 1200, 82)
    return { project: args.project, cloud: args.cloud, id, version, publicId: source.publicId, url: source.value, sha256: checksum(bytes) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const free = {
  storageBytes: 1024 ** 3,
  outboundBytes: 10 * 1024 ** 3,
  reads: 50_000,
  writes: 20_000,
  deletes: 20_000,
}
const planned = args.budget ? JSON.parse(await readFile(args.budget, 'utf8')) : null
if (copy && !planned) throw new Error('A current usage budget is required for writes')
if (planned && Object.keys(free).some((key) =>
  !Number.isFinite(planned[key]) || planned[key] < 0 || planned[key] >= free[key] * 0.8)) {
  throw new Error('INVALID_OR_EXHAUSTED_USAGE_BUDGET')
}
const readLimit = planned ? Math.floor(free.reads * 0.8 - planned.reads - limit * 5 - 1) : 1000
if (readLimit < 1) throw new Error('READ_HEADROOM_EXCEEDED')
const inventory = await listCandidates(readLimit)
console.log(JSON.stringify({
  scanned: inventory.scanned, eligible: inventory.candidates.length, invalidIds: inventory.invalidIds,
  maxAdditionalImageBytes: inventory.candidates.length * MAX_BYTES,
}))
if (copy) {
  if (inventory.invalidIds.length) throw new Error('INVALID_PHOTO_REFERENCES')
  const batch = args.meeting
    ? inventory.candidates.filter((id) => id === args.meeting)
    : inventory.candidates.filter((id) => !args.after || id > args.after).slice(0, limit)
  if (args.meeting && !batch.length) throw new Error('MEETING_HAS_NO_COPY_CANDIDATE')
  checkBudget(batch.length, inventory.scanned)
  for (const id of batch) {
    try {
      console.log(JSON.stringify({ id, result: 'copied', receipt: await copyPhoto(id) }))
    } catch (error) {
      console.error(JSON.stringify({ id, result: 'retry', error: error.message }))
      process.exitCode = 1
      break
    }
  }
}

function checkBudget(count, reads) {
  const incremental = {
    storageBytes: count * (MAX_BYTES + 4096),
    outboundBytes: count * Math.ceil(MAX_BYTES * 4 / 3 + 4096),
    writes: count * 4, deletes: count, reads: reads + count * 5 + 1,
  }
  if (Object.keys(free).some((key) => planned[key] + incremental[key] >= free[key] * 0.8)) {
    throw new Error('INSUFFICIENT_FREE_QUOTA_HEADROOM')
  }
}
