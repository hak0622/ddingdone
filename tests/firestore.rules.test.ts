import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Bytes,
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildParticipantSnapshot, buildSettlementSnapshot, buildV2SettlementSnapshot, hashSettlementSnapshot } from "../src/utils/settlementSnapshot";

import { migrateParticipantRoom } from "../cloudflare/account-deletion/src/roomMigration";
import { createRoom, roomOperation } from "../cloudflare/account-deletion/src/rooms";

const PROJECT_ID = "ddingdone-test";
const USER_1 = "user-1";
const USER_2 = "user-2";

let testEnv: RulesTestEnvironment;

function emulatorAddress(): { host: string; port: number } {
  const value = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const separator = value.lastIndexOf(":");
  return {
    host: value.slice(0, separator),
    port: Number(value.slice(separator + 1)),
  };
}

async function seedDocuments(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "meetings/shared-room"), {
        createdBy: USER_1,
        memberUids: [USER_1, USER_2],
        memberCount: 2,
        expenseCount: 1,
        totalAmount: 1000,
        status: "active",
        memo: "공유방",
      }),
      setDoc(doc(db, `meetings/shared-room/members/${USER_1}`), {
        nickname: "사용자 1",
      }),
      setDoc(doc(db, `meetings/shared-room/members/${USER_2}`), {
        nickname: "사용자 2",
      }),
      setDoc(doc(db, "meetings/shared-room/expenses/expense-1"), {
        amount: 1000,
        category: "식비",
        memo: "",
        paidBy: USER_1,
        createdBy: USER_1,
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
        updatedBy: USER_1,
        updatedAt: new Date("2026-08-20T00:00:00.000Z"),
        schemaVersion: 2,
      }),
      setDoc(doc(db, "meetings/other-room"), {
        createdBy: USER_2,
        memberUids: [USER_2],
        memberCount: 1,
        expenseCount: 1,
        totalAmount: 2000,
        status: "active",
        memo: "다른 방",
      }),
      setDoc(doc(db, `meetings/other-room/members/${USER_2}`), {
        nickname: "사용자 2",
      }),
      setDoc(doc(db, "meetings/other-room/expenses/expense-2"), {
        amount: 2000,
        category: "교통",
        memo: "",
        paidBy: USER_2,
        createdBy: USER_2,
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
        updatedBy: USER_2,
        updatedAt: new Date("2026-08-20T00:00:00.000Z"),
        schemaVersion: 2,
      }),
    ]);
  });
}

async function setAccountLock(uid: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `withdrawalLocks/${uid}`), {
      requestId: "request-1",
      status: "locked",
    });
  });
}

async function setMeetingLock(meetingId: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), `meetings/${meetingId}`), {
      withdrawalLockRequestId: "request-1",
    });
  });
}

