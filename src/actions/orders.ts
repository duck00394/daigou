"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx, prisma, BizError } from "@/server/db";
import * as o from "@/server/services/orders";
import * as pay from "@/server/services/payments";
import { buyerWarnings } from "@/server/services/buyers";
import { parseDateTimeInput } from "@/lib/labels";

const itemSchema = z.object({
  productId: z.string(),
  qty: z.number().int().min(1).max(9999),
  unitPrice: z.number().int().min(0).nullish(),
  lineDiscount: z.number().int().optional(),
  specNote: z.string().max(200).nullish(),
  categoryId: z.string().nullish(),
});
const orderSchema = z.object({
  buyerId: z.string(),
  groupBuyId: z.string().nullish(),
  parentOrderId: z.string().nullish(),
  orderedAt: z.string().nullish(),
  confirmation: z.enum(["PENDING", "CONFIRMED"]),
  shippingFee: z.number().int().min(0),
  orderDiscount: z.number().int(),
  notes: z.string().max(2000).nullish(),
  items: z.array(itemSchema).min(1).max(200),
  idempotencyKey: z.string().max(100),
});
export type OrderForm = z.infer<typeof orderSchema>;

export async function createOrderAction(form: OrderForm) {
  return run(async (a) => {
    const f = orderSchema.parse(form);
    // 重複送出：同一個識別碼只會建立一次（資料庫唯一性限制）
    const ord = await tx((t) => o.createOrder(t, a, { ...f, orderedAt: parseDateTimeInput(f.orderedAt) ?? undefined, source: "MANUAL" }));
    return { id: ord.id, orderNo: ord.orderNo };
  });
}

export async function buyerWarningsAction(buyerId: string) {
  return run(async () => {
    const m = await tx((t) => buyerWarnings(t, [buyerId]));
    const open = await prisma.order.findMany({
      where: { buyerId, confirmation: "CONFIRMED", statusCache: { notIn: ["COMPLETED", "CANCELLED"] } },
      select: { id: true, orderNo: true, balanceCache: true, groupBuyId: true, statusCache: true },
      orderBy: { orderedAt: "desc" },
      take: 20,
    });
    const cancelled = await prisma.orderCancellation.count({ where: { orderItem: { order: { buyerId } } } });
    return { tags: m.get(buyerId) ?? [], openOrders: open, cancelledCount: cancelled };
  }, "read");
}

export async function appendItemsAction(orderId: string, items: z.infer<typeof itemSchema>[], note: string | null) {
  return run((a) => tx((t) => o.appendItems(t, a, orderId, z.array(itemSchema).min(1).parse(items), note ?? undefined)).then((r) => r.length));
}

export async function cancelItemAction(orderItemId: string, qty: number, reason: string | null) {
  return run((a) => tx((t) => o.cancelItemQty(t, a, { orderItemId, qty, reason })).then((r) => ({ refundUnscheduled: r.refundUnscheduled, receivableAfter: r.receivableAfter, released: r.released })));
}

export async function cancelOrderAction(orderId: string, reason: string | null) {
  return run((a) => tx((t) => o.cancelOrder(t, a, { orderId, reason }), { timeout: 60_000 }).then((r) => ({ refundUnscheduled: r.refundUnscheduled })));
}

export async function updateOrderMetaAction(orderId: string, input: { shippingFee?: number; orderDiscount?: number; notes?: string | null; groupBuyId?: string | null; confirmation?: "PENDING" | "CONFIRMED" }) {
  return run((a) => tx((t) => o.updateOrderMeta(t, a, orderId, input)).then(() => null));
}

export async function updateItemAction(
  itemId: string,
  input: { unitPrice?: number; lineDiscount?: number; addQty?: number; categoryId?: string | null; specNote?: string | null; notes?: string | null; purchaseFlag?: "PENDING_PURCHASE" | "ORDERED" | "OUT_OF_STOCK" | "DELAYED"; packFlag?: "NONE" | "PREPARING" | "READY" },
) {
  return run((a) => tx((t) => o.updateItem(t, a, itemId, input)).then(() => null));
}

export async function bulkFlagsAction(itemIds: string[], input: { purchaseFlag?: "PENDING_PURCHASE" | "ORDERED" | "OUT_OF_STOCK" | "DELAYED"; packFlag?: "NONE" | "PREPARING" | "READY" }) {
  return run((a) => tx((t) => o.bulkSetFlags(t, a, z.array(z.string()).max(500).parse(itemIds), input), { timeout: 120_000 }));
}

export async function addPaymentAction(input: { orderId: string; amount: number; paidAt: string | null; method: string | null; reference: string | null; note: string | null; dedupeKey: string }) {
  return run((a) => tx((t) => pay.addPayment(t, a, { ...input, paidAt: parseDateTimeInput(input.paidAt) ?? undefined })).then((r) => ({ duplicated: r.duplicated })));
}
export async function voidPaymentAction(paymentId: string, reason: string) {
  return run((a) => tx((t) => pay.voidPayment(t, a, { paymentId, reason })));
}
export async function createRefundAction(input: { orderId: string; amount: number; reason: string | null; method: string | null; completed: boolean; orderItemId?: string | null; dedupeKey: string }) {
  return run((a) => tx((t) => pay.createRefund(t, a, input)).then((r) => ({ duplicated: r.duplicated })));
}
export async function completeRefundAction(refundId: string, method: string | null) {
  return run((a) => tx((t) => pay.completeRefund(t, a, { refundId, method })));
}
export async function voidRefundAction(refundId: string, reason: string) {
  return run((a) => tx((t) => pay.voidRefund(t, a, { refundId, reason })));
}

/** 依買家一次收款，按訂單日期由舊到新沖銷待收金額 */
export async function payForBuyerAction(input: { buyerId: string; amount: number; method: string | null; reference: string | null; paidAt: string | null; dedupeKey: string }) {
  return run((a) =>
    tx(async (t) => {
      if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BizError("付款金額必須是正整數");
      const orders = await t.order.findMany({ where: { buyerId: input.buyerId, confirmation: "CONFIRMED", balanceCache: { gt: 0 } }, orderBy: { orderedAt: "asc" } });
      const totalDue = orders.reduce((s, x) => s + x.balanceCache, 0);
      if (input.amount > totalDue) throw new BizError(`金額超過這位買家的待收總額 ${totalDue} 元`);
      let left = input.amount;
      const used: string[] = [];
      for (const ord of orders) {
        if (left <= 0) break;
        const take = Math.min(left, ord.balanceCache);
        await pay.addPayment(t, a, { orderId: ord.id, amount: take, paidAt: parseDateTimeInput(input.paidAt) ?? undefined, method: input.method, reference: input.reference, note: "依買家合併收款", dedupeKey: `${input.dedupeKey}:${ord.id}` });
        used.push(ord.orderNo);
        left -= take;
      }
      return { orders: used };
    }, { timeout: 60_000 }),
  );
}

export async function bulkConfirmAction(orderIds: string[]) {
  return run(async (a) => {
    let n = 0;
    for (const id of z.array(z.string()).max(500).parse(orderIds)) {
      const ord = await prisma.order.findUnique({ where: { id } });
      if (ord?.confirmation === "PENDING") {
        await tx((t) => o.updateOrderMeta(t, a, id, { confirmation: "CONFIRMED" }));
        n++;
      }
    }
    return n;
  });
}
