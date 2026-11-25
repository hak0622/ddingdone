import { describe, expect, it } from 'vitest'
import { changeExpense, departRoom, joinRoom, type RoomStore } from './rooms'

function fixture(uids = ['u1', 'u2'], participantModelVersion = 2) {
  const path = 'meetings/room-id'
  const docs = new Map<string, Record<string, unknown>>([[path, {
    status: 'active', memberUids: uids, memberCount: uids.length,
    expenseCount: 0, totalAmount: 0, participantModelVersion,
  }]])
  uids.forEach((uid, index) => {
    const participantId = `p${index + 1}`
    docs.set(`${path}/participants/${participantId}`, { name: uid, status: 'active', departureVersion: 0 })
    docs.set(`${path}/participantLinks/${uid}`, { participantId, nickname: uid })
  })
  function list(collection: string) {
    return [...docs.entries()].filter(([key]) => key.startsWith(`${path}/${collection}/`))
      .map(([key, data]) => ({ id: key.split('/').at(-1)!, data }))
  }
  const store: RoomStore = {
    read: async (key) => docs.has(key) ? { id: key.split('/').at(-1)!, data: docs.get(key)! } : null,
    readMany: async (paths) => Promise.all(paths.map((key) => store.read(key))),
    write: (key, data, _exists, fields = Object.keys(data)) => {
      const updated = { ...docs.get(key) }
      for (const field of fields) {
        if (Object.hasOwn(data, field)) updated[field] = data[field]
        else delete updated[field]
      }
      docs.set(key, updated)
    },
    remove: (key) => { docs.delete(key) },
    list: async (collection) => list(collection),
    page: async (collection) => ({ records: list(collection), hasMore: false }),
    collections: async () => [...new Set([...docs.keys()].filter((key) => key.startsWith(`${path}/`)).map((key) => key.split('/')[2]!))],
  }
  const room = async () => (await store.read(path))!
  return { store, path, room, docs }
}

const expense = { expenseId: 'expense', action: 'create', participantIds: ['p1', 'p2'],
  amount: 1001, category: '식비', memo: '', requestId: 'expense' }

describe('participant rooms', () => {
  it('preserves exact shares and locks old costs when someone rejoins with a new ID', async () => {
    const { store, path, room, docs } = fixture()
    await changeExpense(store, path, await room(), 'p1', expense)
    const expensePath = `${path}/expenses/expense`
    expect(docs.get(expensePath)?.shares).toEqual([{ participantId: 'p1', amount: 501 }, { participantId: 'p2', amount: 500 }])
    await departRoom(store, path, await room(), 'u2', 'leave', 'p2')
    await departRoom(store, path, await room(), 'u2', 'leave', 'p2')
    expect(docs.has(`${path}/participants/p2`)).toBe(false)
    const { participantId } = await joinRoom(store, path, await room(), 'u2', { nickname: 'different' })
    expect(participantId).not.toBe('p2')
    await expect(departRoom(store, path, await room(), 'u2', 'leave', 'p2')).rejects.toThrow('ROOM_CHANGED')
    await expect(changeExpense(store, path, await room(), 'p1', { ...expense, action: 'delete', revision: 'expense' })).rejects.toThrow('EXPENSE_LOCKED')
    expect(docs.get(expensePath)?.amount).toBe(1001)
    await changeExpense(store, path, await room(), 'p1', {
      ...expense, expenseId: 'new', requestId: 'new', participantIds: ['p1', participantId],
    })
    expect((await room()).data.totalAmount).toBe(2002)
  })

  it('rejects non-string actions and categories before writing anything', async () => {
    const { store, path, room, docs } = fixture()
    for (const malformed of [{ action: ['create'] }, { category: ['식비'] }]) {
      await expect(changeExpense(store, path, await room(), 'p1', { ...expense, ...malformed }))
        .rejects.toThrow('INVALID_EXPENSE')
    }
    expect(docs.has(`${path}/expenses/${expense.expenseId}`)).toBe(false)
    expect((await room()).data).toMatchObject({ expenseCount: 0, totalAmount: 0 })
  })

  it('removes account links and blocks rejoining a settled room', async () => {
    const { store, path, room, docs } = fixture()
    const settled = await room()
    store.write(path, { ...settled.data, status: 'settled' })
    await departRoom(store, path, await room(), 'u2', 'leave', 'p2')
    await expect(joinRoom(store, path, await room(), 'u2', { departureVersion: 1 })).rejects.toThrow('ROOM_SETTLED')
    await departRoom(store, path, await room(), 'u2', 'withdraw')
    expect(docs.has(`${path}/participantLinks/u2`)).toBe(false)
    expect(docs.has(`${path}/participants/p2`)).toBe(false)
  })

  it('removes the last member, cover document and old participant links', async () => {
    const { store, path, room, docs } = fixture()
    docs.set(`${path}/photos/cover`, { bytes: 'photo' })
    await departRoom(store, path, await room(), 'u2', 'leave', 'p2')
    await departRoom(store, path, await room(), 'u1', 'leave', 'p1')
    expect(docs.size).toBe(0)
  })
})

