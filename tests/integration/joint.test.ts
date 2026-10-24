// 合資：每件是誰的、一起的比例、運費怎麼分、誰付了多少、兩人之間誰要給誰
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchCost, addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { jointSettlement, recordJointTransfer, saveJointSetup, setPaidBy, unsettledJoint } from "@/server/services/joint";
import { stockByOwner, JOINT } from "@/server/services/ownership";
import { listQuickSales, quickSale } from "@/server/services/quick-sale";

const A = "op_a";
const B = "op_b";
let s: Awaited<ReturnType<typeof seedBasics>>;

beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

describe("合資分帳", () => {
  it("每件歸人；一起的照比例；運費各半或照商品；A 先付全部 → B 要給 A；給了就結清", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "合資團", supplier: "代購", ownership: "JOINT" }));
    const [ia, ib, ish] = await tx(async (t) => [
      await addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 2, unitCost: 350, currency: "TWD" }),
      await addBatchItem(t, actor, b.id, { productId: s.p2.id, qty: 3, unitCost: 350, currency: "TWD" }),
      await addBatchItem(t, actor, b.id, { productId: s.p3.id, qty: 1, unitCost: 350, currency: "TWD" }),
    ]);
    await prisma.purchaseBatchItem.update({ where: { id: ia.id }, data: { ownerId: A } });
    await prisma.purchaseBatchItem.update({ where: { id: ib.id }, data: { ownerId: B } });
    await tx((t) => addBatchCost(t, actor, { batchId: b.id, kind: "INTL_SHIPPING", currency: "TWD", amount: 100, method: "NONE" }));
    // 預設：一起的各半、運費各半 → A 700+175+50、B 1050+175+50
    let st = await tx((t) => jointSettlement(t, b.id));
    expect(st.people.map((p) => p.owed)).toEqual([925, 1275]);
    // A 先付全部 2200 → B 要給 A 1275
    await tx((t) => setPaidBy(t, actor, b.id, [{ paidById: A, total: 2200 }], "joint-pay-0001"));
    st = await tx((t) => jointSettlement(t, b.id));
    expect(st.debts).toEqual([{ from: B, to: A, amount: 1275 }]);
    expect((await tx((t) => unsettledJoint(t))).map((x) => x.id)).toEqual([b.id]);
    // 一起的改 7:3、運費照商品金額
    await tx((t) => saveJointSetup(t, actor, b.id, { split: { [A]: 70, [B]: 30 }, feeSplit: "GOODS" }));
    st = await tx((t) => jointSettlement(t, b.id));
    expect(st.people.map((p) => p.goods)).toEqual([700 + 245, 1050 + 105]);
    expect(st.people.reduce((a, p) => a + p.owed, 0)).toBe(2200);
    // 付款不能改少
    await expect(tx((t) => setPaidBy(t, actor, b.id, [{ paidById: A, total: 100 }]))).rejects.toThrow("要改少");
    // B 給了 A → 結清
    await tx((t) => recordJointTransfer(t, actor, b.id, { from: B, to: A, amount: st.debts[0].amount }));
    st = await tx((t) => jointSettlement(t, b.id));
    expect(st.debts).toEqual([]);
    // 庫存：A 的、B 的、一起的分開
    await tx(async (t) => {
      for (const it of [ia, ib, ish]) await createReceivingRecord(t, actor, { batchId: b.id, receivedById: A, lines: [{ batchItemId: it.id, receivedQty: it.qty }] });
    });
    const stock = await tx((t) => stockByOwner(t, { productIds: [s.p1.id, s.p2.id, s.p3.id] }));
    expect(stock.get(s.p1.id)!.get(A)!.free).toBe(2);
    expect(stock.get(s.p2.id)!.get(B)!.free).toBe(3);
    expect(stock.get(s.p3.id)!.get(JOINT)!.free).toBe(1);
    // 賣掉一起的：照 7:3 分
    await tx((t) => quickSale(t, actor, { productId: s.p3.id, qty: 1, unitPrice: 1000, owner: JOINT, idemKey: "joint-sell-0001" }));
    const list = await tx((t) => listQuickSales(t, {}));
    expect([list.byOwner[A].revenue, list.byOwner[B].revenue]).toEqual([700, 300]);
  });
});
