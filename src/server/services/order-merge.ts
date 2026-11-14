// 合併訂單：同一位客人的幾張單合成一張（例：以前一樣商品開一張的現貨出售）
// 留最早的那張；商品、收款、退款（出貨紀錄跟著商品）、運費、平台抽成、折扣都搬過去，合計不變
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, type Actor } from "./common";
import { recomputeOrder } from "./recompute";

const pick = <T,>(a: T | null | undefined, rest: (T | null | undefined)[]) => a ?? rest.find((x) => x != null) ?? null;

/** 合併前先看：留哪一張、合起來幾件、多少錢；不能合併就說為什麼 */
export async function mergePreview(t: Tx, orderIds: string[]) {
  const ids = [...new Set(orderIds)];
  if (ids.length < 2) throw new BizError("至少要勾兩張單才能合併");
  const orders = await t.order.findMany({
    where: { id: { in: ids } },
    orderBy: [{ orderedAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, orderNo: true, buyerId: true, cancelledAt: true, receivableCache: true, paidCache: true, buyer: { select: { name: true } }, items: { select: { productNameSnapshot: true, qty: true, cancelledQtyCache: true, unitPrice: true } } },
  });
  if (orders.length !== ids.length) throw new BizError("找不到其中幾張單，請重新整理");
  if (new Set(orders.map((o) => o.buyerId)).size > 1) throw new BizError("要同一位客人才能合併");
  const cancelled = orders.filter((o) => o.cancelledAt);
  if (cancelled.length) throw new BizError(`已取消的單不能合併（${cancelled.map((o) => o.orderNo).join("、")}）`);
  const lines = orders.flatMap((o) => o.items.filter((i) => i.qty - i.cancelledQtyCache > 0).map((i) => ({ name: i.productNameSnapshot, qty: i.qty - i.cancelledQtyCache, amount: (i.qty - i.cancelledQtyCache) * i.unitPrice })));
  return {
    keep: { id: orders[0].id, orderNo: orders[0].orderNo },
    others: orders.slice(1).map((o) => o.orderNo),
    buyer: orders[0].buyer.name,
    count: orders.length,
    lines,
    qty: lines.reduce((a, l) => a + l.qty, 0),
    receivable: orders.reduce((a, o) => a + o.receivableCache, 0),
    paid: orders.reduce((a, o) => a + o.paidCache, 0),
  };
}

export async function mergeOrders(t: Tx, actor: Actor, orderIds: string[]) {
  const ids = [...new Set(orderIds)];
  await lockRows(t, "Order", [...ids].sort());
  const pv = await mergePreview(t, ids);
  const all = await t.order.findMany({ where: { id: { in: ids } } });
  const keep = all.find((o) => o.id === pv.keep.id)!;
  const rest = all.filter((o) => o.id !== keep.id);
  const restIds = rest.map((o) => o.id);
  await t.orderItem.updateMany({ where: { orderId: { in: restIds } }, data: { orderId: keep.id } });
  await t.payment.updateMany({ where: { orderId: { in: restIds } }, data: { orderId: keep.id } });
  await t.refund.updateMany({ where: { orderId: { in: restIds } }, data: { orderId: keep.id } });
  await t.order.updateMany({ where: { parentOrderId: { in: restIds } }, data: { parentOrderId: keep.id } });
  // 只存單號字串的紀錄也指到留下的那張
  await t.buyerIncident.updateMany({ where: { orderId: { in: restIds } }, data: { orderId: keep.id } });
  await t.importRow.updateMany({ where: { orderId: { in: restIds } }, data: { orderId: keep.id } });
  await t.shopWait.updateMany({ where: { orderId: { in: restIds } }, data: { orderId: keep.id } });
  const notes = [keep.notes, ...rest.map((o) => o.notes)].filter((n): n is string => !!n && !!n.trim());
  await t.order.update({
    where: { id: keep.id },
    data: {
      shippingFee: all.reduce((a, o) => a + o.shippingFee, 0),
      platformFee: all.reduce((a, o) => a + o.platformFee, 0),
      orderDiscount: all.reduce((a, o) => a + o.orderDiscount, 0),
      groupBuyId: pick(keep.groupBuyId, rest.map((o) => o.groupBuyId)),
      salesChannel: pick(keep.salesChannel, rest.map((o) => o.salesChannel)),
      notes: notes.length ? [...new Set(notes)].join("\n") : null,
    },
  });
  await t.order.deleteMany({ where: { id: { in: restIds } } });
  await recomputeOrder(t, keep.id);
  await audit(t, actor, "order.merge", "Order", keep.id, { merged: rest.map((o) => ({ id: o.id, orderNo: o.orderNo })) });
  return { orderId: keep.id, orderNo: keep.orderNo, merged: rest.length };
}
