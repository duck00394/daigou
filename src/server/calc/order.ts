// 訂單金額與狀態的純計算（不碰資料庫，方便單元測試）。
// 計算口徑詳見 docs/計算口徑.md。
import { allocate, divRound, mulDiv } from "@/lib/money";

export type Confirmation = "PENDING" | "CONFIRMED" | "CANCELLED";
export type PurchaseFlag = "PENDING_PURCHASE" | "ORDERED" | "OUT_OF_STOCK" | "DELAYED";
export type PackFlag = "NONE" | "PREPARING" | "READY";
export type ProcurementStatus =
  | "PENDING_PURCHASE"
  | "ORDERED"
  | "PARTIAL_ARRIVED"
  | "ARRIVED"
  | "OUT_OF_STOCK"
  | "DELAYED"
  | "CANCELLED";
export type ShipStatus = "PENDING" | "PREPARING" | "READY" | "PARTIAL" | "SHIPPED" | "DELIVERED" | "CANCELLED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "REFUND_PENDING" | "PARTIALLY_REFUNDED" | "REFUNDED";
export type OrderStatus =
  | "PENDING_CONFIRM"
  | "AWAITING_PAYMENT"
  | "CONFIRMED"
  | "ORDERED"
  | "PROCESSING"
  | "PARTIAL"
  | "COMPLETED"
  | "CANCELLED";

export interface ItemInput {
  id: string;
  qty: number;
  unitPrice: number;
  lineDiscount: number;
  cancelledQty: number;
  reservedQty: number;
  shippedQty: number;
  deliveredQty?: number;
  purchaseFlag: PurchaseFlag;
  packFlag: PackFlag;
}

export interface OrderInput {
  confirmation: Confirmation;
  shippingFee: number;
  orderDiscount: number;
  items: ItemInput[];
  payments: { amount: number; voided: boolean }[];
  refunds: { amount: number; status: "PENDING" | "COMPLETED" | "VOIDED" }[];
}

export interface ItemResult {
  id: string;
  activeQty: number; // 有效件數 = 訂購數量 − 已取消數量
  pendingShipQty: number; // 待出貨 = 有效件數 − 已出貨
  lineGross: number; // 成交單價 × 有效件數
  lineDiscountEffective: number; // 明細折扣依有效件數比例計算
  lineNet: number; // 明細淨額
  orderDiscountShare: number; // 分攤到本明細的整單折扣
  netRevenue: number; // 本明細營收（不含運費）
  procurementStatus: ProcurementStatus;
  shipStatus: ShipStatus;
}

export interface OrderResult {
  items: ItemResult[];
  activeUnits: number;
  shippedUnits: number;
  goodsNet: number; // Σ 明細淨額
  orderDiscountEffective: number;
  shippingFeeEffective: number;
  receivable: number; // 應收
  paid: number; // 已收（不含作廢）
  refunded: number; // 已退款（僅 COMPLETED）
  refundPending: number; // 退款處理中（PENDING，尚未實際退出）
  netReceived: number; // 淨收 = 已收 − 已退款
  balance: number; // 待收 = max(0, 應收 − 淨收)
  refundDue: number; // 應退 = max(0, 淨收 − 應收)
  refundUnscheduled: number; // 應退但尚未建立退款紀錄 = max(0, 應退 − 退款處理中)
  paymentStatus: PaymentStatus;
  shipStatus: ShipStatus;
  status: OrderStatus;
}

export function computeItem(item: ItemInput): Omit<ItemResult, "orderDiscountShare" | "netRevenue"> {
  if (item.qty <= 0) throw new Error("訂購數量必須大於 0");
  if (item.cancelledQty < 0 || item.cancelledQty > item.qty) throw new Error("取消數量超出範圍");
  const activeQty = item.qty - item.cancelledQty;
  const pendingShipQty = Math.max(0, activeQty - item.shippedQty);
  const lineGross = item.unitPrice * activeQty;
  const lineDiscountEffective = activeQty === item.qty ? item.lineDiscount : mulDiv(item.lineDiscount, activeQty, item.qty);
  const lineNet = lineGross - lineDiscountEffective;

  let procurementStatus: ProcurementStatus;
  const arrived = item.reservedQty + item.shippedQty;
  if (activeQty === 0) procurementStatus = "CANCELLED";
  else if (arrived >= activeQty) procurementStatus = "ARRIVED";
  else if (arrived > 0) procurementStatus = "PARTIAL_ARRIVED";
  else procurementStatus = item.purchaseFlag;

  let shipStatus: ShipStatus;
  if (activeQty === 0) shipStatus = "CANCELLED";
  else if (item.shippedQty >= activeQty) shipStatus = (item.deliveredQty ?? 0) >= activeQty ? "DELIVERED" : "SHIPPED";
  else if (item.shippedQty > 0) shipStatus = "PARTIAL";
  else if (item.packFlag === "READY") shipStatus = "READY";
  else if (item.packFlag === "PREPARING") shipStatus = "PREPARING";
  else shipStatus = "PENDING";

  return { id: item.id, activeQty, pendingShipQty, lineGross, lineDiscountEffective, lineNet, procurementStatus, shipStatus };
}

