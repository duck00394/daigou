// 付給供應商的實際付款紀錄（與買家付給我們的 Payment 完全分開）。
// 一個採購團可以有多筆付款，每筆記錄實際付款人；修改與作廢都保留稽核紀錄，不靜默覆寫。
import { BizError, isUniqueViolation, lockRows, type Tx } from "@/server/db";
import { parseRate } from "@/lib/money";
import { audit, emptyToNull, type Actor } from "./common";
import { checkOperator } from "./operators";

export type SupplierPaymentCurrency = "JPY" | "TWD";
export const PAYMENT_PURPOSES = ["DEPOSIT", "BALANCE", "FULL", "FEE", "OTHER"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export interface SupplierPaymentInput {
  batchId: string;
  paidById: string | null; // 實際付款人；null = 未指定
  paidAt: Date;
  amount: number;
  currency: SupplierPaymentCurrency;
  rate?: string | null; // 這筆付款實際使用的匯率（日幣才需要，選填）；沒有就不換算台幣
  method?: string | null;
  status?: "PENDING" | "PAID";
  reference?: string | null;
  purpose?: PaymentPurpose | null;
  note?: string | null;
  dedupeKey?: string | null;
}

function checkFields(input: Partial<SupplierPaymentInput>) {
  if (input.amount !== undefined && (!Number.isInteger(input.amount) || input.amount <= 0)) throw new BizError("付款金額必須是正整數");
  if (input.currency !== undefined && input.currency !== "JPY" && input.currency !== "TWD") throw new BizError("幣別只支援日幣（JPY）或台幣（TWD）");
  if (input.paidAt !== undefined && (!(input.paidAt instanceof Date) || Number.isNaN(input.paidAt.getTime()))) throw new BizError("請填寫付款日期");
  if (input.status !== undefined && input.status !== "PENDING" && input.status !== "PAID") throw new BizError("付款狀態不正確");
  if (input.purpose && !PAYMENT_PURPOSES.includes(input.purpose)) throw new BizError("付款用途不正確");
}

function rateFor(currency: SupplierPaymentCurrency, rate: string | null | undefined): number | null {
  if (currency === "TWD" || !rate?.trim()) return null;
  try {
    return parseRate(rate);
  } catch (e) {
    throw new BizError((e as Error).message);
  }
}

async function checkReference(t: Tx, batchId: string, reference: string | null, exceptId?: string) {
  if (!reference) return;
  const dup = await t.supplierPayment.findFirst({ where: { batchId, reference, status: { not: "VOIDED" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw new BizError(`這個採購團已有交易參考編號「${reference}」的付款紀錄，可能是重複登記`);
}

export async function addSupplierPayment(t: Tx, actor: Actor, input: SupplierPaymentInput) {
  if (input.dedupeKey) {
    const dup = await t.supplierPayment.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (dup) return { payment: dup, duplicated: true };
  }
  checkFields(input);
  if (!input.paidAt) throw new BizError("請填寫付款日期");
  await lockRows(t, "PurchaseBatch", [input.batchId]);
  const batch = await t.purchaseBatch.findUnique({ where: { id: input.batchId } });
  if (!batch) throw new BizError("找不到採購團");
  // 鎖定後再查一次，避免兩個同時送出的相同請求都通過
  if (input.dedupeKey) {
    const dup = await t.supplierPayment.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (dup) return { payment: dup, duplicated: true };
  }
  const paidById = await checkOperator(t, input.paidById, "實際付款人");
  const reference = emptyToNull(input.reference);
  await checkReference(t, batch.id, reference);
  try {
    const payment = await t.supplierPayment.create({
      data: {
        batchId: batch.id,
        paidById,
        paidAt: input.paidAt,
        amount: input.amount,
        currency: input.currency,
        rateMicro: rateFor(input.currency, input.rate),
        method: emptyToNull(input.method),
        status: input.status ?? "PAID",
        reference,
        purpose: input.purpose ?? null,
        note: emptyToNull(input.note),
        dedupeKey: input.dedupeKey ?? null,
      },
    });
    await audit(t, actor, "supplierPayment.create", "SupplierPayment", payment.id, snapshot(payment));
    return { payment, duplicated: false };
  } catch (e) {
    if (input.dedupeKey && isUniqueViolation(e)) throw new BizError("這筆付款已經送出過了，請重新整理");
    throw e;
  }
}

function snapshot(p: { batchId: string; paidById: string | null; paidAt: Date; amount: number; currency: string; rateMicro: number | null; method: string | null; status: string; reference: string | null; purpose: string | null; note: string | null }) {
  return { batchId: p.batchId, paidById: p.paidById, paidAt: p.paidAt.toISOString(), amount: p.amount, currency: p.currency, rateMicro: p.rateMicro, method: p.method, status: p.status, reference: p.reference, purpose: p.purpose, note: p.note };
}

/** 修改付款紀錄：已作廢的不能改；稽核紀錄保留修改前後的值 */
export async function updateSupplierPayment(t: Tx, actor: Actor, id: string, input: Partial<Omit<SupplierPaymentInput, "batchId" | "dedupeKey">> & { reason?: string | null }) {
  const before = await t.supplierPayment.findUnique({ where: { id } });
  if (!before) throw new BizError("找不到付款紀錄");
  await lockRows(t, "PurchaseBatch", [before.batchId]);
  if (before.status === "VOIDED") throw new BizError("已作廢的付款紀錄不能修改，請另外新增一筆");
  checkFields(input);
  const currency = input.currency ?? (before.currency as SupplierPaymentCurrency);
  const data: Record<string, unknown> = {};
  if (input.paidById !== undefined) data.paidById = await checkOperator(t, input.paidById, "實際付款人", before.paidById);
  if (input.paidAt !== undefined) data.paidAt = input.paidAt;
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.rate !== undefined || input.currency !== undefined) data.rateMicro = input.rate !== undefined ? rateFor(currency, input.rate) : currency === "TWD" ? null : before.rateMicro;
  if (input.method !== undefined) data.method = emptyToNull(input.method);
  if (input.status !== undefined) data.status = input.status;
  if (input.reference !== undefined) {
    data.reference = emptyToNull(input.reference);
    await checkReference(t, before.batchId, data.reference as string | null, id);
  }
  if (input.purpose !== undefined) data.purpose = input.purpose ?? null;
  if (input.note !== undefined) data.note = emptyToNull(input.note);
  const b = snapshot(before) as Record<string, unknown>;
  const changedKeys = Object.keys(data).filter((k) => {
    const v = data[k] instanceof Date ? (data[k] as Date).toISOString() : data[k];
    return b[k] !== v;
  });
  if (!changedKeys.length) return before;
  const row = await t.supplierPayment.update({ where: { id }, data: Object.fromEntries(changedKeys.map((k) => [k, data[k]])) });
  const a = snapshot(row) as Record<string, unknown>;
  await audit(t, actor, "supplierPayment.update", "SupplierPayment", id, {
    before: Object.fromEntries(changedKeys.map((k) => [k, b[k]])),
    after: Object.fromEntries(changedKeys.map((k) => [k, a[k]])),
    reason: emptyToNull(input.reason ?? null),
  });
  return row;
}

/** 作廢付款紀錄：保留原紀錄，不計入統計 */
export async function voidSupplierPayment(t: Tx, actor: Actor, id: string, reason: string) {
  const r = reason?.trim();
  if (!r) throw new BizError("請填寫作廢原因");
  const before = await t.supplierPayment.findUnique({ where: { id } });
  if (!before) throw new BizError("找不到付款紀錄");
  await lockRows(t, "PurchaseBatch", [before.batchId]);
  if (before.status === "VOIDED") return before;
  const row = await t.supplierPayment.update({ where: { id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: r } });
  await audit(t, actor, "supplierPayment.void", "SupplierPayment", id, { before: { status: before.status }, reason: r });
  return row;
}

/** 付款紀錄的異動歷史（由稽核紀錄組成） */
export async function supplierPaymentHistory(t: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, { action: string; at: Date; data: unknown }[]>();
  const logs = await t.auditLog.findMany({ where: { entity: "SupplierPayment", entityId: { in: ids } }, orderBy: { createdAt: "asc" } });
  const m = new Map<string, { action: string; at: Date; data: unknown }[]>();
  for (const l of logs) {
    const arr = m.get(l.entityId!) ?? [];
    arr.push({ action: l.action, at: l.createdAt, data: l.data });
    m.set(l.entityId!, arr);
  }
  return m;
}
