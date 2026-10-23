import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb } from "../helpers";
import { saveCategory, upsertCharacter } from "@/server/services/catalog";
import { addCatalogCharacter, addCatalogItem, catalogTree, sellSheet, setCatalogPrice } from "@/server/services/catalog-tree";
import { sellToCustomer } from "@/server/services/sell";
import { receiveStock, inventorySummary } from "@/server/services/inventory";
import { saveSeries } from "@/server/services/series";
import { checkIntegrity } from "@/server/services/integrity";

async function setup() {
  await tx((t) => saveSeries(t, actor, null, { name: "吉伊卡哇" }));
  const nikuman = await tx((t) => saveCategory(t, actor, null, { name: "肉包", type: "CUSTOM", customType: "常設店" }));
  const it = await tx((t) => addCatalogItem(t, actor, { categoryId: nikuman.id, typeName: "吊娃", price: 650 }));
  const chii = await tx((t) => addCatalogCharacter(t, actor, { categoryId: nikuman.id, typeId: it.typeId, characterName: "吉伊" }));
  const hachi = await tx((t) => addCatalogCharacter(t, actor, { categoryId: nikuman.id, typeId: it.typeId, characterName: "小八" }));
  return { nikuman, typeId: it.typeId, chii, hachi };
}

describe("系列目錄、賣給客人", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("種類 › 系列 › 品項 › 角色；售價設一次，所有角色一起改", async () => {
    const s = await setup();
    expect(s.chii.name).toBe("肉包吉伊 吊娃");
    let tree = await catalogTree(prisma);
    expect(tree.map((k) => k.label)).toEqual(["常設店"]);
    const item = tree[0].series[0].items[0];
    expect([item.typeName, item.price, item.chars.map((c) => c.name)]).toEqual(["吊娃", 650, ["吉伊", "小八"]]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: s.hachi.productId } })).salePriceTwd).toBe(650);
    await tx((t) => setCatalogPrice(t, actor, { categoryId: s.nikuman.id, typeId: s.typeId, price: 700 }));
    expect((await prisma.product.findMany({ where: { id: { in: [s.chii.productId, s.hachi.productId] } } })).map((p) => p.salePriceTwd)).toEqual([700, 700]);
    // 同一角色再加一次不會變兩個商品
    const again = await tx((t) => addCatalogCharacter(t, actor, { categoryId: s.nikuman.id, typeId: s.typeId, characterName: "吉伊" }));
    expect(again.productId).toBe(s.chii.productId);
    tree = await catalogTree(prisma);
    expect(tree[0].series[0].items[0].chars).toHaveLength(2);
  });

  it("有現貨的直接賣，超過的記成預訂；沒填名字不能預訂；重送不會重複", async () => {
    const s = await setup();
    await tx((t) => receiveStock(t, actor, { productId: s.chii.productId, qty: 1, unitCostTwd: 400 }));
    const sheet = await tx((t) => sellSheet(t, s.nikuman.id));
    expect(sheet.items[0].rows.map((r) => [r.name, r.free, r.price])).toEqual([["吉伊", 1, 650], ["小八", 0, 650]]);
    const lines = [{ productId: s.chii.productId, qty: 2, unitPrice: 650 }, { productId: s.hachi.productId, qty: 1, unitPrice: 600 }];
    await expect(tx((t) => sellToCustomer(t, actor, { lines, idemKey: "sell-test-0001" }))).rejects.toThrow("客人名字");
    const r = await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", categoryId: s.nikuman.id, lines, idemKey: "sell-test-0002" }));
    expect(r).toMatchObject({ sold: 1, preordered: 2, total: 1900, duplicated: false });
    const r2 = await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", categoryId: s.nikuman.id, lines, idemKey: "sell-test-0002" }));
    expect(r2.duplicated).toBe(true);
    const inv = await tx((t) => inventorySummary(t, [s.chii.productId]));
    expect(inv.get(s.chii.productId)!.onHand).toBe(0);
    const orders = await prisma.order.findMany({ include: { items: true, buyer: true } });
    expect(orders.filter((o) => o.source === "QUICK").map((o) => o.items[0].qty)).toEqual([1]);
    const pre = orders.find((o) => o.source === "MANUAL")!;
    expect(pre.buyer.name).toBe("小美");
    expect(pre.items.map((i) => [i.productId === s.chii.productId ? "吉伊" : "小八", i.qty, i.unitPrice]).sort()).toEqual([["吉伊", 1, 650], ["小八", 1, 600]].sort());
    expect(await checkIntegrity(prisma)).toEqual([]);
  });
});

describe("種類改名、系列換種類", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("改種類名稱：底下所有系列一起改；系列可以換到別的種類", async () => {
    const { renameKind, moveSeriesKind } = await import("@/server/services/catalog-tree");
    const a = await tx((t) => saveCategory(t, actor, null, { name: "肉包", type: "CUSTOM", customType: "常設店" }));
    const b = await tx((t) => saveCategory(t, actor, null, { name: "便當", type: "CUSTOM", customType: "常設店" }));
    const c = await tx((t) => saveCategory(t, actor, null, { name: "萬聖節", type: "FESTIVAL" }));
    await tx((t) => renameKind(t, actor, "c:常設店", "常設商品"));
    let tree = await catalogTree(prisma);
    expect(tree.map((k) => [k.label, k.series.map((s) => s.name).sort()])).toEqual([["常設商品", ["便當", "肉包"].sort()], ["節慶", ["萬聖節"]]]);
    await tx((t) => renameKind(t, actor, "FESTIVAL", "萬聖節限定"));
    await tx((t) => moveSeriesKind(t, actor, b.id, { kindKey: "c:萬聖節限定" }));
    tree = await catalogTree(prisma);
    expect(tree.find((k) => k.label === "萬聖節限定")!.series.map((s) => s.id).sort()).toEqual([b.id, c.id].sort());
    await tx((t) => moveSeriesKind(t, actor, a.id, { newKind: "聯名" }));
    expect((await prisma.category.findUniqueOrThrow({ where: { id: a.id } })).customType).toBe("聯名");
  });
});

