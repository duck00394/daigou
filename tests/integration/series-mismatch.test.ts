// 可能選錯系列的採購團：只有「沒有任何一個商品屬於這團的系列」才提醒；一團買多個系列不算
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity, seriesMismatch } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBatchItem, createBatch } from "@/server/services/purchase";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});

async function batchWith(name: string, batchCat: string, itemCats: string[]) {
  const b = await tx((t) => createBatch(t, actor, { name, supplier: "代購", categoryId: batchCat }));
  for (const c of itemCats) {
    const it = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 1, unitCost: 300, currency: "TWD" }));
    await prisma.purchaseBatchItem.update({ where: { id: it.id }, data: { categoryId: c } });
  }
  return b;
}

describe("可能選錯系列的採購團", () => {
  it("商品全是別的系列 → 提醒；有一個是自己系列 → 不提醒；健康檢查仍是一致", async () => {
    const wrong = await batchWith("選錯的團", s.halloween.id, [s.shanghai.id, s.shanghai.id]);
    await batchWith("混合的團", s.halloween.id, [s.halloween.id, s.shanghai.id]);
    await batchWith("空的團", s.halloween.id, []);
    const r = await seriesMismatch(prisma);
    expect(r.map((x) => x.href)).toEqual([`/inventory/batches/${wrong.id}`]);
    expect(r[0].message).toContain("上海限定");
    expect(await checkIntegrity(prisma)).toEqual([]);
  });
});
