import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkIntegrity } from "@/server/services/integrity";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { addCharactersToSeries, bulkAddSeriesItems, bulkUpdateBatchItems, copySeriesRoster, lastUsedRoster, rowDefaults, saveSeries, saveSupplier, saveTemplate, type BulkRow } from "@/server/services/series";
import { createBatch, deleteBatchItem, landedCosts, minCommittedQty, updateBatchItem } from "@/server/services/purchase";
import { inventorySummary, receiveStock, reserveForItem } from "@/server/services/inventory";
import { createOrder, updateItem } from "@/server/services/orders";
import { createShipment } from "@/server/services/shipping";
import { updateProduct, upsertCharacter, upsertProductType } from "@/server/services/catalog";

let s: Awaited<ReturnType<typeof seedBasics>>;
let ctx: { seriesId: string; typeId: string; chiikawa: string; hachi: string; usagi: string; supplierId: string; batchId: string };

beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  ctx = await tx(async (t) => {
    const series = await saveSeries(t, actor, null, { name: "吉伊卡哇" });
    const type = await upsertProductType(t, actor, { name: "吊娃" });
    const c1 = await upsertCharacter(t, actor, { name: "吉伊" });
    const c2 = await upsertCharacter(t, actor, { name: "小八" });
    const c3 = await upsertCharacter(t, actor, { name: "兔兔" });
    await addCharactersToSeries(t, actor, series.id, { characterIds: [c1.id, c2.id, c3.id] });
    const sp = await saveSupplier(t, actor, null, { name: "日本官網", defaultCurrency: "JPY" });
    const b = await createBatch(t, actor, { name: "10 月第一團", supplierId: sp.id, rate: "0.21" });
    return { seriesId: series.id, typeId: type.id, chiikawa: c1.id, hachi: c2.id, usagi: c3.id, supplierId: sp.id, batchId: b.id };
  });
});

const row = (k: string, o: Partial<BulkRow>): BulkRow => ({ rowKey: k, characterId: null, unitCost: null, currency: "TWD", qty: null, ...o });
const add = (rows: BulkRow[], submissionKey = "sub-1", batchId = ctx.batchId) =>
  bulkAddSeriesItems(actor, { batchId, seriesId: ctx.seriesId, productTypeId: ctx.typeId, submissionKey, rows });


// 每項測試結束後交叉核對：庫存、訂單快取、到貨、費用分攤、出貨都要和流水一致
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