export function computeOrder(input: OrderInput): OrderResult {
  const base = input.items.map(computeItem);
  const activeUnits = base.reduce((s, i) => s + i.activeQty, 0);
  const shippedUnits = input.items.reduce((s, i, idx) => s + Math.min(i.shippedQty, base[idx].activeQty), 0);
  const originalNet = input.items.reduce((s, i) => s + i.unitPrice * i.qty - i.lineDiscount, 0);
  const goodsNet = base.reduce((s, i) => s + i.lineNet, 0);
  const cancelledAll = input.confirmation === "CANCELLED" || (input.items.length > 0 && activeUnits === 0);

  // 整單折扣：依剩餘商品淨額占原始商品淨額的比例縮減；全部取消時為 0
  let orderDiscountEffective = 0;
  if (!cancelledAll && input.orderDiscount !== 0) {
    orderDiscountEffective = originalNet > 0 ? mulDiv(input.orderDiscount, goodsNet, originalNet) : input.orderDiscount;
  }
  // 運費：仍有有效商品時全額保留；全部取消時為 0（如需減免運費請直接修改訂單運費）
  const shippingFeeEffective = cancelledAll ? 0 : input.shippingFee;

  const shares = allocate(
    orderDiscountEffective,
    base.map((i) => Math.max(0, i.lineNet)),
  );
  const items: ItemResult[] = base.map((i, idx) => ({
    ...i,
    orderDiscountShare: shares[idx] ?? 0,
    netRevenue: i.lineNet - (shares[idx] ?? 0),
  }));

  const receivable = cancelledAll ? 0 : Math.max(0, goodsNet - orderDiscountEffective + shippingFeeEffective);
  const paid = input.payments.filter((p) => !p.voided).reduce((s, p) => s + p.amount, 0);
  const refunded = input.refunds.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.amount, 0);
  const refundPending = input.refunds.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.amount, 0);
  const netReceived = paid - refunded;
  const balance = Math.max(0, receivable - netReceived);
  const refundDue = Math.max(0, netReceived - receivable);
  const refundUnscheduled = Math.max(0, refundDue - refundPending);

  let paymentStatus: PaymentStatus;
  if (refundPending > 0) paymentStatus = "REFUND_PENDING";
  else if (refunded > 0) paymentStatus = netReceived <= 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
  else if (paid <= 0) paymentStatus = receivable === 0 && !cancelledAll && input.items.length > 0 ? "PAID" : "UNPAID";
  else if (netReceived >= receivable) paymentStatus = "PAID";
  else paymentStatus = "PARTIAL";

  // 出貨狀態（整單）
  let shipStatus: ShipStatus;
  const activeItems = items.filter((i) => i.activeQty > 0);
  if (cancelledAll) shipStatus = "CANCELLED";
  else if (activeItems.length > 0 && activeItems.every((i) => i.shipStatus === "DELIVERED")) shipStatus = "DELIVERED";
  else if (activeItems.length > 0 && shippedUnits >= activeUnits) shipStatus = "SHIPPED";
  else if (shippedUnits > 0) shipStatus = "PARTIAL";
  else if (activeItems.length > 0 && activeItems.every((i) => i.shipStatus === "READY")) shipStatus = "READY";
  else if (activeItems.some((i) => i.shipStatus === "READY" || i.shipStatus === "PREPARING")) shipStatus = "PREPARING";
  else shipStatus = "PENDING";

  // 訂單狀態：依優先順序推算，付款與出貨各自獨立，不會互相觸發
  let status: OrderStatus;
  const settled = balance === 0 && refundDue === 0 && refundPending === 0;
  const anyArrived = items.some((i) => i.procurementStatus === "ARRIVED" || i.procurementStatus === "PARTIAL_ARRIVED");
  const allOrdered =
    activeItems.length > 0 &&
    activeItems.every((i) => i.procurementStatus === "ORDERED" || i.procurementStatus === "ARRIVED" || i.procurementStatus === "PARTIAL_ARRIVED");
  if (cancelledAll) status = "CANCELLED";
  else if (input.confirmation === "PENDING") status = "PENDING_CONFIRM";
  else if (activeUnits > 0 && shippedUnits >= activeUnits && settled) status = "COMPLETED";
  else if (shippedUnits > 0) status = "PARTIAL";
  else if (anyArrived) status = "PROCESSING";
  else if (allOrdered) status = "ORDERED";
  else if (netReceived < receivable) status = "AWAITING_PAYMENT";
  else status = "CONFIRMED";

  return {
    items,
    activeUnits,
    shippedUnits,
    goodsNet,
    orderDiscountEffective,
    shippingFeeEffective,
    receivable,
    paid,
    refunded,
    refundPending,
    netReceived,
    balance,
    refundDue,
    refundUnscheduled,
    paymentStatus,
    shipStatus,
    status,
  };
}

/**
 * 已實現營收：依已出貨比例認列。
 * 明細：round(明細營收 × 已出貨 / 有效件數)；運費：round(運費 × 已出貨件數 / 有效件數)
 */
export function realizedRevenue(order: OrderResult, shippedByItem: Map<string, number>): number {
  if (order.activeUnits === 0) return 0;
  let sum = 0;
  let shippedUnits = 0;
  for (const it of order.items) {
    const shipped = Math.min(shippedByItem.get(it.id) ?? 0, it.activeQty);
    shippedUnits += shipped;
    if (it.activeQty > 0 && shipped > 0) sum += mulDiv(it.netRevenue, shipped, it.activeQty);
  }
  sum += mulDiv(order.shippingFeeEffective, shippedUnits, order.activeUnits);
  return sum;
}

export function unitNet(item: ItemResult): number {
  return item.activeQty > 0 ? divRound(item.netRevenue, item.activeQty) : 0;
}
