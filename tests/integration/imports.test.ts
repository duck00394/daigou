import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkIntegrity } from "@/server/services/integrity";
import * as XLSX from "@e965/xlsx";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { stageLine, stageExcel, inspectWorkbook, rematchBatch } from "@/server/imports/stage";
import { bulkUpdateRows, commitBatch, updateRowResolution } from "@/server/imports/engine";
import { createProduct } from "@/server/services/catalog";
import { addBuyerTag, saveTag } from "@/server/services/buyers";
import { createOrder } from "@/server/services/orders";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});

const rowsOf = (batchId: string) => prisma.importRow.findMany({ where: { batchId }, orderBy: [{ rowNo: "asc" }, { seq: "asc" }] });


// 每項測試結束後交叉核對：庫存、訂單快取、到貨、費用分攤、出貨都要和流水一致
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

describe("LINE 貼上加單", () => {
  const text = `小美 吉伊吊娃 2、小八 S 娃 1

阿婷 兔兔扭蛋 3

小王 +1 吉伊娃娃

小林
吉伊 2`;

  it("預覽不寫入正式訂單；確定的列自動配對，不確定的列待確認", async () => {
    const batch = await stageLine(actor, { text, idempotencyKey: "k-1" });
    expect(await prisma.order.count()).toBe(0);
    const rows = await rowsOf(batch.id);
    expect(rows).toHaveLength(5);
    const byText = (t: string) => rows.find((r) => (r.parsed as { productText: string }).productText === t)!;
    expect(byText("吉伊吊娃").status).toBe("READY");
    expect((byText("吉伊吊娃").resolution as { buyerId: string }).buyerId).toBe(s.b1.id);
    expect(byText("吉伊娃娃").status).toBe("READY"); // 商品別名
    const kobayashi = byText("吉伊");
    expect(kobayashi.status).toBe("PENDING_REVIEW"); // 小林不存在、「吉伊」不是完整商品名
    const msgs = (kobayashi.messages as { text: string }[]).map((m) => m.text).join("|");
    expect(msgs).toContain("買家「小林」待確認");
    expect(msgs).toContain("商品「吉伊」待確認");
    // 候選商品
    const cands = (kobayashi.parsed as { candidates: { products: { name: string }[] } }).candidates.products.map((p) => p.name);
    expect(cands).toContain("吉伊吊娃");
    expect(kobayashi.rowNo).toBe(7);
  });

  it("確認後建立訂單；待確認的列跳過；連點兩次不會重複", async () => {
    const batch = await stageLine(actor, { text, idempotencyKey: "k-2", groupBuyId: s.gb.id });
    const again = await stageLine(actor, { text, idempotencyKey: "k-2" });
    expect(again.id).toBe(batch.id);
    const [r1, r2] = await Promise.allSettled([commitBatch(actor, batch.id), commitBatch(actor, batch.id)]);
    const ok = [r1, r2].filter((r) => r.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const orders = await prisma.order.findMany({ include: { items: true } });
    expect(orders).toHaveLength(3); // 小美、阿婷、小王
    const mei = orders.find((o) => o.buyerId === s.b1.id)!;
    expect(mei.items).toHaveLength(2);
    expect(mei.source).toBe("LINE");
    expect(mei.rawInput).toContain("小美 吉伊吊娃 2");
    const b = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(b.status).toBe("PARTIAL"); // 小林那筆還沒處理
    // 再次送出不會重複建立
    const third = await commitBatch(actor, batch.id);
    expect(third.rowsCommitted).toBe(0);
    expect(await prisma.order.count()).toBe(3);
  });

  it("人工選擇新買家、配對商品並記住別名後即可建立；重新貼上同內容時提示可能重複", async () => {
    const batch = await stageLine(actor, { text: "小林\n吉伊 2", idempotencyKey: "k-3" });
    const [row] = await rowsOf(batch.id);
    await updateRowResolution(batch.id, row.id, { newBuyerName: "小林", productId: s.p1.id, saveProductAlias: true, saveBuyerAlias: false });
    const fresh = await prisma.importRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(fresh.status).toBe("READY");
    const sum = await commitBatch(actor, batch.id);
    expect(sum).toMatchObject({ ordersCreated: 1, buyersCreated: 1, rowsCommitted: 1 });
    expect(await prisma.productAlias.count({ where: { alias: "吉伊" } })).toBe(1);

    // 同樣內容再貼一次：別名已記住，買家已存在，但標示可能重複
    const b2 = await stageLine(actor, { text: "小林\n吉伊 2", idempotencyKey: "k-4" });
    const [r2] = await rowsOf(b2.id);
    expect(r2.status).toBe("DUPLICATE_SUSPECT");
    const s2 = await commitBatch(actor, b2.id);
    expect(s2.rowsCommitted).toBe(0);
    await updateRowResolution(b2.id, r2.id, { forceDuplicate: true });
    const s3 = await commitBatch(actor, b2.id);
    expect(s3.rowsCommitted).toBe(1);
    expect(await prisma.buyer.count({ where: { name: "小林" } })).toBe(1);
  });

  it("追加到原訂單：原明細不變，新增明細標記追加", async () => {
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }] }));
    const batch = await stageLine(actor, { text: "小美再加小八 S 娃 1", idempotencyKey: "k-5" });
    const [row] = await rowsOf(batch.id);
    expect((row.parsed as { append: boolean }).append).toBe(true);
    await updateRowResolution(batch.id, row.id, { appendMode: "APPEND", appendOrderId: o.id });
    const sum = await commitBatch(actor, batch.id);
    expect(sum.ordersAppended).toBe(1);
    const items = await prisma.orderItem.findMany({ where: { orderId: o.id }, orderBy: { createdAt: "asc" } });
    expect(items.map((i) => [i.productNameSnapshot, i.qty, i.addedLater])).toEqual([
      ["吉伊吊娃", 1, false],
      ["小八 S 娃", 1, true],
    ]);
  });

  it("一筆建立失敗不影響其他筆；失敗的列可修正後重試", async () => {
    const batch = await stageLine(actor, { text: "小美 吉伊吊娃 1\n阿婷 兔兔扭蛋 1", idempotencyKey: "k-6" });
    // 建立前把兔兔扭蛋封存，模擬中途失敗
    await prisma.product.update({ where: { id: s.p3.id }, data: { archivedAt: new Date() } });
    const rows = await rowsOf(batch.id);
    // 直接把列狀態設為 READY，讓它進入建立階段（模擬驗證後資料被改變）
    await prisma.importRow.update({ where: { id: rows[1].id }, data: { status: "READY" } });
    const sum = await commitBatch(actor, batch.id);
    expect(sum.rowsCommitted).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    const failed = await prisma.importRow.findUniqueOrThrow({ where: { id: rows[1].id } });
    expect(["ERROR", "FAILED"]).toContain(failed.status);
    await prisma.product.update({ where: { id: s.p3.id }, data: { archivedAt: null } });
    await updateRowResolution(batch.id, rows[1].id, {});
    const retry = await commitBatch(actor, batch.id);
    expect(retry.rowsCommitted).toBe(1);
    expect(await prisma.order.count()).toBe(2);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("COMMITTED");
  });

  it("「建議不接」標籤只提醒，不阻擋建立", async () => {
    const tag = await tx((t) => saveTag(t, actor, null, { name: "建議不接", kind: "RISK", warnOnOrder: true }));
    await tx((t) => addBuyerTag(t, actor, { buyerId: s.b2.id, tagId: tag.id, reason: "上次棄單" }));
    const batch = await stageLine(actor, { text: "阿婷 兔兔扭蛋 1", idempotencyKey: "k-7" });
    const [row] = await rowsOf(batch.id);
    expect((row.messages as { text: string }[]).some((m) => m.text.includes("建議不接"))).toBe(true);
    expect(row.status).toBe("READY");
    await commitBatch(actor, batch.id);
    expect(await prisma.order.count({ where: { buyerId: s.b2.id } })).toBe(1);
  });

  it("新增商品後重新比對，待確認的列自動配對", async () => {
    const batch = await stageLine(actor, { text: "小美 吉伊一番賞 1", idempotencyKey: "k-8" });
    expect((await rowsOf(batch.id))[0].status).toBe("PENDING_REVIEW");
    await tx((t) => createProduct(t, actor, { name: "吉伊一番賞", salePriceTwd: 350 }));
    await rematchBatch(batch.id);
    expect((await rowsOf(batch.id))[0].status).toBe("READY");
  });
});

