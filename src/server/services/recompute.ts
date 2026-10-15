// 依流水重新計算訂單與明細的快取欄位。所有異動訂單的操作都必須在同一交易內呼叫。
import type { Tx } from "@/server/db";
import { computeOrder, type OrderResult } from "@/server/calc/order";

export async function loadOrderCalc(t: Tx, orderId: string) {
  const order = await t.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          cancellations: { select: { qty: true } },
          movements: { select: { reservedDelta: true } },
          shipmentItems: { select: { qty: true, shipment: { select: { status: true } } } },
        },
      },
      payments: { select: { amount: true, voidedAt: true } },
      refunds: { select: { amount: true, status: true } },
    },
  });
  const items = order.items.map((it) => ({
    id: it.id,
    qty: it.qty,
    unitPrice: it.unitPrice,
    lineDiscount: it.lineDiscount,
    cancelledQty: it.cancellations.reduce((s, c) => s + c.qty, 0),
    reservedQty: it.movements.reduce((s, m) => s + m.reservedDelta, 0),
    shippedQty: it.shipmentItems.reduce((s, x) => s + x.qty, 0),
    deliveredQty: it.shipmentItems.filter((x) => x.shipment.status === "DELIVERED").reduce((s, x) => s + x.qty, 0),
    purchaseFlag: it.purchaseFlag,
    packFlag: it.packFlag,
  }));
  const result = computeOrder({
    confirmation: order.confirmation,
    shippingFee: order.shippingFee,
    orderDiscount: order.orderDiscount,
    items,
    payments: order.payments.map((p) => ({ amount: p.amount, voided: !!p.voidedAt })),
    refunds: order.refunds.map((r) => ({ amount: r.amount, status: r.status })),
  });
  return { order, items, result };
}

export async function recomputeOrder(t: Tx, orderId: string): Promise<OrderResult> {
  const { items, result } = await loadOrderCalc(t, orderId);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = result.items[i];
    await t.orderItem.update({
      where: { id: it.id },
      data: {
        cancelledQtyCache: it.cancelledQty,
        reservedQtyCache: it.reservedQty,
        shippedQtyCache: it.shippedQty,
        procurementStatusCache: r.procurementStatus,
        shipStatusCache: r.shipStatus,
      },
    });
  }
  await t.order.update({
    where: { id: orderId },
    data: {
      statusCache: result.status,
      paymentStatusCache: result.paymentStatus,
      shipStatusCache: result.shipStatus,
      receivableCache: result.receivable,
      paidCache: result.paid,
      refundedCache: result.refunded,
      refundPendingCache: result.refundPending,
      balanceCache: result.balance,
      refundDueCache: result.refundDue,
    },
  });
  return result;
}
