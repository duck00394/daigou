// 二補運費（日本官網買的團）：採購團明細、新增採購共用 secondShipInfo
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBatchCost, addBatchItem, createBatch } from "@/server/services/purchase";
import { saveSupplier } from "@/server/services/series";
import { secondShipInfo, setSecondShipFee } from "@/server/services/settings";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});

async function batchOf(kind: "OFFICIAL_ONLINE" | "AGENT", qty: number) {
  return tx(async (t) => {
    const sp = await saveSupplier(t, actor, null, { name: kind === "OFFICIAL_ONLINE" ? "吉伊卡哇官網" : "代購小美", defaultCurrency: "TWD", kind });
    const b = await createBatch(t, actor, { name: `${kind} 團`, supplierId: sp.id, rate: "0.21", categoryId: s.halloween.id });
    const it = await addBatchItem(t, actor, b.id, { productId: s.p1.id, qty, unitCost: 400, currency: "TWD" });
    return { batchId: b.id, itemId: it.id };
  });
}

describe("二補運費資料", () => {
  it("日本官網的團：照品項算隻數，帶出記住的每隻幾元和已記過的金額", async () => {
    const b = await batchOf("OFFICIAL_ONLINE", 10);
    const typeId = (await prisma.product.findUnique({ where: { id: s.p1.id }, select: { productTypeId: true } }))!.productTypeId ?? "-";
    await tx((t) => setSecondShipFee(t, actor, typeId, 30));
    let info = await secondShipInfo(prisma, b.batchId);
    expect(info?.rows).toEqual([expect.objectContaining({ typeId, qty: 10, items: [{ id: b.itemId, qty: 10 }] })]);
    expect(info?.saved[typeId]).toBe(30);
    expect(info?.recorded).toBeNull();
    expect(info?.open).toBe(true);

    await tx((t) => addBatchCost(t, actor, { batchId: b.batchId, kind: "INTL_SHIPPING", currency: "TWD", amount: 300, method: "MANUAL", manualSplit: { [b.itemId]: 300 }, note: "二補運費" }));
    info = await secondShipInfo(prisma, b.batchId);
    expect(info?.recorded).toBe(300);
  });

  it("不是日本官網的團不顯示二補運費", async () => {
    const b = await batchOf("AGENT", 3);
    expect(await secondShipInfo(prisma, b.batchId)).toBeNull();
  });
});
