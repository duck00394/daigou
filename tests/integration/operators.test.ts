import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators, listOperators, responsibilityDefaults, saveOperator, updateBatchResponsibility } from "@/server/services/operators";
import { addSupplierPayment, updateSupplierPayment, voidSupplierPayment, type SupplierPaymentInput } from "@/server/services/supplier-payments";
import { createReceivingRecord } from "@/server/services/receiving";
import { listReceivingRecords, listSupplierPayments, operatorReport, UNASSIGNED } from "@/server/services/operator-report";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { inventorySummary } from "@/server/services/inventory";
import { createOrder } from "@/server/services/orders";
import { saveSupplier } from "@/server/services/series";

let s: Awaited<ReturnType<typeof seedBasics>>;
const A = "op_a";
const B = "op_b";
let supplierId: string;
let batchId: string;
let item1: string;
let item2: string;

beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx(async (t) => {
    await ensureDefaultOperators(t);
    const sp = await saveSupplier(t, actor, null, { name: "日本官網", defaultCurrency: "JPY" });
    supplierId = sp.id;
    const b = await createBatch(t, actor, { name: "10 月第一團", supplierId, rate: "0.21", orderedById: A, paymentResponsibleById: A, receivingResponsibleById: B });
    batchId = b.id;
    item1 = (await addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 5, unitCost: 1650 })).id;
    item2 = (await addBatchItem(t, actor, b.id, { productId: s.p2.id, qty: 4, unitCost: 990 })).id;
  });
});

const pay = (o: Partial<SupplierPaymentInput>) =>
  tx((t) => addSupplierPayment(t, actor, { batchId, paidById: A, paidAt: new Date("2026-10-10T03:00:00Z"), amount: 1000, currency: "JPY", ...o }));

describe("經營者設定", () => {
  it("預設有 A、B 兩位，可新增第三位，停用後不能再被新指定", async () => {
    const ops = await tx((t) => listOperators(t));
    expect(ops.map((o) => o.code)).toEqual(["A", "B"]);
    const c = await tx((t) => saveOperator(t, actor, null, { code: "c", name: "小幫手" }));
    expect(c.code).toBe("C");
    await tx((t) => saveOperator(t, actor, c.id, { name: "小幫手", active: false }));
    await expect(tx((t) => updateBatchResponsibility(t, actor, batchId, { orderedById: c.id }))).rejects.toThrow("已停用");
    await expect(tx((t) => saveOperator(t, actor, B, { name: "經營者 A" }))).rejects.toThrow("已經有名為");
  });

  it("修改經營者名稱後，歷史紀錄仍歸屬同一人", async () => {
    await pay({ paidById: A, amount: 3000 });
    await tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: B, lines: [{ batchItemId: item1, receivedQty: 2 }] }));
    await tx((t) => saveOperator(t, actor, A, { name: "阿珍" }));
    await tx((t) => saveOperator(t, actor, B, { name: "阿強" }));
    // 交換顯示名稱的極端情況：仍以 id 為準
    await tx((t) => saveOperator(t, actor, A, { name: "暫時名" }));
    await tx((t) => saveOperator(t, actor, B, { name: "阿珍" }));
    await tx((t) => saveOperator(t, actor, A, { name: "阿強" }));

    const b = await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: batchId }, include: { orderedBy: true, receivingResponsibleBy: true } });
    expect(b.orderedById).toBe(A);
    expect(b.orderedBy?.name).toBe("阿強");
    const r = await tx((t) => operatorReport(t, {}));
    const ra = r.rows.find((x) => x.key === A)!;
    const rb = r.rows.find((x) => x.key === B)!;
    expect(ra.name).toBe("阿強");
    expect(ra.payments.JPY.paidAmount).toBe(3000);
    expect(ra.receiving.records).toBe(0);
    expect(rb.receiving.receivedQty).toBe(2);
    expect(rb.payments.JPY).toBeUndefined();
    const logs = await prisma.auditLog.findMany({ where: { entity: "Operator", entityId: A }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => (l.data as { after: { name: string } }).after.name)).toEqual(["阿珍", "暫時名", "阿強"]);
  });
});