describe("批次新增系列商品", () => {
  it("1. 一次建立 3 個角色，各自不同單價與數量", async () => {
    const r = await add([
      row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 3 }),
      row("b", { characterId: ctx.hachi, unitCost: 350, qty: 2 }),
      row("c", { characterId: ctx.usagi, unitCost: 420, qty: 4 }),
    ]);
    expect([r.created, r.failed]).toEqual([3, 0]);
    const items = await prisma.purchaseBatchItem.findMany({ where: { batchId: ctx.batchId }, include: { product: true }, orderBy: { createdAt: "asc" } });
    expect(items.map((i) => [i.product.name, i.estUnitCost, i.qty, i.currency])).toEqual([
      ["吉伊卡哇 吉伊 吊娃", 350, 3, "TWD"],
      ["吉伊卡哇 小八 吊娃", 350, 2, "TWD"],
      ["吉伊卡哇 兔兔 吊娃", 420, 4, "TWD"],
    ]);
    // 每個角色是獨立商品，掛在系列與類型下
    expect(new Set(items.map((i) => i.productId)).size).toBe(3);
    expect(items.every((i) => i.product.seriesId === ctx.seriesId && i.product.productTypeId === ctx.typeId)).toBe(true);
    // 總成本：(1050 + 700 + 1680) 台幣
    const lc = await tx((t) => landedCosts(t, items.map((i) => i.id)));
    expect([...lc.values()].reduce((a, b) => a + b.goodsTwd, 0)).toBe(3430);
  });

  it("2. 自訂新角色與既有角色一起儲存，新角色加入系列名單", async () => {
    const r = await add([row("a", { characterId: ctx.chiikawa, unitCost: 1650, currency: "JPY", qty: 1 }), row("b", { newCharacterName: "栗子饅頭", unitCost: 1650, currency: "JPY", qty: 2 })]);
    expect(r.created).toBe(2);
    const ch = await prisma.character.findUniqueOrThrow({ where: { name: "栗子饅頭" } });
    expect(await prisma.seriesCharacter.count({ where: { seriesId: ctx.seriesId, characterId: ch.id } })).toBe(1);
    // 再輸入同名新角色時沿用既有角色，不重複建立
    const b2 = await tx((t) => createBatch(t, actor, { name: "第二團", rate: "0.2" }));
    await add([row("x", { newCharacterName: "栗子饅頭", unitCost: 1700, currency: "JPY", qty: 1 })], "sub-2", b2.id);
    expect(await prisma.character.count({ where: { name: "栗子饅頭" } })).toBe(1);
  });

  it("3. 空白列不建立；不合法的數量、單價與重複角色被拒絕", async () => {
    const r = await add([
      row("blank1", {}),
      row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 1 }),
      row("neg", { characterId: ctx.hachi, unitCost: 350, qty: -2 }),
      row("frac", { characterId: ctx.usagi, unitCost: 420, qty: 1.5 }),
      row("zero", { newCharacterName: "飛鼠", unitCost: 300, qty: 0 }),
      row("noprice", { newCharacterName: "獅薩", unitCost: null, qty: 1 }),
      row("dup", { characterId: ctx.chiikawa, unitCost: 360, qty: 1 }),
      row("blank2", {}),
    ]);
    expect(r.skippedBlank).toBe(2);
    expect(r.created).toBe(1);
    const err = Object.fromEntries(r.results.filter((x) => !x.ok).map((x) => [x.rowKey, x.error]));
    expect(err.neg).toContain("正整數");
    expect(err.frac).toContain("正整數");
    expect(err.zero).toContain("正整數");
    expect(err.noprice).toContain("單價");
    expect(err.dup).toContain("重複");
    expect(await prisma.purchaseBatchItem.count()).toBe(1);
    expect(await prisma.character.count({ where: { name: { in: ["飛鼠", "獅薩"] } } })).toBe(0);
  });

  it("4. 部分失敗後重送：成功的列不會重複新增，修正後的失敗列可補建立", async () => {
    const rows = [row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 3 }), row("b", { characterId: ctx.hachi, unitCost: 350, qty: 0 })];
    const first = await add(rows);
    expect([first.created, first.failed]).toEqual([1, 1]);
    const retry = await add([rows[0], { ...rows[1], qty: 2 }]);
    expect(retry.already).toBe(1);
    expect(retry.created).toBe(1);
    expect(await prisma.purchaseBatchItem.count({ where: { batchId: ctx.batchId } })).toBe(2);
    // 同時送出兩次也不會重複
    const [x, y] = await Promise.all([add([row("c", { characterId: ctx.usagi, unitCost: 420, qty: 1 })], "sub-9"), add([row("c", { characterId: ctx.usagi, unitCost: 420, qty: 1 })], "sub-9")]);
    expect(x.created + y.created).toBe(1);
    expect(x.already + y.already).toBe(1);
    expect(await prisma.purchaseBatchItem.count({ where: { batchId: ctx.batchId } })).toBe(3);
  });

  it("採購團已有相同商品時拒絕重複加入；不同規格是不同商品", async () => {
    await add([row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 1 })]);
    const again = await add([row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 1 })], "sub-2");
    expect(again.results[0].error).toContain("已經有");
    const spec = await add([row("a", { characterId: ctx.chiikawa, spec: "萬聖節款", unitCost: 380, qty: 1 })], "sub-3");
    expect(spec.created).toBe(1);
    const products = await prisma.product.findMany({ where: { characters: { some: { characterId: ctx.chiikawa } }, seriesId: ctx.seriesId } });
    expect(products).toHaveLength(2);
  });
});

