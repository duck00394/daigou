// 全部砍單、一件都沒買到：運費（賣貨便 38 等）不用付，不算進總額；有買到一件就照收
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBatchCost, addBatchItem, createBatch } from "@/server/services/purchase";
import { batchPaySummary, cancelBatchItem } from "@/server/services/batch-ops";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

describe("全部沒買到，運費不用付", () => {
  it("兩件都砍 → 總額 0；只砍一件 → 還要付另一件＋運費", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "搶購團", supplier: "代購" }));
    const i1 = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 1, unitCost: 500, currency: "TWD" }));
    const i2 = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p2.id, qty: 1, unitCost: 400, currency: "TWD" }));
    await tx((t) => addBatchCost(t, actor, { batchId: b.id, kind: "TW_DOMESTIC_SHIPPING", currency: "TWD", amount: 38, method: "NONE", note: "賣貨便" }));
    expect((await tx((t) => batchPaySummary(t, [b.id]))).get(b.id)?.totalTwd).toBe(938);
    await tx((t) => cancelBatchItem(t, actor, i1.id, { qty: 1, reason: "AGENT_CANCEL" }));
    expect((await tx((t) => batchPaySummary(t, [b.id]))).get(b.id)?.totalTwd).toBe(438);
    await tx((t) => cancelBatchItem(t, actor, i2.id, { qty: 1, reason: "AGENT_CANCEL" }));
    expect((await tx((t) => batchPaySummary(t, [b.id]))).get(b.id)?.totalTwd).toBe(0);
  });
});
