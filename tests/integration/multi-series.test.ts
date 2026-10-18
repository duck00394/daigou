import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb } from "../helpers";
import { saveCategory, upsertCharacter, upsertProductType } from "@/server/services/catalog";
import { addCharactersToSeries, bulkAddSeriesItems, saveSeries, type BulkRow } from "@/server/services/series";
import { addBatchCost, createBatch } from "@/server/services/purchase";
import { batchPaySummary, categoriesSummary, categoryOverview, dueByOwner } from "@/server/services/batch-ops";
import { checkIntegrity } from "@/server/services/integrity";

const row = (k: string, o: Partial<BulkRow>): BulkRow => ({ rowKey: k, characterId: null, unitCost: null, currency: "TWD", qty: null, ...o });

describe("一團放好幾個系列", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("同一團加兩個系列：商品各自掛系列；活動總額照商品金額比例分運費，加起來等於整團", async () => {
    const c = await tx(async (t) => {
      const ip = await saveSeries(t, actor, null, { name: "吉伊卡哇" });
      const ty = await upsertProductType(t, actor, { name: "吊娃" });
      const chii = await upsertCharacter(t, actor, { name: "吉伊" });
      await addCharactersToSeries(t, actor, ip.id, { characterIds: [chii.id] });
      const a = await saveCategory(t, actor, null, { name: "肉包", type: "CUSTOM", customType: "常設店" });
      const b = await saveCategory(t, actor, null, { name: "幽靈", type: "CUSTOM", customType: "常設店" });
      const batch = await createBatch(t, actor, { name: "小小的超吉市場", supplier: "小小的超吉市場", categoryId: a.id });
      return { ip: ip.id, ty: ty.id, chii: chii.id, a: a.id, b: b.id, batch: batch.id };
    });
    const add = (cat: string | null, key: string, cost: number, qty: number) =>
      bulkAddSeriesItems(actor, { batchId: c.batch, seriesId: c.ip, productTypeId: c.ty, submissionKey: key, categoryId: cat, rows: [row("r", { characterId: c.chii, unitCost: cost, qty })] });
    await add(null, "s-a", 600, 1); // 跟著這團：肉包
    await add(c.b, "s-b", 300, 2); // 換系列：幽靈
    const items = await prisma.purchaseBatchItem.findMany({ where: { batchId: c.batch }, include: { product: true }, orderBy: { createdAt: "asc" } });
    expect(items.map((i) => i.product.name)).toEqual(["肉包吉伊 吊娃", "幽靈吉伊 吊娃"]);
    expect(items.map((i) => i.categoryId)).toEqual([null, c.b]);
    // 運費 120 不攤：肉包 600、幽靈 600 → 各分 60
    await tx((t) => addBatchCost(t, actor, { batchId: c.batch, kind: "TW_DOMESTIC_SHIPPING", currency: "TWD", amount: 120, method: "NONE" }));
    const total = (await tx((t) => batchPaySummary(t, [c.batch]))).get(c.batch)!.totalTwd;
    expect(total).toBe(1320);
    const sum = await tx((t) => categoriesSummary(t));
    expect([sum.get(c.a)!.totalTwd, sum.get(c.b)!.totalTwd]).toEqual([660, 660]);
    expect(sum.get(c.a)!.totalTwd + sum.get(c.b)!.totalTwd).toBe(total);
    const ov = await tx((t) => categoryOverview(t, c.b));
    expect(ov.batches).toHaveLength(1);
    expect(ov.batches[0]).toMatchObject({ qty: 2, totalTwd: 660, dueTwd: 660, partial: true });
    expect(ov.matrix.map((m) => m.product.name)).toEqual(["幽靈吉伊 吊娃"]);
    const dueB = await tx((t) => dueByOwner(t, { categoryId: c.b }));
    expect([...dueB.values()].reduce((s, v) => s + v.due, 0)).toBe(660);
    expect(await checkIntegrity(prisma)).toEqual([]);
  });
});
