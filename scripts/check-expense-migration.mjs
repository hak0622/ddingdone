import { parseArgs } from 'node:util'
import { compareExpenseMigration } from '../src/utils/expenseMigration.ts'

const { values: args } = parseArgs({ options: {
  project: { type: 'string' },
  meeting: { type: 'string' },
  limit: { type: 'string', default: '20' },
  help: { type: 'boolean' },
} })

if (args.help) {
  console.log('FIRESTORE_ACCESS_TOKEN must be available in the environment. Usage: node scripts/check-expense-migration.mjs --project PROJECT [--meeting ID | --limit 20]')
  process.exit(0)
}

const token = process.env.FIRESTORE_ACCESS_TOKEN
const limit = Number(args.limit)
if (!token || !/^[\w-]+$/.test(args.project ?? '') || !Number.isInteger(limit) || limit < 1 || limit > 50) {
  throw new Error('Set FIRESTORE_ACCESS_TOKEN and supply --project and a --limit between 1 and 50')
}
if (args.meeting && !/^[\w-]+$/.test(args.meeting)) throw new Error('Invalid meeting ID')

const root = `https://firestore.googleapis.com/v1/projects/${args.project}/databases/(default)/documents`
const maxExpensesPerMeeting = 450

async function get(path, params) {
  const url = new URL(`${root}/${path}`)
  for (const [key, value] of params) url.searchParams.append(key, value)
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`FIRESTORE_HTTP_${response.status}`)
  return response.json()
}

function integer(field) {
  return typeof field?.integerValue === 'string' ? Number(field.integerValue) : NaN
}

async function classify(meeting) {
  const fields = meeting.fields ?? {}
  const participantIds = fields.memberUids?.arrayValue?.values?.map((value) => value.stringValue) ?? []
  const expenseCount = integer(fields.expenseCount)
  if (!participantIds.length || participantIds.some((id) => !id) || participantIds.length !== integer(fields.memberCount) ||
      !Number.isSafeInteger(expenseCount) || expenseCount < 0) return 'invalid_data'
  if (expenseCount > maxExpensesPerMeeting) return 'over_limit'

  const id = encodeURIComponent(meeting.name.split('/').at(-1))
  const expenses = []
  let cursor
  do {
    const params = [
      ['pageSize', String(Math.min(100, maxExpensesPerMeeting - expenses.length + 1))],
      ['mask.fieldPaths', 'paidBy'], ['mask.fieldPaths', 'amount'],
      ['mask.fieldPaths', 'splitMemberUids'], ['mask.fieldPaths', 'schemaVersion'],
    ]
    if (cursor) params.push(['pageToken', cursor])
    const page = await get(`meetings/${id}/expenses`, params)
    for (const expense of page.documents ?? []) {
      const splitMemberUids = expense.fields?.splitMemberUids?.arrayValue?.values?.map((value) => value.stringValue)
      expenses.push({ paidBy: expense.fields?.paidBy?.stringValue, amount: integer(expense.fields?.amount),
        splitMemberUids, hasSplit: integer(expense.fields?.schemaVersion) === 3 })
    }
    cursor = page.nextPageToken
    if (expenses.length > maxExpensesPerMeeting) return 'over_limit'
  } while (cursor)

  const latest = await get(`meetings/${id}`, [['mask.fieldPaths', 'status']])
  if (latest.updateTime !== meeting.updateTime) return 'changed_during_scan'
  if (expenses.length !== expenseCount || expenses.reduce((sum, expense) => sum + expense.amount, 0) !== integer(fields.totalAmount)) {
    return 'invalid_data'
  }
  if (expenses.some(({ hasSplit, amount, paidBy, splitMemberUids }) =>
    !Number.isSafeInteger(amount) || amount <= 0 || !participantIds.includes(paidBy) ||
    (hasSplit && (!splitMemberUids?.length || new Set(splitMemberUids).size !== splitMemberUids.length ||
      splitMemberUids.some((uid) => !participantIds.includes(uid)))))) return 'invalid_data'
  const decision = compareExpenseMigration(expenses.filter((expense) => !expense.hasSplit), participantIds)
  return decision.kind === 'convert' ? 'convert' : decision.reason
}

const fields = ['status', 'memberCount', 'memberUids', 'totalAmount', 'expenseCount']
const mask = fields.map((field) => ['mask.fieldPaths', field])
const page = args.meeting
  ? { documents: [await get(`meetings/${encodeURIComponent(args.meeting)}`, mask)] }
  : await get('meetings', [['pageSize', String(limit)], ...mask])
const totals = { convert: 0, different_shares: 0, different_payments: 0, invalid_data: 0, over_limit: 0, changed_during_scan: 0, skipped_inactive: 0 }
for (const meeting of page.documents ?? []) {
  const status = meeting.fields?.status?.stringValue
  const result = status === 'active' ? await classify(meeting) : 'skipped_inactive'
  totals[result] += 1
}

console.log(JSON.stringify({ scanned: page.documents?.length ?? 0, moreMeetings: !!page.nextPageToken, totals }, null, 2))
