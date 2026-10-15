// 收款與退款：每一筆都是獨立紀錄，不直接修改訂單上的金額。
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, emptyToNull, type Actor } from "./common";
import { recomputeOrder } from "./recompute";

export async function addPayment(
  t: Tx,
  actor: Actor,
  input: { orderId: string; amount: number; paidAt?: Date; method?: string | null; reference?: string | null; note?: string | null; dedupeKey?: string },
) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BizError("付款金額必須是正整數");
  if (input.dedupeKey) {
    const dup = await t.payment.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (dup) return { payment: dup, duplicated: true };
  }
  await lockRows(t, "Order", [input.orderId]);
  const order = await t.order.findUniqueOrThrow({ where: { id: input.orderId } });
  if (order.confirmation === "CANCELLED") throw new BizError("已取消的訂單不能登記收款");
  const payment = await t.payment.create({
    data: {
      orderId: input.orderId,
      amount: input.amount,
      paidAt: input.paidAt ?? new Date(),
      method: emptyToNull(input.method ?? null),
      reference: emptyToNull(input.reference ?? null),
      note: emptyToNull(input.note ?? null),
      dedupeKey: input.dedupeKey,
      createdById: actor.userId,
    },
  });
  const r = await recomputeOrder(t, input.orderId);
  await audit(t, actor, "payment.add", "Order", input.orderId, { paymentId: payment.id, amount: input.amount });
  return { payment, duplicated: false, overpaid: r.refundDue };
}

/** 作廢付款（登記錯誤時使用），保留原紀錄 */
export async function voidPayment(t: Tx, actor: Actor, input: { paymentId: string; reason: string }) {
  if (!input.reason?.trim()) throw new BizError("請填寫作廢原因");
  const p = await t.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
  await lockRows(t, "Order", [p.orderId]);
  if (p.voidedAt) throw new BizError("這筆付款已經作廢");
  await t.payment.update({ where: { id: p.id }, data: { voidedAt: new Date(), voidReason: input.reason } });
  await recomputeOrder(t, p.orderId);
  await audit(t, actor, "payment.void", "Order", p.orderId, { paymentId: p.id, amount: p.amount, reason: input.reason });
}

/**
 * 建立退款紀錄。預設為「待退款」，實際退出後再標記完成。
 * 退款總額（待退＋已退）不可超過淨收款。
 */
export async function createRefund(
  t: Tx,
  actor: Actor,
  input: {
    orderId: string;
    amount: number;
    reason?: string | null;
    orderItemId?: string | null;
    cancellationId?: string | null;
    method?: string | null;
    note?: string | null;
    completed?: boolean;
    dedupeKey?: string;
  },
) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BizError("退款金額必須是正整數");
  if (input.dedupeKey) {
    const dup = await t.refund.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (dup) return { refund: dup, duplicated: true };
  }
  await lockRows(t, "Order", [input.orderId]);
  const order = await t.order.findUniqueOrThrow({ where: { id: input.orderId } });
  const outstanding = order.paidCache - order.refundedCache - order.refundPendingCache;
  if (input.amount > outstanding) throw new BizError(`退款金額超過可退金額（已收 ${order.paidCache}、已退 ${order.refundedCache}、待退 ${order.refundPendingCache}）`);
  if (input.orderItemId) {
    const it = await t.orderItem.findUnique({ where: { id: input.orderItemId } });
    if (!it || it.orderId !== input.orderId) throw new BizError("退款明細不屬於這張訂單");
  }
  const refund = await t.refund.create({
    data: {
      orderId: input.orderId,
      amount: input.amount,
      orderItemId: input.orderItemId ?? null,
      cancellationId: input.cancellationId ?? null,
      reason: emptyToNull(input.reason ?? null),
      method: emptyToNull(input.method ?? null),
      note: emptyToNull(input.note ?? null),
      status: input.completed ? "COMPLETED" : "PENDING",
      completedAt: input.completed ? new Date() : null,
      dedupeKey: input.dedupeKey,
    },
  });
  await recomputeOrder(t, input.orderId);
  await audit(t, actor, "refund.create", "Order", input.orderId, { refundId: refund.id, amount: input.amount, completed: !!input.completed });
  return { refund, duplicated: false };
}

export async function completeRefund(t: Tx, actor: Actor, input: { refundId: string; method?: string | null; completedAt?: Date }) {
  const r = await t.refund.findUniqueOrThrow({ where: { id: input.refundId } });
  await lockRows(t, "Order", [r.orderId]);
  const fresh = await t.refund.findUniqueOrThrow({ where: { id: input.refundId } });
  if (fresh.status !== "PENDING") throw new BizError("只有待退款的紀錄可以標記完成");
  await t.refund.update({
    where: { id: r.id },
    data: { status: "COMPLETED", completedAt: input.completedAt ?? new Date(), method: emptyToNull(input.method ?? null) ?? r.method },
  });
  await recomputeOrder(t, r.orderId);
  await audit(t, actor, "refund.complete", "Order", r.orderId, { refundId: r.id, amount: r.amount });
}

export async function voidRefund(t: Tx, actor: Actor, input: { refundId: string; reason: string }) {
  if (!input.reason?.trim()) throw new BizError("請填寫作廢原因");
  const r = await t.refund.findUniqueOrThrow({ where: { id: input.refundId } });
  await lockRows(t, "Order", [r.orderId]);
  if (r.status === "VOIDED") throw new BizError("這筆退款已經作廢");
  await t.refund.update({ where: { id: r.id }, data: { status: "VOIDED", note: [r.note, `作廢：${input.reason}`].filter(Boolean).join("\n") } });
  await recomputeOrder(t, r.orderId);
  await audit(t, actor, "refund.void", "Order", r.orderId, { refundId: r.id, reason: input.reason });
}
