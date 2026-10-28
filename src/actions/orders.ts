"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { claimRequest } from "@/server/services/common";
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

/** 「現在看誰的」選的人；選「全部」時用這支手機的人 */
async function actingOwner() {
  const { getView } = await import("@/server/view");
  const v = await getView();
  return v.key !== "all" ? v.key : v.me;
}

export async function createOrderAction(form: OrderForm) {
  return run(async (a) => {
    const f = orderSchema.parse(form);
    // 重複送出：同一個識別碼只會建立一次（資料庫唯一性限制）
    const owner = await actingOwner();
    const ord = await tx(async (t) => {
      const r = await o.createOrder(t, a, { ...f, orderedAt: parseDateTimeInput(f.orderedAt) ?? undefined, source: "MANUAL" });
      // 客人跟誰訂的：預設是「現在看誰的」那個人（到貨出貨時扣他的貨）
      if (owner) await t.orderItem.updateMany({ where: { orderId: r.id, ownerKey: null }, data: { ownerKey: owner } });
      return r;
    });
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

export async function appendItemsAction(orderId: string, items: z.infer<typeof itemSchema>[], note: string | null, requestKey?: string) {
  return run((a) =>
    tx(async (t) => {
      await claimRequest(t, requestKey, "order.append");
      const created = await o.appendItems(t, a, orderId, z.array(itemSchema).min(1).parse(items), note ?? undefined);
      // 追加的跟原本那張同一個人；原本沒分就用「現在看誰的」
      const first = await t.orderItem.findFirst({ where: { orderId, ownerKey: { not: null } }, select: { ownerKey: true } });
      const owner = first?.ownerKey ?? (await actingOwner());
      if (owner) await t.orderItem.updateMany({ where: { id: { in: created.map((c) => c.id) } }, data: { ownerKey: owner } });
      return created;
    }).then((r) => r.length),
  );
}

export async function cancelItemAction(orderItemId: string, qty: number, reason: string | null, requestKey?: string) {
  return run((a) =>
    tx(async (t) => {
      await claimRequest(t, requestKey, "order.cancelItem");
      return o.cancelItemQty(t, a, { orderItemId, qty, reason });
    }).then((r) => ({ refundUnscheduled: r.refundUnscheduled, receivableAfter: r.receivableAfter, released: r.released })),
  );
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

/** 多選訂單一次改代購團（groupBuyId 空白＝不屬於任何代購團）；已取消的訂單跳過 */
export async function bulkGroupBuyAction(orderIds: string[], groupBuyId: string | null) {
  return run(async (a) => {
    const ids = z.array(z.string().min(1).max(64)).min(1).max(500).parse(orderIds);
    const gb = z.string().max(64).nullable().parse(groupBuyId);
    return tx(async (t) => {
      if (gb) {
        const g = await t.groupBuy.findUnique({ where: { id: gb }, select: { status: true } });
        if (!g || g.status === "CANCELLED") throw new BizError("找不到這個代購團，或已取消");
      }
      let changed = 0;
      let skipped = 0;
      for (const id of ids) {
        const ord = await t.order.findUnique({ where: { id }, select: { confirmation: true, groupBuyId: true } });
        if (!ord || ord.confirmation === "CANCELLED") { skipped++; continue; }
        if (ord.groupBuyId === gb) continue;
        await o.updateOrderMeta(t, a, id, { groupBuyId: gb });
        changed++;
      }
      return { changed, skipped };
    }, { timeout: 60_000 });
  });
}

/** 改客人這筆預訂跟誰訂的（owner 空白＝還沒分） */
/** 以前記的客人預訂（還沒分跟誰訂的）一次全部分給一個人；貨不夠換的那幾筆跳過並列出 */
export async function assignUnassignedDemandAction(owner: string, orderIds?: string[]) {
  return run(async (a) => {
    const ow = z.string().min(1).max(64).parse(owner);
    const only = orderIds ? z.array(z.string().min(1).max(64)).min(1).max(500).parse(orderIds) : null;
    const { setDemandOwner } = await import("@/server/services/demand-owner");
    const { lotOwners, ownerOfLot } = await import("@/server/services/ownership");
    const items = await prisma.orderItem.findMany({
      where: { ownerKey: null, order: { confirmation: { not: "CANCELLED" }, ...(only ? { id: { in: only } } : {}) } },
      select: { id: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, productNameSnapshot: true, order: { select: { confirmation: true, buyer: { select: { name: true } } } } },
    });
    let done = 0;
    const failed: string[] = [];
    for (const i of items) {
      const open = i.qty - i.cancelledQtyCache - i.shippedQtyCache;
      try {
        if (open > 0 && i.order.confirmation === "CONFIRMED") {
          // 還沒給的：分給選的人（已保留的貨一起換成他的）
          await tx((t) => setDemandOwner(t, a, i.id, ow), { timeout: 30_000 });
        } else {
          // 已經給了的（現貨賣掉的）：照實際扣到誰的貨分；看不出來才分給選的人
          const moves = await prisma.inventoryMovement.findMany({ where: { kind: "SHIP", orderItemId: i.id }, select: { purchaseBatchItemId: true, onHandDelta: true } });
          const owners = await tx((t) => lotOwners(t, moves.map((m) => m.purchaseBatchItemId)));
          const by = new Map<string, number>();
          for (const m of moves) by.set(ownerOfLot(owners, m.purchaseBatchItemId), (by.get(ownerOfLot(owners, m.purchaseBatchItemId)) ?? 0) - m.onHandDelta);
          const top = [...by.entries()].filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1])[0]?.[0];
          await prisma.orderItem.update({ where: { id: i.id }, data: { ownerKey: top && top !== "none" ? top : ow } });
        }
        done++;
      } catch (e) {
        if (!(e instanceof BizError)) throw e;
        failed.push(`${i.order.buyer.name} ${i.productNameSnapshot}`);
      }
    }
    return { done, failed: failed.slice(0, 10) };
  });
}

export async function setDemandOwnerAction(orderItemId: string, owner: string | null) {
  return run(async (a) => {
    const id = z.string().min(1).max(64).parse(orderItemId);
    const ow = z.string().max(64).nullable().parse(owner || null);
    const { setDemandOwner } = await import("@/server/services/demand-owner");
    return tx((t) => setDemandOwner(t, a, id, ow), { timeout: 30_000 });
  });
}