describe("系列目錄刪除", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("沒買過賣過的角色、品項、系列可以刪；有紀錄的擋下來", async () => {
    const { deleteCatalogCharacter, deleteCatalogItem, deleteSeries } = await import("@/server/services/catalog-tree");
    const s = await setup();
    await tx((t) => deleteCatalogCharacter(t, actor, { categoryId: s.nikuman.id, productId: s.hachi.productId }));
    expect(await prisma.product.findUnique({ where: { id: s.hachi.productId } })).toBeNull();
    // 吉伊收過貨：品項、系列都不能刪
    await tx((t) => receiveStock(t, actor, { productId: s.chii.productId, qty: 1, unitCostTwd: 400 }));
    await expect(tx((t) => deleteCatalogItem(t, actor, { categoryId: s.nikuman.id, typeId: s.typeId }))).rejects.toThrow("不能刪");
    await expect(tx((t) => deleteSeries(t, actor, s.nikuman.id))).rejects.toThrow("不能刪");
    // 新的空系列可以刪
    const empty = await tx((t) => saveCategory(t, actor, null, { name: "打錯的系列", type: "CUSTOM", customType: "常設店" }));
    const it2 = await tx((t) => addCatalogItem(t, actor, { categoryId: empty.id, typeName: "徽章", price: 180 }));
    await tx((t) => addCatalogCharacter(t, actor, { categoryId: empty.id, typeId: it2.typeId, characterName: "兔兔" }));
    await tx((t) => deleteSeries(t, actor, empty.id));
    expect(await prisma.category.findUnique({ where: { id: empty.id } })).toBeNull();
    expect(await prisma.product.count({ where: { name: { contains: "打錯的系列" } } })).toBe(0);
    expect(await checkIntegrity(prisma)).toEqual([]);
  });
});

describe("重複商品", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("系列目錄建的角色，之後採購選了別的 IP 也會用同一個商品；已經重複的會列出來可以合併", async () => {
    const { bulkAddSeriesItems } = await import("@/server/services/series");
    const { createBatch } = await import("@/server/services/purchase");
    const { duplicateGroups } = await import("@/server/services/merge");
    const { createProduct } = await import("@/server/services/catalog");
    const s = await setup(); // 吉伊卡哇 IP 下建了 肉包 吊娃 吉伊、小八
    const other = await tx((t) => saveSeries(t, actor, null, { name: "別的 IP" }));
    const b = await tx((t) => createBatch(t, actor, { name: "團", supplier: "代購", categoryId: s.nikuman.id }));
    const chii = await prisma.character.findUniqueOrThrow({ where: { name: "吉伊" } });
    const r = await bulkAddSeriesItems(actor, { batchId: b.id, seriesId: other.id, productTypeId: s.typeId, submissionKey: "dup-1", rows: [{ rowKey: "a", characterId: chii.id, unitCost: 400, currency: "TWD", qty: 1 }] });
    expect(r.results[0].productId).toBe(s.chii.productId);
    // 舊資料已經重複（名稱不一樣，但同系列、同品項、同角色）：合併工具找得到
    const momo = await tx((t) => upsertCharacter(t, actor, { name: "小桃" }));
    await tx((t) => createProduct(t, actor, { name: "肉包小桃 吊娃", productTypeId: s.typeId, characterIds: [momo.id], categoryIds: [s.nikuman.id] }));
    await tx((t) => createProduct(t, actor, { name: "小桃 吊娃", productTypeId: s.typeId, characterIds: [momo.id], categoryIds: [s.nikuman.id] }));
    const g = await tx((t) => duplicateGroups(t, s.nikuman.id));
    expect(g.map((x) => x.products.map((p) => p.name).sort())).toEqual([["小桃 吊娃", "肉包小桃 吊娃"].sort()]);
  });

  it("一位客人一次買兩個系列：預訂各自記在自己的系列", async () => {
    const s = await setup();
    const ghost = await tx((t) => saveCategory(t, actor, null, { name: "幽靈", type: "CUSTOM", customType: "常設店" }));
    const g = await tx((t) => addCatalogCharacter(t, actor, { categoryId: ghost.id, typeId: s.typeId, characterName: "吉伊" }));
    await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", idemKey: "multi-0001", lines: [{ productId: s.chii.productId, qty: 1, unitPrice: 650, categoryId: s.nikuman.id }, { productId: g.productId, qty: 2, unitPrice: 300, categoryId: ghost.id }] }));
    const items = await prisma.orderItem.findMany({ where: { order: { source: "MANUAL" } } });
    expect(items.map((i) => [i.categoryId === ghost.id ? "幽靈" : "肉包", i.qty]).sort()).toEqual([["幽靈", 2], ["肉包", 1]]);
  });
});
