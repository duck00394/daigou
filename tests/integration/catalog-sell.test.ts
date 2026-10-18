import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb } from "../helpers";
import { saveCategory } from "@/server/services/catalog";
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