describe("採購團負責人", () => {
  it("A 下單、B 付款：主要付款負責人與實際付款人分開記錄", async () => {
    const res = await pay({ paidById: B, amount: 12210, purpose: "FULL" });
    expect(res.duplicated).toBe(false);
    const b = await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(b.orderedById).toBe(A);
    expect(b.paymentResponsibleById).toBe(A); // 負責安排付款的人
    const p = await prisma.supplierPayment.findFirstOrThrow({ where: { batchId } });
    expect(p.paidById).toBe(B); // 實際付錢的人
    const r = await tx((t) => operatorReport(t, {}));
    expect(r.rows.find((x) => x.key === A)!.batches).toEqual({ ordered: 1, paymentResponsible: 1, receivingResponsible: 0 });
    expect(r.rows.find((x) => x.key === B)!.batches).toEqual({ ordered: 0, paymentResponsible: 0, receivingResponsible: 1 });
    expect(r.rows.find((x) => x.key === A)!.payments.JPY).toBeUndefined();
    expect(r.rows.find((x) => x.key === B)!.payments.JPY.paidAmount).toBe(12210);
  });

  it("事後修改負責人會留下修改前後紀錄；可改回未指定", async () => {
    await tx((t) => updateBatchResponsibility(t, actor, batchId, { paymentResponsibleById: B, responsibilityNote: "B 這次用自己的卡" }));
    await tx((t) => updateBatchResponsibility(t, actor, batchId, { receivingResponsibleById: null }));
    const b = await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect([b.orderedById, b.paymentResponsibleById, b.receivingResponsibleById]).toEqual([A, B, null]);
    const logs = await prisma.auditLog.findMany({ where: { action: "batch.responsibility" }, orderBy: { createdAt: "asc" } });
    expect(logs[0].data).toMatchObject({ before: { paymentResponsibleById: A }, after: { paymentResponsibleById: B } });
    expect(logs[1].data).toMatchObject({ before: { receivingResponsibleById: B }, after: { receivingResponsibleById: null } });
    const r = await tx((t) => operatorReport(t, { operatorId: UNASSIGNED }));
    expect(r.rows.find((x) => x.key === UNASSIGNED)!.batches.receivingResponsible).toBe(1);
  });

  it("從既有採購團帶入負責人只帶負責人，不複製付款與收貨紀錄", async () => {
    await pay({ paidById: B });
    await tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: B, lines: [{ batchItemId: item1, receivedQty: 1 }] }));
    const d = await tx((t) => responsibilityDefaults(t, batchId));
    expect(d).toMatchObject({ orderedById: A, paymentResponsibleById: A, receivingResponsibleById: B, supplierId });
    const nb = await tx((t) => createBatch(t, actor, { name: "第二團", supplierId, orderedById: d!.orderedById, paymentResponsibleById: d!.paymentResponsibleById, receivingResponsibleById: d!.receivingResponsibleById }));
    expect(await prisma.supplierPayment.count({ where: { batchId: nb.id } })).toBe(0);
    expect(await prisma.receivingRecord.count({ where: { batchId: nb.id } })).toBe(0);
  });

  it("經營者不會變成買家：買家訂單資料不受影響", async () => {
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 2 }] }));
    await pay({ paidById: A });
    await tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: A, lines: [{ batchItemId: item1, receivedQty: 2 }] }));
    const order = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(order.buyerId).toBe(s.b1.id);
    expect(order.items[0].qty).toBe(2);
    expect(await prisma.buyer.count({ where: { name: { in: ["經營者 A", "經營者 B"] } } })).toBe(0);
    expect(await prisma.payment.count()).toBe(0); // 供應商付款不會寫進買家收款
  });
});