describe("Firestore 탈퇴 잠금 규칙", () => {
  beforeAll(async () => {
    const { host, port } = emulatorAddress();
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: await readFile("firestore.rules", "utf8"),
        host,
        port,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedDocuments();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

describe("모임별 참여자 ID 권한", () => {
  async function seedParticipantRoom(version = 2) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await updateDoc(doc(db, "meetings/shared-room"), {
        participantModelVersion: version, expenseSplitsEnabled: true, createdBy: null,
      });
      await setDoc(doc(db, "meetings/shared-room/participants/payer"), {
        status: "active", name: "작성자", departureVersion: 0,
      });
      await setDoc(doc(db, `meetings/shared-room/participantLinks/${USER_1}`), {
        accountUid: USER_1, participantId: "payer", nickname: "작성자",
      });
      await updateDoc(doc(db, "meetings/shared-room/expenses/expense-1"), {
        schemaVersion: 4, createdBy: "payer", paidBy: "payer", revision: "before",
      });
    });
  }

  it("탈퇴 잠금은 작성자와 사진 쓰기에 적용하고 다른 멤버의 정상 쓰기와 사진 읽기는 허용한다", async () => {
    await seedParticipantRoom()
    const member = testEnv.authenticatedContext(USER_1).firestore()
    const other = testEnv.authenticatedContext(USER_2).firestore()
    const room = doc(member, "meetings/shared-room")
    const version = crypto.randomUUID()
    function coverBatch(size: number, chosenVersion = version) {
      const batch = writeBatch(member)
      batch.update(room, { photoVersion: chosenVersion })
      batch.set(doc(room, "photos/cover"), { version: chosenVersion, bytes: Bytes.fromUint8Array(new Uint8Array(size)) })
      return batch.commit()
    }
    await assertFails(coverBatch(204801))
    await assertFails(updateDoc(room, { photoVersion: version }))
    await assertSucceeds(coverBatch(204800))
    const expense = doc(room, "expenses/expense-1")
    const metadata = () => updateDoc(expense, { memo: "확인", category: "식비", updatedAt: serverTimestamp(), revision: crypto.randomUUID() })
    await assertSucceeds(metadata())
    await setAccountLock(USER_1)
    await assertFails(coverBatch(100, crypto.randomUUID()))
    await assertFails(updateDoc(room, { memo: "잠금" }))
    await assertFails(metadata())
    await assertSucceeds(getDoc(doc(room, "photos/cover")))
    await assertSucceeds(updateDoc(doc(other, room.path), { memo: "정상 수정" }))
    await assertFails(getDoc(doc(member, 'withdrawalLocks', USER_1)))
    await assertFails(getDoc(doc(member, 'withdrawalRequests', 'request-1')))
    await assertFails(getDoc(doc(member, 'withdrawalManifests', 'request-1')))
  })

  it("멤버에게만 방과 지출을 공개하고, 계정 연결은 작성자에게도 공개하지 않는다", async () => {
    await seedParticipantRoom();
    const member = testEnv.authenticatedContext(USER_1).firestore();
    const visitor = testEnv.authenticatedContext("visitor").firestore();
    const paths = ["meetings/shared-room", "meetings/shared-room/participants/payer", "meetings/shared-room/expenses/expense-1"];
    for (const path of paths) {
      await assertSucceeds(getDoc(doc(member, path)));
      await assertFails(getDoc(doc(visitor, path)));
    }
    await assertFails(getDoc(doc(member, `meetings/shared-room/participantLinks/${USER_1}`)));
  });

  it("작성자의 메모와 카테고리 수정만 허용하고 예전 클라이언트의 금융·멤버십 변경을 거부한다", async () => {
    await seedParticipantRoom(2);
    const member = testEnv.authenticatedContext(USER_1).firestore();
    const other = testEnv.authenticatedContext(USER_2).firestore();
    const path = "meetings/shared-room/expenses/expense-1";
    const changes = { memo: "저녁", category: "식비", updatedAt: serverTimestamp(), revision: crypto.randomUUID() };
    await assertSucceeds(updateDoc(doc(member, path), changes));
    await assertFails(updateDoc(doc(other, path), { ...changes, revision: crypto.randomUUID() }));
    await assertFails(updateDoc(doc(member, path), { amount: 900 }));
    await assertFails(deleteDoc(doc(member, path)));
    await assertFails(updateDoc(doc(member, "meetings/shared-room"), { memberUids: [USER_2], memberCount: 1 }));
    await assertFails(updateDoc(doc(member, "meetings/shared-room"), { status: "settled" }));
    await assertFails(deleteDoc(doc(member, "meetings/shared-room")));
    const room = doc(member, "meetings/shared-room");
    const legacyCreate = writeBatch(member);
    legacyCreate.set(doc(member, "meetings/shared-room/expenses/legacy"), {
      amount: 500, paidBy: USER_1, createdBy: USER_1, updatedBy: USER_1, schemaVersion: 2,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    legacyCreate.update(room, { totalAmount: 1500, expenseCount: 2 });
    await assertFails(legacyCreate.commit());
    const visitor = testEnv.authenticatedContext("visitor").firestore();
    const legacyJoin = writeBatch(visitor);
    legacyJoin.update(doc(visitor, room.path), { memberUids: [USER_1, USER_2, "visitor"], memberCount: 3 });
    legacyJoin.set(doc(visitor, room.path, "members/visitor"), { nickname: "방문자" });
    await assertFails(legacyJoin.commit());
    const legacyFinalize = writeBatch(member);
    legacyFinalize.update(room, { status: "settled" });
    legacyFinalize.set(doc(member, room.path, "settlements/final"), { totalAmount: 1000 });
    await assertFails(legacyFinalize.commit());
    await assertFails(updateDoc(room, {
      photoUrl: "https://res.cloudinary.com/demo/image/upload/ddingdone/shared-room/old.jpg",
      photoPublicId: "ddingdone/shared-room/old", photoAssetId: "old",
      photoUploadedBy: USER_1, photoUploadedAt: serverTimestamp(),
    }));
    const cover = writeBatch(member);
    const photoVersion = crypto.randomUUID();
    cover.update(room, { photoVersion });
    cover.set(doc(member, room.path, "photos/cover"), { version: photoVersion, bytes: Bytes.fromUint8Array(new Uint8Array([255, 216, 255, 217])) });
    await assertSucceeds(cover.commit());
    await assertSucceeds(updateDoc(room, { name: "편집", date: "2026.11.24", memo: "메모" }));
    expect((await getDoc(room)).data()).toMatchObject({ totalAmount: 1000, memberUids: [USER_1, USER_2], status: "active" });
    expect((await getDoc(doc(member, path))).data()?.amount).toBe(1000);
    await testEnv.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), room.path), { status: "settled" }));
    await assertFails(updateDoc(room, { status: "active" }));
  });
});

  it("구형 클라이언트가 모임과 첫 멤버를 한 배치로 생성하지 못한다", async () => {
    const client = testEnv.authenticatedContext(USER_1).firestore();
    const room = doc(client, "meetings/new-legacy");
    const batch = writeBatch(client);
    batch.set(room, {
      createdBy: USER_1, memberUids: [USER_1], photoUrl: null, photoPublicId: null,
      photoAssetId: null, photoUploadedBy: null, photoUploadedAt: null,
    });
    batch.set(doc(room, "members", USER_1), { nickname: "참여자" });
    await assertFails(batch.commit());
  });

  it("명시적으로 확인한 테스트 방의 원 단위 분담을 다시 계산한다", async () => {
    const { host, port } = emulatorAddress();
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (url: URL | string, options?: RequestInit) =>
      realFetch(String(url).replace("https://firestore.googleapis.com", `http://${host}:${port}`), options));
    try {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await updateDoc(doc(db, "meetings/shared-room"), { totalAmount: 1001 });
        await updateDoc(doc(db, "meetings/shared-room/expenses/expense-1"), {
          amount: 1001, paidBy: USER_2, createdBy: USER_2,
        });
      });
      const preview = await migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", false, undefined, undefined, true);
      const backup = vi.fn(async () => {});
      await expect(migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", true, preview.sourceHash, backup, true))
        .resolves.toMatchObject({ state: "converted" });
      expect(backup).toHaveBeenCalledOnce();
      const member = testEnv.authenticatedContext(USER_2).firestore();
      const room = doc(member, "meetings/shared-room");
      expect((await getDoc(room)).data()).toMatchObject({ totalAmount: 1001, participantModelVersion: 2 });
      const expense = (await getDoc(doc(room, "expenses", "expense-1"))).data()!;
      expect(expense.amount).toBe(1001);
      expect(expense.shares.find((share: { participantId: string }) => share.participantId === expense.paidBy)?.amount).toBe(501);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("테스트 방을 실제 트랜잭션으로 전환하고 모임 나가기·재참여·비용 잠금을 검증한다", async () => {
    const { host, port } = emulatorAddress();
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: URL | string, options?: RequestInit) => {
      const target = String(url).replace("https://firestore.googleapis.com", `http://${host}:${port}`);
      try { return await realFetch(target, options); }
      catch (error) { throw new Error(`Firestore emulator request failed for ${options?.method ?? "GET"} ${new URL(target).pathname}`, { cause: error }); }
    });
    try {
      await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await updateDoc(doc(db, "meetings/shared-room"), { totalAmount: 1001 });
        await updateDoc(doc(db, "meetings/shared-room/expenses/expense-1"), {
          amount: 1001, paidBy: USER_2, createdBy: USER_2, updatedBy: USER_2,
        });
      });
      await expect(migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", false))
        .rejects.toThrow("LEGACY_BALANCE_REQUIRED");
      await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await updateDoc(doc(db, "meetings/shared-room"), { totalAmount: 1000 });
        await updateDoc(doc(db, "meetings/shared-room/expenses/expense-1"), {
          amount: 1000, paidBy: USER_1, createdBy: USER_1, updatedBy: USER_1,
        });
      });
      const preview = await migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", false);
      await expect(migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", true, preview.sourceHash))
        .resolves.toMatchObject({ state: "converted", expenses: 1, participants: 2 });
      await expect(migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", true, preview.sourceHash))
        .resolves.toEqual({ state: "already_converted" });
      const run = (uid: string, action: string, payload: Record<string, unknown> = {}) =>
        roomOperation(PROJECT_ID, "owner", "shared-room", uid, action, payload);
      const alice = await run(USER_1, "access");
      const bob = await run(USER_2, "access");
      await expect(run(USER_2, "leave", { participantId: bob.participantId })).resolves.toMatchObject({ departed: true });

      const guest = testEnv.authenticatedContext(USER_2).firestore();
      await assertFails(getDoc(doc(guest, "meetings/shared-room/expenses/expense-1")));
      const member = testEnv.authenticatedContext(USER_1).firestore();
      const path = `meetings/shared-room/participants/${bob.participantId}`;
      expect((await getDoc(doc(member, path))).exists()).toBe(false);
      const rejoined = await run(USER_2, "join", { nickname: "다른 이름" });
      expect(rejoined.participantId).not.toBe(bob.participantId);

      const cost = (await getDoc(doc(member, "meetings/shared-room/expenses/expense-1"))).data();
      expect(cost).toMatchObject({ paidBy: alice.participantId, amount: 1000 });
      await expect(run(USER_1, "expense", { action: "delete", expenseId: "expense-1", revision: cost?.revision }))
        .rejects.toThrow("EXPENSE_LOCKED");

      await expect(run(USER_1, "expense", {
        action: "edit", expenseId: "expense-1", revision: cost?.revision, requestId: "edit-once",
        participantIds: [alice.participantId], amount: 1100, category: "식비", memo: "",
      })).rejects.toThrow("EXPENSE_LOCKED");
      const snapshot = buildParticipantSnapshot([String(alice.participantId), String(rejoined.participantId)], [{
        amount: cost?.amount, paidBy: cost?.paidBy, shares: cost?.shares,
      }], undefined, true);
      expect(snapshot.participantBurdenTotals).toEqual({
        [String(alice.participantId)]: 500, [String(bob.participantId)]: 500, [String(rejoined.participantId)]: 0,
      });
      expect(snapshot.transfers).toEqual([{ from: bob.participantId, to: alice.participantId, amount: 500 }]);
      const hash = await hashSettlementSnapshot(snapshot);
      await expect(run(USER_1, "settle", { hash })).resolves.toEqual({ settled: true });
      await expect(run(USER_2, "leave", { participantId: rejoined.participantId })).resolves.toMatchObject({ departed: true });
      const final = (await getDoc(doc(member, "meetings/shared-room/settlements/final"))).data();
      expect(final).toMatchObject({ hash, totalAmount: 1000, transfers: snapshot.transfers });
      await expect(run(USER_2, "join", { nickname: "사용자 2" })).rejects.toThrow("ROOM_SETTLED");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("v1 완료 방을 전환할 때 사전 점검 이후 변경을 막고 과거 계정 연결과 장부를 분리한다", async () => {
    const { host, port } = emulatorAddress();
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (url: URL | string, options?: RequestInit) =>
      realFetch(String(url).replace("https://firestore.googleapis.com", `http://${host}:${port}`), options));
    try {
      const path = "meetings/shared-room";
      const shares = [{ participantId: "payer", amount: 500 }, { participantId: "former", amount: 500 }];
      const prior = buildParticipantSnapshot(["payer", "former"], [{ paidBy: "payer", amount: 1000, shares }]);
      const hash = await hashSettlementSnapshot(prior);
      const settledAt = new Date("2026-08-24T00:00:00.000Z");
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        const batch = writeBatch(db);
        batch.update(doc(db, path), { participantModelVersion: 1, status: "settled", memberUids: [USER_1], memberCount: 1 });
        batch.delete(doc(db, path, "members", USER_1));
        batch.delete(doc(db, path, "members", USER_2));
        batch.set(doc(db, path, "participants", "payer"), { status: "active", name: "작성자", departureVersion: 0 });
        batch.set(doc(db, path, "participants", "former"), { status: "left", name: null, departureVersion: 1 });
        batch.set(doc(db, path, "participantLinks", USER_1), { accountUid: USER_1, meetingId: "shared-room", participantId: "payer", nickname: "작성자" });
        batch.set(doc(db, path, "participantLinks", USER_2), { accountUid: USER_2, meetingId: "shared-room", participantId: "former", nickname: "과거 사용자" });
        batch.update(doc(db, path, "expenses", "expense-1"), {
          schemaVersion: 4, paidBy: "payer", createdBy: "payer", updatedBy: "payer", shares,
          participation: { payer: 0, former: 0 }, revision: "old",
        });
        batch.set(doc(db, path, "settlements", "final"), { ...prior, hash, settledAt, finalizedBy: "payer" });
        await batch.commit();
      });
      await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await updateDoc(doc(db, path), { memberUids: [USER_1, USER_2], memberCount: 2 });
        await updateDoc(doc(db, path, "participants", "former"), { status: "active", name: "복귀", departureVersion: 1 });
      });
      await expect(migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", false)).rejects.toThrow("EXPENSE_LOCK_MISMATCH");
      await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await updateDoc(doc(db, path), { memberUids: [USER_1], memberCount: 1 });
        await updateDoc(doc(db, path, "participants", "former"), { status: "left", name: null });
      });
      const preview = await migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", false);
      await testEnv.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), path), { memo: "변경" }));
      await expect(migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", true, preview.sourceHash))
        .rejects.toThrow("MIGRATION_SOURCE_CHANGED");
      const review = await migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", false);
      await expect(migrateParticipantRoom(PROJECT_ID, "owner", "shared-room", true, review.sourceHash))
        .resolves.toMatchObject({ state: "converted", settled: true });
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        expect((await getDoc(doc(db, path))).data()?.participantModelVersion).toBe(2);
        expect((await getDoc(doc(db, path, "participants", "former"))).exists()).toBe(false);
        expect((await getDoc(doc(db, path, "participantLinks", USER_2))).exists()).toBe(false);
        expect((await getDoc(doc(db, path, "participantLinks", USER_1))).data()).toEqual({ participantId: "payer" });
        expect((await getDoc(doc(db, path, "expenses", "expense-1"))).data()).toMatchObject({ amount: 1000, shares });
        const final = (await getDoc(doc(db, path, "settlements", "final"))).data();
        expect(final).toMatchObject({ hash, transfers: prior.transfers, participantBurdenTotals: prior.participantBurdenTotals });
        expect(final?.settledAt.toDate()).toEqual(settledAt);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });


  it("v2 비용 등록 경합과 응답 유실에도 합계를 한 번만 변경한다", async () => {
    const { host, port } = emulatorAddress();
    const realFetch = globalThis.fetch;
    let loseResponse = false;
    vi.stubGlobal("fetch", async (url: URL | string, options?: RequestInit) => {
      const response = await realFetch(String(url).replace("https://firestore.googleapis.com", `http://${host}:${port}`), options);
      if (loseResponse && String(url).endsWith("documents:commit") && response.ok) {
        loseResponse = false;
        await response.body?.cancel();
        throw new Error("response lost after commit");
      }
      return response;
    });
    try {
      const id = crypto.randomUUID();
      const path = `meetings/${id}`;
      await createRoom(PROJECT_ID, "owner", USER_1, { roomId: id, name: "v2", date: "2026.11.24", memo: "", nickname: "사용자 1" });
      const run = (action: string, body: Record<string, unknown> = {}) =>
        roomOperation(PROJECT_ID, "owner", id, USER_1, action, body);
      const { participantId } = await run("access");
      const makeExpense = (expenseId: string) => ({
        action: "create", expenseId, requestId: expenseId, amount: 1001,
        participantIds: [participantId], category: "식비", memo: "",
      });
      await Promise.all([run("expense", makeExpense("concurrent")), run("expense", makeExpense("concurrent"))]);
      const member = testEnv.authenticatedContext(USER_1).firestore();
      const outsider = testEnv.authenticatedContext(USER_2).firestore();
      const current = async () => (await getDoc(doc(member, path))).data();
      expect(await current()).toMatchObject({ totalAmount: 1001, participantModelVersion: 2 });
      expect((await current())?.expenseCount).toBeUndefined();
      expect((await current())?.memberCount).toBeUndefined();
      await assertFails(getDoc(doc(outsider, path, "expenses", "concurrent")));
      await assertFails(updateDoc(doc(member, path, "expenses", "concurrent"), { amount: 10 }));
      await assertFails(updateDoc(doc(member, path, "expenses", "concurrent"), {
        creationHash: "changed", memo: "수정", category: "식비", revision: crypto.randomUUID(), updatedAt: serverTimestamp(),
      }));
      await assertSucceeds(updateDoc(doc(member, path, "expenses", "concurrent"), {
        memo: "수정", category: "식비", revision: crypto.randomUUID(), updatedAt: serverTimestamp(),
      }));
      loseResponse = true;
      await expect(run("expense", makeExpense("lost"))).rejects.toThrow("response lost");
      await run("expense", makeExpense("lost"));
      expect((await current())?.totalAmount).toBe(2002);
      const lostRef = doc(member, path, "expenses", "lost");
      const creationHash = (await getDoc(lostRef)).data()?.creationHash;
      expect(creationHash).toMatch(/^[a-f0-9]{64}$/u);
      await run("expense", { action: "delete", expenseId: "lost", revision: "lost" });
      await run("expense", makeExpense("lost"));
      expect((await current())?.totalAmount).toBe(1001);
      expect((await getDoc(lostRef)).data()).toEqual({ deleted: true, creationKey: "lost", creationHash });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("합계가 같은 분담 수정과 정산 확정은 일치하는 장부만 저장한다", async () => {
    const { host, port } = emulatorAddress();
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (url: URL | string, options?: RequestInit) =>
      realFetch(String(url).replace("https://firestore.googleapis.com", `http://${host}:${port}`), options));
    try {
      const id = crypto.randomUUID();
      await createRoom(PROJECT_ID, "owner", USER_1, { roomId: id, name: "경합", date: "2026.11.24", memo: "", nickname: "사용자 1" });
      const run = (action: string, body: Record<string, unknown> = {}, uid = USER_1) =>
        roomOperation(PROJECT_ID, "owner", id, uid, action, body);
      const { participantId: payer } = await run("access") as { participantId: string };
      const { participantId: other } = await run("join", { nickname: "사용자 2" }, USER_2) as { participantId: string };
      const initial = { expenseId: "expense", requestId: "expense", amount: 1000, category: "식비", memo: "", participantIds: [payer, other] };
      await run("expense", { ...initial, action: "create" });

      const member = testEnv.authenticatedContext(USER_1).firestore();
      const room = doc(member, "meetings", id);
      const expense = doc(room, "expenses", "expense");
      const ledger = (async () => (await getDoc(expense)).data() as Parameters<typeof buildV2SettlementSnapshot>[1][number]);
      const ids = [payer, other].sort();
      const previousHash = await hashSettlementSnapshot(buildV2SettlementSnapshot(ids, [await ledger()]));
      const [edit, settle] = await Promise.allSettled([
        run("expense", { ...initial, action: "edit", revision: "expense", requestId: "edited", participantIds: [payer] }),
        run("settle", { hash: previousHash }),
      ]);
      expect((await getDoc(room)).data()?.totalAmount).toBe(1000);
      const latestHash = await hashSettlementSnapshot(buildV2SettlementSnapshot(ids, [await ledger()]));
      if (settle.status === "fulfilled") {
        expect(edit).toMatchObject({ status: "rejected", reason: { code: "ROOM_SETTLED" } });
      } else {
        expect(edit.status).toBe("fulfilled");
        expect(settle.reason).toMatchObject({ code: "ROOM_CHANGED" });
        expect(latestHash).not.toBe(previousHash);
        await run("settle", { hash: latestHash });
      }
      expect((await getDoc(doc(room, "settlements", "final"))).data()).toMatchObject({ hash: latestHash, totalAmount: 1000 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("마지막 v2 참여자가 나가면 Firestore 사진과 방이 함께 사라진다", async () => {
    const { host, port } = emulatorAddress();
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (url: URL | string, options?: RequestInit) =>
      realFetch(String(url).replace("https://firestore.googleapis.com", `http://${host}:${port}`), options));
    try {
      const roomId = crypto.randomUUID();
      await createRoom(PROJECT_ID, "owner", USER_1, { roomId, name: "사진", date: "2026.11.24", memo: "", nickname: "사용자 1" });
      const member = testEnv.authenticatedContext(USER_1).firestore();
      const guest = testEnv.authenticatedContext(USER_2).firestore();
      const room = doc(member, "meetings", roomId);
      const photo = doc(room, "photos", "cover");
      const version = crypto.randomUUID();
      const batch = writeBatch(member);
      batch.update(room, { photoVersion: version });
      batch.set(photo, { version, bytes: Bytes.fromUint8Array(new Uint8Array([255, 216, 255, 217])) });
      await assertSucceeds(batch.commit());
      await assertFails(updateDoc(room, { photoPublicId: `ddingdone/${roomId}/other` }));
      await assertFails(getDoc(doc(guest, "meetings", roomId, "photos", "cover")));
      const { participantId } = await roomOperation(PROJECT_ID, "owner", roomId, USER_1, "access", {});
      await roomOperation(PROJECT_ID, "owner", roomId, USER_1, "leave", { participantId });
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        expect((await getDoc(doc(db, "meetings", roomId))).exists()).toBe(false);
        expect((await getDoc(doc(db, "meetings", roomId, "photos", "cover"))).exists()).toBe(false);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
