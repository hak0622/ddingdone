import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
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
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

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

  it("잠금 전에는 기존의 정상적인 방·멤버·비용 수정이 가능하다", async () => {
    const db = testEnv.authenticatedContext(USER_1).firestore();

    await assertSucceeds(
      updateDoc(doc(db, "meetings/shared-room"), { memo: "수정된 메모" }),
    );
    await assertSucceeds(
      updateDoc(doc(db, `meetings/shared-room/members/${USER_1}`), {
        nickname: "새 닉네임",
      }),
    );
    const expenseBatch = writeBatch(db);
    expenseBatch.update(doc(db, "meetings/shared-room/expenses/expense-1"), {
        amount: 1500,
        updatedBy: USER_1,
        updatedAt: serverTimestamp(),
    });
    expenseBatch.update(doc(db, "meetings/shared-room"), {
      totalAmount: increment(500),
    });
    await assertSucceeds(expenseBatch.commit());
  });

  it("일반 멤버가 createdBy를 바꿔 방장 권한을 가져갈 수 없다", async () => {
    const db = testEnv.authenticatedContext(USER_2).firestore();

    await assertFails(
      updateDoc(doc(db, "meetings/shared-room"), { createdBy: USER_2 }),
    );
  });

  it("비멤버가 members 문서만 만들어 정산 인원을 조작할 수 없다", async () => {
    const outsiderDb = testEnv.authenticatedContext("outsider").firestore();

    await assertFails(
      setDoc(doc(outsiderDb, "meetings/shared-room/members/outsider"), {
        nickname: "침입자",
      }),
    );
  });

  it("멤버가 다른 사람 명의로 비용을 등록할 수 없다", async () => {
    const db = testEnv.authenticatedContext(USER_2).firestore();

    await assertFails(
      setDoc(doc(db, "meetings/shared-room/expenses/forged-expense"), {
        amount: 1000,
        category: "식비",
        memo: "",
        paidBy: USER_1,
        createdBy: USER_2,
        createdAt: serverTimestamp(),
        updatedBy: USER_2,
        updatedAt: serverTimestamp(),
        schemaVersion: 2,
      }),
    );
  });

  it("계정 탈퇴 잠금은 해당 사용자의 모든 쓰기를 차단한다", async () => {
    await setAccountLock(USER_1);
    const db = testEnv.authenticatedContext(USER_1).firestore();

    await assertFails(
      updateDoc(doc(db, "meetings/shared-room"), { memo: "변경 시도" }),
    );
    await assertFails(
      updateDoc(doc(db, `meetings/shared-room/members/${USER_1}`), {
        nickname: "변경 시도",
      }),
    );
    await assertFails(
      updateDoc(doc(db, "meetings/shared-room/expenses/expense-1"), {
        amount: 9999,
        updatedBy: USER_1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      deleteDoc(doc(db, "meetings/shared-room/expenses/expense-1")),
    );
  });

  it("한 사용자의 계정 잠금은 다른 사용자의 다른 방을 건드리지 않는다", async () => {
    await setAccountLock(USER_1);
    const otherDb = testEnv.authenticatedContext(USER_2).firestore();

    await assertSucceeds(
      updateDoc(doc(otherDb, "meetings/other-room"), { memo: "정상 수정" }),
    );
    const expenseBatch = writeBatch(otherDb);
    expenseBatch.update(doc(otherDb, "meetings/other-room/expenses/expense-2"), {
        amount: 2500,
        updatedBy: USER_2,
        updatedAt: serverTimestamp(),
    });
    expenseBatch.update(doc(otherDb, "meetings/other-room"), {
      totalAmount: increment(500),
    });
    await assertSucceeds(expenseBatch.commit());
  });

  it("한 사용자의 계정 잠금 중에도 다른 멤버는 같은 공유방을 수정할 수 있다", async () => {
    await setAccountLock(USER_1);
    const otherDb = testEnv.authenticatedContext(USER_2).firestore();

    await assertSucceeds(
      updateDoc(doc(otherDb, "meetings/shared-room"), { memo: "탈퇴 중에도 수정" }),
    );
    const expenseBatch = writeBatch(otherDb);
    expenseBatch.set(doc(otherDb, "meetings/shared-room/expenses/expense-by-user-2"), {
      amount: 700,
      category: "교통",
      memo: "",
      paidBy: USER_2,
      createdBy: USER_2,
      createdAt: serverTimestamp(),
      updatedBy: USER_2,
      updatedAt: serverTimestamp(),
      schemaVersion: 2,
    });
    expenseBatch.update(doc(otherDb, "meetings/shared-room"), {
      totalAmount: increment(700),
      expenseCount: increment(1),
    });
    await assertSucceeds(expenseBatch.commit());
  });

  it("이전 버전의 방 잠금 표시가 남아 있어도 다른 멤버의 정상 쓰기는 막지 않는다", async () => {
    await setMeetingLock("shared-room");
    const otherDb = testEnv.authenticatedContext(USER_2).firestore();

    await assertSucceeds(
      updateDoc(doc(otherDb, "meetings/shared-room"), { memo: "정상 변경" }),
    );
    await assertSucceeds(
      updateDoc(doc(otherDb, `meetings/shared-room/members/${USER_2}`), {
        nickname: "정상 변경",
      }),
    );
    await assertFails(
      updateDoc(doc(otherDb, "meetings/shared-room"), {
        withdrawalLockRequestId: "fake-request",
      }),
    );
    await assertSucceeds(
      updateDoc(doc(otherDb, "meetings/other-room"), { memo: "정상 수정" }),
    );
  });

  it("비용 금액만 바꾸고 방 총액을 함께 갱신하지 않으면 거부한다", async () => {
    const db = testEnv.authenticatedContext(USER_1).firestore();

    await assertFails(
      updateDoc(doc(db, "meetings/shared-room/expenses/expense-1"), {
        amount: 1500,
        updatedBy: USER_1,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("비용 추가는 방 총액과 비용 개수를 같은 배치로 갱신해야 한다", async () => {
    const db = testEnv.authenticatedContext(USER_2).firestore();
    const expense = {
      amount: 500,
      category: "식비",
      memo: "",
      paidBy: USER_2,
      createdBy: USER_2,
      createdAt: serverTimestamp(),
      updatedBy: USER_2,
      updatedAt: serverTimestamp(),
      schemaVersion: 2,
    };

    await assertFails(
      setDoc(doc(db, "meetings/shared-room/expenses/new-without-aggregate"), expense),
    );

    const batch = writeBatch(db);
    batch.set(doc(db, "meetings/shared-room/expenses/new-with-aggregate"), expense);
    batch.update(doc(db, "meetings/shared-room"), {
      totalAmount: increment(500),
      expenseCount: increment(1),
    });
    await assertSucceeds(batch.commit());
  });

  it("잠금 중에도 일반 데이터 읽기는 유지된다", async () => {
    await setAccountLock(USER_1);
    await setMeetingLock("shared-room");
    const db = testEnv.authenticatedContext(USER_1).firestore();

    await assertSucceeds(getDoc(doc(db, "meetings/shared-room")));
    await assertSucceeds(
      getDoc(doc(db, "meetings/shared-room/expenses/expense-1")),
    );
  });

  it("앱 클라이언트는 본인 탈퇴 내부 문서에도 접근할 수 없다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        setDoc(doc(adminDb, "withdrawalManifests/manifest-1"), { uid: USER_1 }),
        setDoc(doc(adminDb, "withdrawalRequests/request-1"), { uid: USER_1 }),
        setDoc(doc(adminDb, "cloudinaryDeletionJobs/job-1"), { publicId: "secret" }),
      ]);
    });
    const db = testEnv.authenticatedContext(USER_1).firestore();

    await assertFails(getDoc(doc(db, "withdrawalManifests/manifest-1")));
    await assertFails(getDoc(doc(db, "withdrawalRequests/request-1")));
    await assertFails(getDoc(doc(db, `withdrawalLocks/${USER_1}`)));
    await assertFails(getDoc(doc(db, "cloudinaryDeletionJobs/job-1")));
    await assertFails(
      setDoc(doc(db, `withdrawalLocks/${USER_1}`), { requestId: "fake" }),
    );
  });

  it("계정 잠금이 해제되면 해당 사용자의 정상 쓰기가 다시 가능하다", async () => {
    await setAccountLock(USER_1);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), `withdrawalLocks/${USER_1}`));
    });
    const db = testEnv.authenticatedContext(USER_1).firestore();

    await assertSucceeds(
      updateDoc(doc(db, "meetings/shared-room"), { memo: "다시 수정 가능" }),
    );
  });
});
