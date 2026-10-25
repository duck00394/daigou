// 關稅 %：整團預設、單件另填，自動算出一筆關稅並攤進每件成本；改成實際金額後不再自動算
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBatchItem, createBatch, deleteBatchCost, fixAutoDuty, landedCosts, setBatchDuty, setItemDuty, updateBatchItem } from "@/server/services/purchase";
import { cancelBatchItem } from "@/server/services/batch-ops";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

const autoDuty = (batchId: string) => prisma.batchCost.findFirst({ where: { batchId, autoDuty: true } });

describe("關稅 %", () => {
  it("整團 10%、單件另填 5%；商品變了自動重算；改成實際金額後固定", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "關稅團", supplier: "代購" }));
    const [i1, i2] = await tx(async (t) => [
      await addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 2, unitCost: 500, currency: "TWD" }),
      await addBatchItem(t, actor, b.id, { productId: s.p2.id, qty: 1, unitCost: 1000, currency: "TWD" }),
    ]);
    expect(await autoDuty(b.id)).toBeNull();
    await tx((t) => setBatchDuty(t, actor, b.id, 10));
    expect((await autoDuty(b.id))?.amount).toBe(200);
    let l = await tx((t) => landedCosts(t, [i1.id, i2.id]));
    expect(l.get(i1.id)!.feesTwd).toBe(100);
    expect(l.get(i2.id)!.feesTwd).toBe(100);

    // 單件另填 5%
    await tx((t) => setItemDuty(t, actor, i2.id, 5));
    expect((await autoDuty(b.id))?.amount).toBe(150);
    l = await tx((t) => landedCosts(t, [i2.id]));
    expect(l.get(i2.id)!.feesTwd).toBe(50);

    // 改價格、砍單會自動重算
    await tx((t) => updateBatchItem(t, actor, i1.id, { unitCost: 600 }));
    expect((await autoDuty(b.id))?.amount).toBe(120 + 50);
    await tx((t) => cancelBatchItem(t, actor, i1.id, { qty: 1, reason: "AGENT_CANCEL" }));
    expect((await autoDuty(b.id))?.amount).toBe(60 + 50);

    // 改成實際金額：固定、不再自動算
    const c = (await autoDuty(b.id))!;
    await tx((t) => fixAutoDuty(t, actor, c.id, 130));
    const fixed = await prisma.batchCost.findUniqueOrThrow({ where: { id: c.id } });
    expect([fixed.autoDuty, fixed.amount, fixed.method]).toEqual([false, 130, "BY_VALUE"]);
    await tx((t) => updateBatchItem(t, actor, i1.id, { unitCost: 900 }));
    expect(await autoDuty(b.id)).toBeNull();
    expect((await prisma.batchCost.findUniqueOrThrow({ where: { id: c.id } })).amount).toBe(130);
  });

  it("刪掉自動算的關稅＝不再自動算；% 清空也會拿掉", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "關稅團 2", supplier: "代購" }));
    await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 1, unitCost: 1000, currency: "TWD" }));
    await tx((t) => setBatchDuty(t, actor, b.id, 8));
    const c = (await autoDuty(b.id))!;
    expect(c.amount).toBe(80);
    await tx((t) => deleteBatchCost(t, actor, c.id));
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: b.id } })).dutyBp).toBeNull();
    await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p2.id, qty: 1, unitCost: 1000, currency: "TWD" }));
    expect(await autoDuty(b.id)).toBeNull();
    await tx((t) => setBatchDuty(t, actor, b.id, 5));
    expect((await autoDuty(b.id))?.amount).toBe(100);
    await tx((t) => setBatchDuty(t, actor, b.id, null));
    expect(await autoDuty(b.id)).toBeNull();
    await expect(tx((t) => setBatchDuty(t, actor, b.id, 120))).rejects.toThrow("0～100");
  });
});