describe('v2 expense creation', () => {
  const original = { ...expense, requestId: expense.expenseId }

  it('returns the existing expense only for the same creator and original input', async () => {
    const { store, path, room, docs } = fixture(['u1', 'u2'], 2)
    const submit = async (changes = {}, actor = 'p1') => changeExpense(store, path, await room(), actor, { ...original, ...changes })
    const expensePath = `${path}/expenses/${original.expenseId}`
    expect(await submit()).toEqual({ expenseId: original.expenseId })
    const persisted = docs.get(expensePath)
    expect(persisted?.creationHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(await submit()).toEqual({ expenseId: original.expenseId })
    for (const changes of [{ amount: 2000 }, { participantIds: ['p2'] }, { participantIds: ['p2', 'p1'] },
      { expenseId: 'other' }, { category: '카페' }, { memo: 'different' }]) {
      await expect(submit(changes)).rejects.toMatchObject({ code: 'EXPENSE_REQUEST_CONFLICT', status: 409 })
    }
    await expect(submit({}, 'p2')).rejects.toMatchObject({ code: 'EXPENSE_REQUEST_CONFLICT', status: 409 })
    expect(docs.get(expensePath)).toBe(persisted)
    expect(docs.has(`${path}/expenses/other`)).toBe(false)
    expect((await room()).data.totalAmount).toBe(original.amount)
  })

  it('preserves the original fingerprint through editing and deletion without restoring the expense', async () => {
    const { store, path, room, docs } = fixture(['u1', 'u2'], 2)
    const submit = async (changes = {}) => changeExpense(store, path, await room(), 'p1', { ...original, ...changes })
    const expensePath = `${path}/expenses/${original.expenseId}`
    await submit()
    const creationHash = docs.get(expensePath)?.creationHash
    await submit({ action: 'edit', amount: 2000, requestId: 'edit', revision: original.requestId })
    await submit()
    expect(docs.get(expensePath)).toMatchObject({ amount: 2000, creationHash, revision: 'edit' })
    expect((await room()).data.totalAmount).toBe(2000)
    await expect(submit({ amount: 2000 })).rejects.toMatchObject({ code: 'EXPENSE_REQUEST_CONFLICT', status: 409 })

    await submit({ action: 'delete', revision: 'edit' })
    expect(await submit()).toEqual({ expenseId: original.expenseId })
    await expect(submit({ amount: 2000 })).rejects.toMatchObject({ code: 'EXPENSE_REQUEST_CONFLICT', status: 409 })
    expect(docs.get(expensePath)).toEqual({ deleted: true, creationKey: original.requestId, creationHash })
    expect((await room()).data.totalAmount).toBe(0)
  })

  it('rejects ambiguous replays for expenses created before fingerprints, while allowing edits and deletes', async () => {
    const { store, path, room, docs } = fixture(['u1', 'u2'], 2)
    const submit = async (changes = {}) => changeExpense(store, path, await room(), 'p1', { ...original, ...changes })
    const expensePath = `${path}/expenses/${original.expenseId}`
    await submit()
    delete docs.get(expensePath)?.creationHash
    await expect(submit()).rejects.toMatchObject({ code: 'EXPENSE_REQUEST_CONFLICT', status: 409 })
    await submit({ action: 'edit', amount: 2000, requestId: 'edit', revision: original.requestId })
    expect(docs.get(expensePath)).not.toHaveProperty('creationHash')
    await submit({ action: 'delete', revision: 'edit' })
    await expect(submit()).rejects.toMatchObject({ code: 'EXPENSE_REQUEST_CONFLICT', status: 409 })
    expect(docs.get(expensePath)).toEqual({ deleted: true, creationKey: original.requestId })
    expect((await room()).data.totalAmount).toBe(0)
  })
})
