import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBuyerAlias, addBuyerTag, createBuyer, deleteTag, mergeBuyers, mergePreview, removeBuyerTag, saveTag } from "@/server/services/buyers";
import { loadLexicon, matchBuyer } from "@/server/services/matching";
import { createOrder, cancelItemQty } from "@/server/services/orders";
import { addPayment, createRefund } from "@/server/services/payments";
import { createShipment } from "@/server/services/shipping";
import { adjustStock } from "@/server/services/inventory";
import { createBackup, restoreBackup, verifyBackup } from "@/server/services/backup";
import { setArchived, saveCategory, setCategoryActive, createProduct } from "@/server/services/catalog";
import { toCsv } from "@/lib/csv";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});

describe("買家辨識與合併", () => {
  it("多個別名都能提示同一買家；相似名稱不會自動配對", async () => {
    const lex = await loadLexicon(prisma);
    expect(matchBuyer(lex, "美美")).toMatchObject({ status: "exact", match: { id: s.b1.id } });
    expect(matchBuyer(lex, "Mei 🐰")).toMatchObject({ status: "exact", match: { id: s.b1.id } });
    const near = matchBuyer(lex, "小美美");
    expect(near.status).toBe("none");
    expect(near.candidates.map((c) => c.id)).toContain(s.b1.id);
  });

  it("同名的兩位買家會被標示為有歧義", async () => {
    await tx((t) => createBuyer(t, actor, { name: "小美" }));
    const lex = await loadLexicon(prisma);
    const m = matchBuyer(lex, "小美");
    expect(m.status).toBe("ambiguous");
    expect(m.candidates.filter((c) => c.score === 1)).toHaveLength(2);
  });

  it("合併後訂單、付款、退款、標籤、別名都轉移到主要買家，並保留合併紀錄", async () => {
    const dup = await tx((t) => createBuyer(t, actor, { name: "美 (新帳號)", lineName: "mei_new", address: "台北市" }));
    const o = await tx((t) => createOrder(t, actor, { buyerId: dup.id, items: [{ productId: s.p1.id, qty: 2 }] }));
    await tx((t) => addPayment(t, actor, { orderId: o.id, amount: 1000 }));
    await tx((t) => cancelItemQty(t, actor, { orderItemId: o.items[0].id, qty: 1 }));
    await tx((t) => createRefund(t, actor, { orderId: o.id, amount: 500 }));
    const vip = await tx((t) => saveTag(t, actor, null, { name: "優良常客", kind: "POSITIVE" }));
    await tx((t) => addBuyerTag(t, actor, { buyerId: dup.id, tagId: vip.id }));
    await tx((t) => addBuyerTag(t, actor, { buyerId: s.b1.id, tagId: vip.id }));
    const pv = await tx((t) => mergePreview(t, dup.id, s.b1.id));
    expect(pv.counts).toMatchObject({ orders: 1, payments: 1, refunds: 1, tags: 1 });
    await tx((t) => mergeBuyers(t, actor, dup.id, s.b1.id));

    expect(await prisma.order.count({ where: { buyerId: s.b1.id } })).toBe(1);
    expect(await prisma.payment.count({ where: { order: { buyerId: s.b1.id } } })).toBe(1);
    expect(await prisma.refund.count({ where: { order: { buyerId: s.b1.id } } })).toBe(1);
    expect(await prisma.buyerIncident.count({ where: { buyerId: s.b1.id } })).toBe(1);
    const tags = await prisma.buyerTag.findMany({ where: { buyerId: s.b1.id } });
    expect(tags.filter((t) => !t.removedAt)).toHaveLength(1); // 相同標籤不重複
    expect(tags).toHaveLength(2); // 歷史保留
    const merged = await prisma.buyer.findUniqueOrThrow({ where: { id: dup.id } });
    expect(merged.mergedIntoId).toBe(s.b1.id);
    expect(await prisma.buyerMerge.count()).toBe(1);
    const target = await prisma.buyer.findUniqueOrThrow({ where: { id: s.b1.id }, include: { aliases: true } });
    expect(target.address).toBe("台北市");
    expect(target.aliases.map((a) => a.alias)).toEqual(expect.arrayContaining(["美美", "美 (新帳號)", "mei_new"]));
    // 合併後的買家不能再建立訂單
    await expect(tx((t) => createOrder(t, actor, { buyerId: dup.id, items: [{ productId: s.p1.id, qty: 1 }] }))).rejects.toThrow("已合併");
  });
});