describe("跨採購團與價格", () => {
  it("5. 同一系列套用到第二團後，兩團價格與數量各自獨立", async () => {
    await add([row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 3 }), row("b", { characterId: ctx.usagi, unitCost: 420, qty: 4 })]);
    const b2 = await tx((t) => createBatch(t, actor, { name: "第二團", supplierId: ctx.supplierId, rate: "0.2" }));
    const last = await lastUsedRoster(prisma, { seriesId: ctx.seriesId, excludeBatchId: b2.id });
    expect(last?.items.map((i) => i.characterId)).toEqual([ctx.chiikawa, ctx.usagi]);
    // 參考帶入：同供應商最近一次的價格，逐角色不同
    const d = await rowDefaults(prisma, { seriesId: ctx.seriesId, productTypeId: ctx.typeId, supplierId: ctx.supplierId, characterIds: [ctx.chiikawa, ctx.usagi, ctx.hachi] });
    expect(d.map((x) => [x.unitCost, x.currency])).toEqual([[350, "TWD"], [420, "TWD"], [null, "JPY"]]);
    await add([row("a", { characterId: ctx.chiikawa, unitCost: 380, qty: 1 }), row("b", { characterId: ctx.usagi, unitCost: 450, qty: 6 })], "sub-b2", b2.id);
    const first = await prisma.purchaseBatchItem.findMany({ where: { batchId: ctx.batchId }, orderBy: { createdAt: "asc" } });
    const second = await prisma.purchaseBatchItem.findMany({ where: { batchId: b2.id }, orderBy: { createdAt: "asc" } });
    expect(first.map((i) => [i.estUnitCost, i.qty])).toEqual([[350, 3], [420, 4]]);
    expect(second.map((i) => [i.estUnitCost, i.qty])).toEqual([[380, 1], [450, 6]]);
    expect(first[0].productId).toBe(second[0].productId);
    // 修改第二團不影響第一團
    await tx((t) => updateBatchItem(t, actor, second[0].id, { qty: 5, unitCost: 400 }));
    const f0 = await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: first[0].id } });
    expect([f0.estUnitCost, f0.qty]).toEqual([350, 3]);
    // 跨團彙總：待到貨 = 3 + 5
    const inv = (await tx((t) => inventorySummary(t, [first[0].productId]))).get(first[0].productId)!;
    expect(inv.incoming).toBe(8);
  });

  it("6. 修改商品參考價或預設匯率不會改寫既有採購價格", async () => {
    await add([row("a", { characterId: ctx.chiikawa, unitCost: 1650, currency: "JPY", qty: 2, salePriceTwd: 450 })]);
    const item = await prisma.purchaseBatchItem.findFirstOrThrow({ include: { product: true } });
    expect(item.product.salePriceTwd).toBe(450);
    expect(item.product.officialPriceJpy).toBe(1650);
    await tx((t) => updateProduct(t, actor, item.productId, { name: item.product.name, status: "PREORDER", salePriceTwd: 999, officialPriceJpy: 2000 }));
    const after = await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([after.estUnitCost, after.salePriceTwd, after.currency]).toEqual([1650, 450, "JPY"]);
    const lc = (await tx((t) => landedCosts(t, [item.id]))).get(item.id)!;
    expect(lc.goodsTwd).toBe(693); // 1650 × 2 × 0.21，使用採購團鎖定匯率
    // 實際單價填寫後，成本改用實際單價
    await tx((t) => updateBatchItem(t, actor, item.id, { actualUnitCost: 1500 }));
    const lc2 = (await tx((t) => landedCosts(t, [item.id]))).get(item.id)!;
    expect([lc2.goodsTwd, lc2.estimated]).toEqual([630, false]);
    // 既有商品再次批次新增時，主檔價格不被改寫
    const b2 = await tx((t) => createBatch(t, actor, { name: "第二團", rate: "0.2" }));
    await add([row("a", { characterId: ctx.chiikawa, unitCost: 1800, currency: "JPY", qty: 1, salePriceTwd: 500 })], "sub-2", b2.id);
    const p = await prisma.product.findUniqueOrThrow({ where: { id: item.productId } });
    expect([p.salePriceTwd, p.officialPriceJpy]).toEqual([999, 2000]);
  });

  it("7. 批次新增不會增加現貨庫存，到貨登記後才會", async () => {
    const r = await add([row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 3 })]);
    const pid = r.results[0].productId!;
    let inv = (await tx((t) => inventorySummary(t, [pid]))).get(pid)!;
    expect([inv.onHand, inv.available, inv.incoming]).toEqual([0, 0, 3]);
    expect(await prisma.inventoryMovement.count()).toBe(0);
    await tx((t) => receiveStock(t, actor, { productId: pid, qty: 2, batchItemId: r.results[0].itemId! }));
    inv = (await tx((t) => inventorySummary(t, [pid]))).get(pid)!;
    expect([inv.onHand, inv.incoming]).toEqual([2, 1]);
  });
});

