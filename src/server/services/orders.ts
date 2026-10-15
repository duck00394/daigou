// 訂單服務：所有入口（手動、LINE、Excel、未來網站）都經由這裡寫入同一套訂單資料。
import { BizError, lockRows, type Tx } from "@/server/db";
import { jpyToTwd } from "@/lib/money";
import { audit, emptyToNull, nextCode, type Actor } from "./common";
import { getDefaultRateMicro } from "./settings";
import { recomputeOrder } from "./recompute";
import { releaseExcessReservation } from "./inventory";
import type { OrderSource, PackFlag, PurchaseFlag } from "@prisma/client";

export interface NewItemInput {
  productId: string;
  qty: number;
  unitPrice?: number | null; // 未填時使用商品代購售價
  lineDiscount?: number;
  specNote?: string | null;
  categoryId?: string | null; // 未填時自動決定銷售歸屬
  notes?: string | null;
}

export interface NewOrderInput {
  buyerId: string;
  groupBuyId?: string | null;
  parentOrderId?: string | null;
  source?: OrderSource;
  externalRef?: string | null;
  rawInput?: string | null;
  orderedAt?: Date;
  confirmation?: "PENDING" | "CONFIRMED";
  shippingFee?: number;
  orderDiscount?: number;
  notes?: string | null;
  importBatchId?: string | null;
  idempotencyKey?: string | null;
  items: NewItemInput[];
}

function checkInt(n: unknown, label: string, { min = 0 }: { min?: number } = {}): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < min) throw new BizError(`${label}必須是${min > 0 ? "正" : "不小於 0 的"}整數`);
  return n;
}