describe("供應商付款紀錄", () => {
  it("A 付訂金、B 付尾款：兩筆分開保留，依人員彙總", async () => {
    await pay({ paidById: A, amount: 5000, purpose: "DEPOSIT", rate: "0.205" });
    await pay({ paidById: B, amount: 7210, purpose: "BALANCE" });
    await pay({ paidById: B, amount: 350, currency: "TWD", purpose: "FEE", method: "轉帳" });
    expect(await prisma.supplierPayment.count({ where: { batchId } })).toBe(2 + 1);
    const r = await tx((t) => operatorReport(t, {}));
    const ra = r.rows.find((x) => x.key === A)!;
    const rb = r.rows.find((x) => x.key === B)!;
    expect(ra.payments.JPY).toMatchObject({ paidAmount: 5000, paidCount: 1, ratedAmount: 5000, twdFromRated: 1025, unratedCount: 0 });
    expect(rb.payments.JPY).toMatchObject({ paidAmount: 7210, paidCount: 1, ratedAmount: 0, twdFromRated: 0, unratedCount: 1 });
    expect(rb.payments.TWD).toMatchObject({ paidAmount: 350, twdFromRated: 350 });
    // 不同幣別不混在一起
    expect(r.totals.JPY.paidAmount).toBe(12210);
    expect(r.totals.TWD.paidAmount).toBe(350);
    const list = await tx((t) => listSupplierPayments(t, { operatorId: B }, { currency: "JPY" }));
    expect(list.map((p) => p.amount)).toEqual([7210]);
  });

  it("重複送出同一個付款請求不會重複計帳；相同交易編號會被擋下", async () => {
    const [x, y] = await Promise.all([pay({ amount: 5000, dedupeKey: "k1" }), pay({ amount: 5000, dedupeKey: "k1" })].map((p) => p.catch((e: Error) => e)));
    const ok = [x, y].filter((v) => !(v instanceof Error));
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await pay({ amount: 5000, dedupeKey: "k1" });
    expect(again.duplicated).toBe(true);
    expect(await prisma.supplierPayment.count()).toBe(1);
    const r = await tx((t) => operatorReport(t, {}));
    expect(r.totals.JPY.paidAmount).toBe(5000);
    await pay({ amount: 100, reference: "TX-1" });
    await expect(pay({ amount: 100, reference: "TX-1" })).rejects.toThrow("可能是重複登記");
  });

  it("修改與作廢保留稽核紀錄；作廢後不計入、也不能再修改；待付款不算已付", async () => {
    const { payment } = await pay({ paidById: A, amount: 5000 });
    await tx((t) => updateSupplierPayment(t, actor, payment.id, { amount: 5500, paidById: B, reason: "金額打錯" }));
    const logs = await prisma.auditLog.findMany({ where: { entity: "SupplierPayment", entityId: payment.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["supplierPayment.create", "supplierPayment.update"]);
    expect(logs[1].data).toMatchObject({ before: { amount: 5000, paidById: A }, after: { amount: 5500, paidById: B }, reason: "金額打錯" });

    await expect(tx((t) => voidSupplierPayment(t, actor, payment.id, " "))).rejects.toThrow("作廢原因");
    await tx((t) => voidSupplierPayment(t, actor, payment.id, "重複登記"));
    const v = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(v.status).toBe("VOIDED");
    expect(v.amount).toBe(5500); // 原紀錄保留
    await expect(tx((t) => updateSupplierPayment(t, actor, payment.id, { amount: 1 }))).rejects.toThrow("已作廢");

    await pay({ paidById: A, amount: 800, status: "PENDING" });
    const r = await tx((t) => operatorReport(t, {}));
    expect(r.totals.JPY).toMatchObject({ paidAmount: 0, pendingAmount: 800, pendingCount: 1 });
  });

  it("金額、幣別、付款人檢查", async () => {
    await expect(pay({ amount: 0 })).rejects.toThrow("正整數");
    await expect(pay({ currency: "USD" as never })).rejects.toThrow("幣別");
    await expect(pay({ paidById: "nope" })).rejects.toThrow("找不到實際付款人");
    const p = await pay({ paidById: null, currency: "TWD", rate: "0.2" });
    expect(p.payment.rateMicro).toBeNull(); // 台幣不需要匯率
    const r = await tx((t) => operatorReport(t, {}));
    expect(r.rows.find((x) => x.key === UNASSIGNED)!.payments.TWD.paidAmount).toBe(1000);
  });
});

describe("收貨與清點", () => {
  it("A、B 分批收貨：每次記錄收貨確認人，良品才入庫", async () => {
    const r1 = await tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: A, receivedAt: new Date("2026-10-12T02:00:00Z"), lines: [{ batchItemId: item1, receivedQty: 3, defectQty: 1 }, { batchItemId: item2, receivedQty: 0, missingQty: 4, note: "這次沒到" }] }));
    expect(r1.record.lines).toHaveLength(2);
    const r2 = await tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: B, receivedAt: new Date("2026-10-14T02:00:00Z"), lines: [{ batchItemId: item1, receivedQty: 3 }, { batchItemId: item2, receivedQty: 4 }] }));
    expect(r2.record.receivedById).toBe(B);

    const inv = await tx((t) => inventorySummary(t, [s.p1.id, s.p2.id]));
    expect(inv.get(s.p1.id)!.onHand).toBe(2 + 3);
    expect(inv.get(s.p2.id)!.onHand).toBe(4);
    const mv = await prisma.inventoryMovement.findMany({ where: { kind: "RECEIVE" }, include: { receivingLine: { include: { record: true } } } });
    expect(mv.every((m) => m.receivingLine)).toBe(true);
    expect(mv.filter((m) => m.receivingLine!.record.receivedById === A).map((m) => m.onHandDelta)).toEqual([2]);
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("RECEIVED"); // 第一次 2 件良品＋第二次 3 件＝5 件到齊

    const rep = await tx((t) => operatorReport(t, {}));
    expect(rep.rows.find((x) => x.key === A)!.receiving).toEqual({ records: 1, batches: 1, receivedQty: 3, defectQty: 1, missingQty: 4, goodQty: 2 });
    expect(rep.rows.find((x) => x.key === B)!.receiving).toEqual({ records: 1, batches: 1, receivedQty: 7, defectQty: 0, missingQty: 0, goodQty: 7 });
    // 日期篩選
    const onlyLater = await tx((t) => operatorReport(t, { from: new Date("2026-10-13T00:00:00Z") }));
    expect(onlyLater.rows.find((x) => x.key === A)!.receiving.records).toBe(0);
    const recs = await tx((t) => listReceivingRecords(t, { operatorId: A }));
    expect(recs).toHaveLength(1);
  });

  it("收貨確認人必填、不能超收、瑕疵不能多於實收、重複送出不重複入庫", async () => {
    await expect(tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: "", lines: [{ batchItemId: item1, receivedQty: 1 }] }))).rejects.toThrow("收貨確認人");
    await expect(tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: A, lines: [{ batchItemId: item1, receivedQty: 6 }] }))).rejects.toThrow("超過採購未到數量");
    await expect(tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: A, lines: [{ batchItemId: item1, receivedQty: 1, defectQty: 2 }] }))).rejects.toThrow("瑕疵");
    await expect(tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: A, lines: [{ batchItemId: item1, receivedQty: 0 }] }))).rejects.toThrow("至少填寫");
    const input = { batchId, receivedById: A, dedupeKey: "r1", lines: [{ batchItemId: item1, receivedQty: 2 }] };
    await Promise.all([tx((t) => createReceivingRecord(t, actor, input)), tx((t) => createReceivingRecord(t, actor, input))].map((p) => p.catch(() => null)));
    const again = await tx((t) => createReceivingRecord(t, actor, input));
    expect(again.duplicated).toBe(true);
    expect(await prisma.receivingRecord.count()).toBe(1);
    expect((await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id)!.onHand).toBe(2);
    expect(await prisma.inventoryMovement.count({ where: { kind: "RECEIVE" } })).toBe(1);
  });

  it("依供應商、採購團篩選", async () => {
    const other = await tx(async (t) => {
      const b2 = await createBatch(t, actor, { name: "樂天團", supplier: "樂天", orderedById: B });
      await addBatchItem(t, actor, b2.id, { productId: s.p3.id, qty: 2, unitCost: 400 });
      return b2;
    });
    await pay({ paidById: A, amount: 1000 });
    await tx((t) => addSupplierPayment(t, actor, { batchId: other.id, paidById: A, paidAt: new Date(), amount: 800, currency: "JPY" }));
    const bySupplier = await tx((t) => operatorReport(t, { supplierId }));
    expect(bySupplier.totals.JPY.paidAmount).toBe(1000);
    expect(bySupplier.rows.find((x) => x.key === B)!.batches.ordered).toBe(0);
    const byBatch = await tx((t) => operatorReport(t, { batchId: other.id }));
    expect(byBatch.totals.JPY.paidAmount).toBe(800);
    expect(byBatch.rows.find((x) => x.key === B)!.batches.ordered).toBe(1);
  });
});