describe("8. 修改數量不得破壞買家訂單、保留與出貨", () => {
  it("數量不能低於已到貨＋只能靠這批到貨的買家需求；不能刪除有依賴的品項", async () => {
    const r = await add([row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 5 })]);
    const pid = r.results[0].productId!;
    const itemId = r.results[0].itemId!;
    await prisma.product.update({ where: { id: pid }, data: { salePriceTwd: 500 } });
    // 買家訂 3 件，已向供應商下單
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: pid, qty: 3 }] }));
    await tx((t) => updateItem(t, actor, o.items[0].id, { purchaseFlag: "ORDERED" }));
    expect((await tx((t) => minCommittedQty(t, itemId))).min).toBe(3);
    await expect(tx((t) => updateBatchItem(t, actor, itemId, { qty: 2 }))).rejects.toThrow("不能少於 3");
    await tx((t) => updateBatchItem(t, actor, itemId, { qty: 3 }));
    await expect(tx((t) => deleteBatchItem(t, actor, itemId))).rejects.toThrow("不能刪除");

    // 到貨 2 件、保留並出貨 1 件
    await tx((t) => receiveStock(t, actor, { productId: pid, qty: 2, batchItemId: itemId }));
    await tx((t) => reserveForItem(t, actor, { orderItemId: o.items[0].id, qty: 2 }));
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: o.items[0].id, qty: 1 }] }));
    // 已到貨 2；剩 1 件未到且只能靠這批 → 最少 3
    expect((await tx((t) => minCommittedQty(t, itemId))).min).toBe(3);
    const res = await bulkUpdateBatchItems(actor, ctx.batchId, [{ itemId, qty: 2 }]);
    expect(res.ok).toBe(false);
    expect(res.errors[0].error).toContain("不能少於 3");
    // 失敗時不寫入任何變更
    const it = await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(it.qty).toBe(3);
    // 訂單、保留、出貨紀錄維持不變
    const oi = await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0].id } });
    expect([oi.shippedQtyCache, oi.reservedQtyCache]).toEqual([1, 1]);
    // 另一團也採購了這個商品後，第一團的未到數量才能減少
    const b2 = await tx((t) => createBatch(t, actor, { name: "補貨團", rate: "0.2" }));
    await add([row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 1 })], "sub-b2", b2.id);
    const ok = await bulkUpdateBatchItems(actor, ctx.batchId, [{ itemId, qty: 2, unitCost: 340 }]);
    expect(ok.ok).toBe(true);
    const it2 = await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: itemId } });
    expect([it2.qty, it2.estUnitCost]).toEqual([2, 340]);
  });

  it("批次修改：一列不合法時整批都不寫入", async () => {
    const r = await add([row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 2 }), row("b", { characterId: ctx.hachi, unitCost: 350, qty: 2 })]);
    const [a, b] = r.results.map((x) => x.itemId!);
    await tx((t) => receiveStock(t, actor, { productId: r.results[1].productId!, qty: 2, batchItemId: b }));
    const res = await bulkUpdateBatchItems(actor, ctx.batchId, [{ itemId: a, qty: 5 }, { itemId: b, qty: 1 }]);
    expect(res.ok).toBe(false);
    expect((await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: a } })).qty).toBe(2);
  });
});

describe("系列名單與範本", () => {
  it("從其他系列複製名單、儲存範本、刪除沒有依賴的品項", async () => {
    const other = await tx((t) => saveSeries(t, actor, null, { name: "吉伊卡哇 2" }));
    const added = await tx((t) => copySeriesRoster(t, actor, ctx.seriesId, other.id));
    expect(added).toHaveLength(3);
    const tpl = await tx((t) => saveTemplate(t, actor, { seriesId: ctx.seriesId, name: "三本柱", productTypeId: ctx.typeId, items: [{ characterId: ctx.chiikawa }, { characterId: ctx.hachi }, { characterId: ctx.usagi }] }));
    expect((tpl.items as unknown[]).length).toBe(3);
    // 複製名單不會複製任何交易
    expect(await prisma.purchaseBatchItem.count()).toBe(0);
    const r = await add([row("a", { characterId: ctx.chiikawa, unitCost: 350, qty: 1 })]);
    await tx((t) => deleteBatchItem(t, actor, r.results[0].itemId!));
    expect(await prisma.purchaseBatchItem.count()).toBe(0);
  });
});