describe("標籤", () => {
  it("多個標籤同時套用；停用後歷史仍可讀；有關聯時刪除需確認", async () => {
    const a = await tx((t) => saveTag(t, actor, null, { name: "可併單" }));
    const b = await tx((t) => saveTag(t, actor, null, { name: "急單", color: "#ff0000" }));
    await tx((t) => addBuyerTag(t, actor, { buyerId: s.b1.id, tagId: a.id, reason: "同住" }));
    const bt = await tx((t) => addBuyerTag(t, actor, { buyerId: s.b1.id, tagId: b.id }));
    await expect(tx((t) => addBuyerTag(t, actor, { buyerId: s.b1.id, tagId: a.id }))).rejects.toThrow("已經有");
    await tx((t) => saveTag(t, actor, a.id, { name: "可併單", active: false }));
    const rows = await prisma.buyerTag.findMany({ where: { buyerId: s.b1.id }, include: { tag: true } });
    expect(rows.map((r) => r.tag.name).sort()).toEqual(["可併單", "急單"]);
    await tx((t) => removeBuyerTag(t, actor, bt.id));
    expect((await prisma.buyerTag.findUniqueOrThrow({ where: { id: bt.id } })).removedAt).not.toBeNull();
    const first = await tx((t) => deleteTag(t, actor, a.id));
    expect(first).toEqual({ deleted: false, references: 1 });
    const forced = await tx((t) => deleteTag(t, actor, a.id, true));
    expect(forced.deleted).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "tag.delete" } })).toBe(1);
  });
});

describe("商品與分類", () => {
  it("封存商品後歷史訂單仍保有名稱，不能建立新訂單；分類可停用與重新啟用", async () => {
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p2.id, qty: 1 }] }));
    await tx((t) => setArchived(t, actor, s.p2.id, true));
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).productNameSnapshot).toBe("小八 S 娃");
    await expect(tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p2.id, qty: 1 }] }))).rejects.toThrow("已封存");
    const c = await tx((t) => saveCategory(t, actor, null, { name: "吉伊樂園", type: "CUSTOM", customType: "樂園" }));
    await tx((t) => setCategoryActive(t, actor, c.id, false));
    await tx((t) => setCategoryActive(t, actor, c.id, true));
    expect((await prisma.category.findUniqueOrThrow({ where: { id: c.id } })).active).toBe(true);
    await expect(tx((t) => saveCategory(t, actor, null, { name: "萬聖節" }))).rejects.toThrow("已存在");
  });

  it("商品別名不能同時指向兩個商品", async () => {
    await expect(tx((t) => createProduct(t, actor, { name: "其他娃娃", aliases: ["吉伊娃娃"] }))).rejects.toThrow("已經對應到商品「吉伊吊娃」");
  });
});

describe("CSV 匯出防公式注入", () => {
  it("以 = + - @ 開頭的內容會被跳脫", () => {
    const csv = toCsv([["名稱", "備註"], ["=HYPERLINK(\"x\")", "+1"], ["@SUM(A1)", "-2"], ["正常", "含,逗號"]]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'@SUM");
    expect(csv).toContain('"含,逗號"');
  });
});

describe("備份與還原", () => {
  it("完整備份可以還原到清空的資料庫，且資料一致", async () => {
    await tx((t) => adjustStock(t, actor, { productId: s.p1.id, delta: 3, reason: "期初", unitCostTwd: 300 }));
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, groupBuyId: s.gb.id, items: [{ productId: s.p1.id, qty: 2 }] }));
    await tx((t) => addPayment(t, actor, { orderId: o.id, amount: 1000 }));
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: o.items[0].id, qty: 1 }], autoReserve: true }));
    const dup = await tx((t) => createBuyer(t, actor, { name: "重複" }));
    await tx((t) => mergeBuyers(t, actor, dup.id, s.b2.id));
    await tx((t) => addBuyerAlias(t, actor, s.b3.id, "王王"));

    const backup = JSON.parse(JSON.stringify(await createBackup()));
    expect(() => verifyBackup(backup)).not.toThrow();
    const tampered = JSON.parse(JSON.stringify(backup));
    tampered.data.payment[0].amount = 999999;
    expect(() => verifyBackup(tampered)).toThrow("檢查碼不符");

    await expect(restoreBackup(actor, backup, { wipe: false })).rejects.toThrow("已有資料");
    await resetDb();
    await restoreBackup(actor, backup, { wipe: false });

    const restored = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(restored.paidCache).toBe(1000);
    expect(restored.items[0].shippedQtyCache).toBe(1);
    expect((await prisma.buyer.findUniqueOrThrow({ where: { id: dup.id } })).mergedIntoId).toBe(s.b2.id);
    expect(await prisma.inventoryMovement.count()).toBe(backup.counts.inventoryMovement);
    // 還原後流水號繼續遞增，不會撞號
    const next = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p2.id, qty: 1 }] }));
    expect(next.orderNo).not.toBe(o.orderNo);

    // 清空後還原（有資料時）
    const again = await restoreBackup(actor, backup, { wipe: true });
    expect(again.counts.order).toBe(1);
    expect(await prisma.order.count()).toBe(1);
  });
});