describe("備份與還原", () => {
  it("經營者、付款、收貨紀錄可以完整還原；舊版備份（沒有這些資料表）仍可還原", async () => {
    const { createBackup, restoreBackup } = await import("@/server/services/backup");
    const { resetDb } = await import("../helpers");
    await tx((t) => saveOperator(t, actor, A, { name: "阿珍" }));
    await pay({ paidById: B, amount: 4321, dedupeKey: "bk1" });
    await tx((t) => createReceivingRecord(t, actor, { batchId, receivedById: A, lines: [{ batchItemId: item1, receivedQty: 2, defectQty: 1 }] }));
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    await resetDb();
    await restoreBackup(actor, backup, { wipe: false });
    expect((await prisma.operator.findUniqueOrThrow({ where: { id: A } })).name).toBe("阿珍");
    expect((await prisma.supplierPayment.findFirstOrThrow()).paidById).toBe(B);
    const mv = await prisma.inventoryMovement.findFirstOrThrow({ where: { kind: "RECEIVE" }, include: { receivingLine: { include: { record: true } } } });
    expect(mv.receivingLine?.record.receivedById).toBe(A);

    // 模擬舊版備份：拿掉新資料表並清掉關聯欄位，再重新計算檢查碼
    const { createHash } = await import("node:crypto");
    const old = JSON.parse(JSON.stringify(backup));
    for (const t of ["operator", "supplierPayment", "receivingRecord", "receivingLine"]) {
      delete old.data[t];
      delete old.counts[t];
    }
    old.data.purchaseBatch = old.data.purchaseBatch.map((b: Record<string, unknown>) => ({ ...b, orderedById: null, paymentResponsibleById: null, receivingResponsibleById: null }));
    old.data.inventoryMovement = old.data.inventoryMovement.map((m: Record<string, unknown>) => ({ ...m, receivingLineId: null }));
    old.checksum = createHash("sha256").update(JSON.stringify(old.data)).digest("hex");
    await restoreBackup(actor, old, { wipe: true });
    expect(await prisma.supplierPayment.count()).toBe(0);
    expect((await tx((t) => listOperators(t))).map((o) => o.code)).toEqual(["A", "B"]); // 預設經營者自動補回
  });
});