async function buildItems(t: Tx, items: NewItemInput[], groupBuyCategoryId: string | null) {
  if (items.length === 0) throw new BizError("訂單至少要有一項商品");
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await t.product.findMany({
    where: { id: { in: productIds } },
    include: { categories: { select: { categoryId: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const rate = await getDefaultRateMicro(t);
  return items.map((i) => {
    const p = byId.get(i.productId);
    if (!p) throw new BizError("找不到商品");
    if (p.archivedAt) throw new BizError(`商品「${p.name}」已封存，不能再建立新訂單`);
    const qty = checkInt(i.qty, "數量", { min: 1 });
    const unitPrice = i.unitPrice ?? p.salePriceTwd;
    if (unitPrice === null || unitPrice === undefined) throw new BizError(`商品「${p.name}」尚未設定代購售價，請填寫成交單價`);
    checkInt(unitPrice, "成交單價");
    const lineDiscount = i.lineDiscount ?? 0;
    if (!Number.isInteger(lineDiscount)) throw new BizError("折扣必須是整數");
    if (lineDiscount > unitPrice * qty) throw new BizError("明細折扣不可大於商品金額");
    // 預估成本快照：優先使用商品的預估成本；沒有時以日幣官方價 × 目前預設匯率估算
    let estUnitCostTwd: number | null = p.estCostTwd;
    let estRateMicro: number | null = null;
    if (estUnitCostTwd === null && p.officialPriceJpy !== null) {
      estUnitCostTwd = jpyToTwd(p.officialPriceJpy, rate);
      estRateMicro = rate;
    }
    const cats = p.categories.map((c) => c.categoryId);
    let categoryId = i.categoryId ?? null;
    if (categoryId && !cats.includes(categoryId)) throw new BizError(`商品「${p.name}」不屬於指定的分類`);
    if (!categoryId) {
      if (groupBuyCategoryId && cats.includes(groupBuyCategoryId)) categoryId = groupBuyCategoryId;
      else if (cats.length === 1) categoryId = cats[0];
    }
    return {
      productId: p.id,
      productNameSnapshot: p.name,
      specNote: emptyToNull(i.specNote ?? null),
      categoryId,
      qty,
      unitPrice,
      lineDiscount,
      estUnitCostTwd,
      estRateMicro,
      estUnitCostJpy: p.officialPriceJpy,
      notes: emptyToNull(i.notes ?? null),
    };
  });
}

export async function createOrder(t: Tx, actor: Actor, input: NewOrderInput) {
  if (input.idempotencyKey) {
    const dup = await t.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { items: true } });
    if (dup) return dup;
  }
  const buyer = await t.buyer.findUnique({ where: { id: input.buyerId } });
  if (!buyer) throw new BizError("找不到買家");
  if (buyer.mergedIntoId) throw new BizError(`買家「${buyer.name}」已合併到其他買家，請改選主要買家`);
  let groupBuyCategoryId: string | null = null;
  if (input.groupBuyId) {
    const gb = await t.groupBuy.findUnique({ where: { id: input.groupBuyId } });
    if (!gb) throw new BizError("找不到代購團");
    if (gb.status === "CANCELLED") throw new BizError("代購團已取消");
    groupBuyCategoryId = gb.categoryId;
  }
  if (input.parentOrderId) {
    const parent = await t.order.findUnique({ where: { id: input.parentOrderId } });
    if (!parent) throw new BizError("找不到原訂單");
    if (parent.buyerId !== input.buyerId) throw new BizError("追加訂單的買家必須與原訂單相同");
    if ((parent.groupBuyId ?? null) !== (input.groupBuyId ?? null)) throw new BizError("追加訂單必須屬於原訂單的代購團");
  }
  const shippingFee = checkInt(input.shippingFee ?? 0, "運費");
  const orderDiscount = input.orderDiscount ?? 0;
  if (!Number.isInteger(orderDiscount)) throw new BizError("整單折扣必須是整數");
  const items = await buildItems(t, input.items, groupBuyCategoryId);
  const goods = items.reduce((s, i) => s + i.unitPrice * i.qty - i.lineDiscount, 0);
  if (orderDiscount > goods) throw new BizError("整單折扣不可大於商品金額");

  const orderNo = await nextCode(t, "order");
  const order = await t.order.create({
    data: {
      orderNo,
      buyerId: input.buyerId,
      groupBuyId: input.groupBuyId ?? null,
      parentOrderId: input.parentOrderId ?? null,
      source: input.source ?? "MANUAL",
      externalRef: emptyToNull(input.externalRef ?? null),
      rawInput: input.rawInput ?? null,
      orderedAt: input.orderedAt ?? new Date(),
      confirmation: input.confirmation ?? "CONFIRMED",
      shippingFee,
      orderDiscount,
      notes: emptyToNull(input.notes ?? null),
      importBatchId: input.importBatchId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });
  for (const it of items) {
    const created = await t.orderItem.create({ data: { ...it, orderId: order.id } });
    await t.orderItemEvent.create({
      data: { orderItemId: created.id, type: "CREATED", qtyDelta: it.qty, toValue: String(it.unitPrice), actorId: actor.userId },
    });
  }
  await recomputeOrder(t, order.id);
  await audit(t, actor, "order.create", "Order", order.id, { orderNo, source: order.source, items: items.length, parentOrderId: input.parentOrderId });
  return t.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
}

/** 追加商品到原訂單：新增明細，不改動原有明細 */
export async function appendItems(t: Tx, actor: Actor, orderId: string, items: NewItemInput[], note?: string) {
  await lockRows(t, "Order", [orderId]);
  const order = await t.order.findUniqueOrThrow({ where: { id: orderId }, include: { groupBuy: true } });
  if (order.confirmation === "CANCELLED" || order.statusCache === "CANCELLED") throw new BizError("已取消的訂單不能追加，請建立新訂單");
  if (order.statusCache === "COMPLETED") throw new BizError("已完成的訂單不能追加，請建立獨立追加訂單");
  const built = await buildItems(t, items, order.groupBuy?.categoryId ?? null);
  const created = [];
  for (const it of built) {
    const row = await t.orderItem.create({ data: { ...it, orderId, addedLater: true } });
    await t.orderItemEvent.create({
      data: { orderItemId: row.id, type: "APPENDED", qtyDelta: it.qty, toValue: String(it.unitPrice), note: note ?? null, actorId: actor.userId },
    });
    created.push(row);
  }
  await recomputeOrder(t, orderId);
  await audit(t, actor, "order.append", "Order", orderId, { items: created.map((c) => ({ id: c.id, productId: c.productId, qty: c.qty })) });
  return created;
}

/** 取消明細的部分或全部數量；已出貨的數量不能取消 */
export async function cancelItemQty(t: Tx, actor: Actor, input: { orderItemId: string; qty: number; reason?: string | null }) {
  const item0 = await t.orderItem.findUniqueOrThrow({ where: { id: input.orderItemId }, select: { orderId: true } });
  await lockRows(t, "Order", [item0.orderId]);
  const it = await t.orderItem.findUniqueOrThrow({
    where: { id: input.orderItemId },
    include: { cancellations: true, shipmentItems: true, order: { select: { buyerId: true, orderNo: true } } },
  });
  const qty = checkInt(input.qty, "取消數量", { min: 1 });
  const cancelled = it.cancellations.reduce((s, c) => s + c.qty, 0);
  const shipped = it.shipmentItems.reduce((s, c) => s + c.qty, 0);
  const cancellable = it.qty - cancelled - shipped;
  if (qty > cancellable) throw new BizError(`最多只能取消 ${cancellable} 件（已出貨 ${shipped} 件、已取消 ${cancelled} 件）`);
  const before = await recomputeOrder(t, it.orderId);
  const c = await t.orderCancellation.create({
    data: { orderItemId: it.id, qty, reason: emptyToNull(input.reason ?? null), actorId: actor.userId },
  });
  await t.orderItemEvent.create({ data: { orderItemId: it.id, type: "CANCELLED", qtyDelta: -qty, note: input.reason ?? null, actorId: actor.userId } });
  const released = await releaseExcessReservation(t, actor, it.id, `取消 ${qty} 件，釋放保留`);
  await t.buyerIncident.create({
    data: { buyerId: it.order.buyerId, kind: "CANCELLATION", orderId: it.orderId, description: `${it.order.orderNo} ${it.productNameSnapshot} 取消 ${qty} 件${input.reason ? `：${input.reason}` : ""}` },
  });
  const after = await recomputeOrder(t, it.orderId);
  await audit(t, actor, "order.cancelItem", "OrderItem", it.id, { qty, reason: input.reason, released });
  // 應退金額：取消後若已收超過應收，回傳建議退款金額（需另外建立退款紀錄，不會自動視為已退）
  return { cancellation: c, released, receivableBefore: before.receivable, receivableAfter: after.receivable, refundUnscheduled: after.refundUnscheduled };
}

/** 取消整張訂單：取消所有尚未出貨的數量 */
export async function cancelOrder(t: Tx, actor: Actor, input: { orderId: string; reason?: string | null }) {
  await lockRows(t, "Order", [input.orderId]);
  const order = await t.order.findUniqueOrThrow({
    where: { id: input.orderId },
    include: { items: { include: { cancellations: true, shipmentItems: true } } },
  });
  if (order.confirmation === "CANCELLED") throw new BizError("訂單已經取消");
  let shippedAny = false;
  for (const it of order.items) {
    const cancelled = it.cancellations.reduce((s, c) => s + c.qty, 0);
    const shipped = it.shipmentItems.reduce((s, c) => s + c.qty, 0);
    if (shipped > 0) shippedAny = true;
    const left = it.qty - cancelled - shipped;
    if (left > 0) await cancelItemQty(t, actor, { orderItemId: it.id, qty: left, reason: input.reason ?? "整單取消" });
  }
  if (!shippedAny) {
    await t.order.update({ where: { id: order.id }, data: { confirmation: "CANCELLED", cancelledAt: new Date(), cancelReason: emptyToNull(input.reason ?? null) } });
  } else {
    await t.order.update({ where: { id: order.id }, data: { cancelReason: emptyToNull(input.reason ?? null) } });
  }
  const r = await recomputeOrder(t, order.id);
  await audit(t, actor, "order.cancel", "Order", order.id, { reason: input.reason });
  return r;
}

export async function updateOrderMeta(
  t: Tx,
  actor: Actor,
  orderId: string,
  input: { shippingFee?: number; orderDiscount?: number; notes?: string | null; groupBuyId?: string | null; confirmation?: "PENDING" | "CONFIRMED"; externalRef?: string | null },
) {
  await lockRows(t, "Order", [orderId]);
  const order = await t.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  if (order.confirmation === "CANCELLED") throw new BizError("已取消的訂單不能修改");
  const data: Record<string, unknown> = {};
  const changes: Record<string, [unknown, unknown]> = {};
  if (input.shippingFee !== undefined && input.shippingFee !== order.shippingFee) {
    checkInt(input.shippingFee, "運費");
    data.shippingFee = input.shippingFee;
    changes.shippingFee = [order.shippingFee, input.shippingFee];
  }
  if (input.orderDiscount !== undefined && input.orderDiscount !== order.orderDiscount) {
    if (!Number.isInteger(input.orderDiscount)) throw new BizError("整單折扣必須是整數");
    const goods = order.items.reduce((s, i) => s + i.unitPrice * i.qty - i.lineDiscount, 0);
    if (input.orderDiscount > goods) throw new BizError("整單折扣不可大於商品金額");
    data.orderDiscount = input.orderDiscount;
    changes.orderDiscount = [order.orderDiscount, input.orderDiscount];
  }
  if (input.notes !== undefined) data.notes = emptyToNull(input.notes);
  if (input.externalRef !== undefined) data.externalRef = emptyToNull(input.externalRef);
  if (input.groupBuyId !== undefined && input.groupBuyId !== order.groupBuyId) {
    data.groupBuyId = input.groupBuyId;
    changes.groupBuyId = [order.groupBuyId, input.groupBuyId];
  }
  if (input.confirmation && input.confirmation !== order.confirmation) {
    data.confirmation = input.confirmation;
    changes.confirmation = [order.confirmation, input.confirmation];
  }
  await t.order.update({ where: { id: orderId }, data });
  const r = await recomputeOrder(t, orderId);
  if (Object.keys(changes).length) await audit(t, actor, "order.update", "Order", orderId, changes);
  return r;
}

export async function updateItem(
  t: Tx,
  actor: Actor,
  orderItemId: string,
  input: {
    unitPrice?: number;
    lineDiscount?: number;
    addQty?: number;
    categoryId?: string | null;
    specNote?: string | null;
    notes?: string | null;
    purchaseFlag?: PurchaseFlag;
    packFlag?: PackFlag;
  },
) {
  const it0 = await t.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, select: { orderId: true } });
  await lockRows(t, "Order", [it0.orderId]);
  const it = await t.orderItem.findUniqueOrThrow({
    where: { id: orderItemId },
    include: { order: true, product: { include: { categories: true } } },
  });
  if (it.order.confirmation === "CANCELLED") throw new BizError("已取消的訂單不能修改");
  const data: Record<string, unknown> = {};
  const events: { type: string; fromValue?: string; toValue?: string; qtyDelta?: number }[] = [];
  if (input.unitPrice !== undefined && input.unitPrice !== it.unitPrice) {
    checkInt(input.unitPrice, "成交單價");
    data.unitPrice = input.unitPrice;
    events.push({ type: "PRICE_CHANGED", fromValue: String(it.unitPrice), toValue: String(input.unitPrice) });
  }
  if (input.lineDiscount !== undefined && input.lineDiscount !== it.lineDiscount) {
    if (!Number.isInteger(input.lineDiscount)) throw new BizError("折扣必須是整數");
    data.lineDiscount = input.lineDiscount;
    events.push({ type: "DISCOUNT_CHANGED", fromValue: String(it.lineDiscount), toValue: String(input.lineDiscount) });
  }
  if (input.addQty !== undefined && input.addQty !== 0) {
    // 只允許增加數量；減少一律走取消流程，保留取消紀錄
    checkInt(input.addQty, "增加數量", { min: 1 });
    data.qty = it.qty + input.addQty;
    events.push({ type: "QTY_CHANGED", fromValue: String(it.qty), toValue: String(it.qty + input.addQty), qtyDelta: input.addQty });
  }
  const newQty = (data.qty as number | undefined) ?? it.qty;
  const newPrice = (data.unitPrice as number | undefined) ?? it.unitPrice;
  const newDisc = (data.lineDiscount as number | undefined) ?? it.lineDiscount;
  if (newDisc > newPrice * newQty) throw new BizError("明細折扣不可大於商品金額");
  if (input.categoryId !== undefined && input.categoryId !== it.categoryId) {
    if (input.categoryId && !it.product.categories.some((c) => c.categoryId === input.categoryId)) throw new BizError("商品不屬於這個分類");
    data.categoryId = input.categoryId;
    events.push({ type: "CATEGORY_CHANGED", fromValue: it.categoryId ?? "", toValue: input.categoryId ?? "" });
  }
  if (input.specNote !== undefined) data.specNote = emptyToNull(input.specNote);
  if (input.notes !== undefined) data.notes = emptyToNull(input.notes);
  if (input.purchaseFlag && input.purchaseFlag !== it.purchaseFlag) {
    data.purchaseFlag = input.purchaseFlag;
    events.push({ type: "PURCHASE_FLAG", fromValue: it.purchaseFlag, toValue: input.purchaseFlag });
  }
  if (input.packFlag && input.packFlag !== it.packFlag) {
    data.packFlag = input.packFlag;
    events.push({ type: "PACK_FLAG", fromValue: it.packFlag, toValue: input.packFlag });
  }
  await t.orderItem.update({ where: { id: orderItemId }, data });
  for (const e of events) await t.orderItemEvent.create({ data: { orderItemId, ...e, actorId: actor.userId } });
  return recomputeOrder(t, it.orderId);
}

/** 批次更新明細的採購或備貨旗標 */
export async function bulkSetFlags(t: Tx, actor: Actor, itemIds: string[], input: { purchaseFlag?: PurchaseFlag; packFlag?: PackFlag }) {
  for (const id of [...new Set(itemIds)]) await updateItem(t, actor, id, input);
  return itemIds.length;
}