function makeXlsx(rows: unknown[][], sheet = "訂單"): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("Excel 匯入", () => {
  const data = [
    ["說明：10 月訂單"],
    ["訂單編號", "日期", "商品", "數量", "單價", "姓名", "備註", "已付金額"],
    ["A001", "2026/10/01", "吉伊吊娃", 2, 500, "小美", "急", 1000],
    ["A001", "2026/10/01", "小八 S 娃", 1, 300, "小美", "", ""],
    ["A002", "2026/10/02", "兔兔扭蛋", "三", 150, "阿婷", "", ""],
    ["A003", "2026/10/02", "不存在的商品", 1, 100, "小王", "", ""],
    [],
    ["A004", "2026/10/03", "吉伊吊娃", 1, 500, "新客人", "", ""],
  ];

  it("自動找表頭、欄位順序不同也能配對；錯誤定位到原始列號", async () => {
    const buf = makeXlsx(data);
    const sheets = inspectWorkbook("orders.xlsx", buf);
    expect(sheets[0].headerRowIndex).toBe(1);
    expect(sheets[0].missing).toEqual([]);
    expect(sheets[0].mapping).toMatchObject({ externalRef: 0, orderDate: 1, productName: 2, qty: 3, unitPrice: 4, buyerName: 5, notes: 6, paidAmount: 7 });
    const batch = await stageExcel(actor, { fileName: "orders.xlsx", buf, sheetName: "訂單", mapping: sheets[0].mapping, idempotencyKey: "x-1" });
    expect(await prisma.order.count()).toBe(0);
    const rows = await rowsOf(batch.id);
    expect(rows.map((r) => r.rowNo)).toEqual([3, 4, 5, 6, 8]); // 空白列略過，列號為 Excel 原始列號
    expect(rows.map((r) => r.status)).toEqual(["READY", "READY", "ERROR", "PENDING_REVIEW", "PENDING_REVIEW"]);
    expect((rows[2].messages as { text: string }[])[0].text).toContain("數量「三」");
    expect((rows[0].raw as { cells: Record<string, string> }).cells["商品"]).toBe("吉伊吊娃");
  });

  it("匯入後依來源訂單編號合併成一張訂單、建立付款；同一份檔案再匯入會被擋下", async () => {
    const buf = makeXlsx(data);
    const map = inspectWorkbook("orders.xlsx", buf)[0].mapping;
    const batch = await stageExcel(actor, { fileName: "orders.xlsx", buf, sheetName: "訂單", mapping: map, idempotencyKey: "x-2" });
    const rows = await rowsOf(batch.id);
    await updateRowResolution(batch.id, rows[4].id, { newBuyerName: "新客人" });
    await bulkUpdateRows(batch.id, [rows[3].id], { exclude: true });
    const sum = await commitBatch(actor, batch.id);
    expect(sum).toMatchObject({ ordersCreated: 2, rowsCommitted: 3, buyersCreated: 1 });
    const a001 = await prisma.order.findFirstOrThrow({ where: { externalRef: "A001" }, include: { items: true } });
    expect(a001.items).toHaveLength(2);
    expect(a001.paidCache).toBe(1000);
    expect(a001.orderedAt.toISOString()).toBe("2026-09-30T16:00:00.000Z"); // 台灣 10/1 00:00
    expect(a001.source).toBe("EXCEL");

    const again = await stageExcel(actor, { fileName: "orders.xlsx", buf, sheetName: "訂單", mapping: map, idempotencyKey: "x-3" });
    const r2 = await rowsOf(again.id);
    expect(r2[0].status).toBe("ERROR");
    expect((r2[0].messages as { text: string }[]).map((m) => m.text).join()).toContain("已經匯入過");
    const s2 = await commitBatch(actor, again.id);
    expect(s2.rowsCommitted).toBe(0);
    expect(await prisma.order.count()).toBe(2);
  });

  it("CSV（Big5 與 UTF-8）與中文字元正確", async () => {
    const csv = "姓名,商品名稱,數量,單價\n小美,吉伊吊娃,1,\"1,200\"\n";
    const utf8 = new TextEncoder().encode("﻿" + csv);
    const s1 = inspectWorkbook("a.csv", utf8);
    const b1 = await stageExcel(actor, { fileName: "a.csv", buf: utf8, sheetName: s1[0].name, mapping: s1[0].mapping, idempotencyKey: "c-1" });
    const [row] = await rowsOf(b1.id);
    expect((row.resolution as { unitPrice: number }).unitPrice).toBe(1200);
    expect((row.parsed as { buyerText: string }).buyerText).toBe("小美");
    // Big5 編碼的「姓名,商品,數量 / 小美,A,1」
    const big5 = new Uint8Array([0xa9, 0x6d, 0xa6, 0x57, 0x2c, 0xb0, 0xd3, 0xab, 0x7e, 0x2c, 0xbc, 0xc6, 0xb6, 0x71, 0x0a, 0xa4, 0x70, 0xac, 0xfc, 0x2c, 0x41, 0x2c, 0x31, 0x0a]);
    const s2 = inspectWorkbook("b.csv", big5);
    expect(s2[0].headers).toEqual(["姓名", "商品", "數量"]);
  });

  it("拒絕偽裝的檔案與缺少必要欄位", async () => {
    expect(() => inspectWorkbook("x.xlsx", new TextEncoder().encode("hello"))).toThrow("不是有效的 .xlsx");
    expect(() => inspectWorkbook("x.exe", new Uint8Array([1, 2, 3]))).toThrow("只支援");
    const buf = makeXlsx([["商品", "數量"], ["吉伊吊娃", 1]]);
    const sh = inspectWorkbook("m.xlsx", buf);
    expect(sh[0].missing).toContain("買家姓名或 LINE 暱稱");
    await expect(stageExcel(actor, { fileName: "m.xlsx", buf, sheetName: sh[0].name, mapping: sh[0].mapping, idempotencyKey: "m-1" })).rejects.toThrow("缺少必要欄位");
  });

  it("大量資料（3000 列）可以建立預覽", async () => {
    const big: unknown[][] = [["姓名", "商品", "數量"]];
    for (let i = 0; i < 3000; i++) big.push([i % 2 ? "小美" : "阿婷", i % 3 ? "吉伊吊娃" : "兔兔扭蛋", (i % 4) + 1]);
    const buf = makeXlsx(big);
    const sh = inspectWorkbook("big.xlsx", buf);
    const t0 = Date.now();
    const batch = await stageExcel(actor, { fileName: "big.xlsx", buf, sheetName: sh[0].name, mapping: sh[0].mapping, idempotencyKey: "big-1" });
    expect(Date.now() - t0).toBeLessThan(25000);
    expect(await prisma.importRow.count({ where: { batchId: batch.id } })).toBe(3000);
  }, 60000);
});
