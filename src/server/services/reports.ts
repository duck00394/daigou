import { feeTwd } from "./fees";
// 統計與報表。所有數字都從流水與明細即時計算，口徑見 docs/計算口徑.md。
import type { Db, Tx } from "@/server/db";
import { divRound, mulDiv } from "@/lib/money";
import { computeOrder, realizedRevenue, type OrderResult } from "@/server/calc/order";
import { landedCosts } from "./purchase";

// ── 時間區間（台北時間） ──
export function monthRange(ym: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error("月份格式錯誤");
  const y = +m[1];
  const mo = +m[2];
  return { start: new Date(Date.UTC(y, mo - 1, 1, -8)), end: new Date(Date.UTC(y, mo, 1, -8)) };
}

export function currentYm(d = new Date()): string {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(d);
  return s.slice(0, 7);
}

// ── 分類統計 ──

export interface QtyBreakdown {
  activeQty: number; // 有效訂購件數
  cancelledQty: number; // 已取消件數
  toPurchase: number; // 待下單
  incoming: number; // 待到貨（已向供應商下單、尚未到貨保留）
  toShip: number; // 待出貨（已到貨保留、尚未出貨）
  shipped: number; // 已出貨
  buyers: Set<string>; // 有效購買人（有效件數 > 0 的不同買家）
}

function emptyBreakdown(): QtyBreakdown {
  return { activeQty: 0, cancelledQty: 0, toPurchase: 0, incoming: 0, toShip: 0, shipped: 0, buyers: new Set() };
}

type ItemRow = {
  qty: number;
  cancelledQtyCache: number;
  shippedQtyCache: number;
  reservedQtyCache: number;
  purchaseFlag: string;
  order: { buyerId: string; confirmation: string };
};

/** 單筆明細計入統計；待確認的訂單不列入有效統計，取消件數則一律列入 */
export function addItem(b: QtyBreakdown, it: ItemRow) {
  b.cancelledQty += it.cancelledQtyCache;
  if (it.order.confirmation !== "CONFIRMED") return;
  const active = it.qty - it.cancelledQtyCache;
  if (active <= 0) return;
  const shipped = Math.min(it.shippedQtyCache, active);
  const toShip = Math.min(it.reservedQtyCache, active - shipped);
  const rest = active - shipped - toShip;
  b.activeQty += active;
  b.shipped += shipped;
  b.toShip += toShip;
  if (it.purchaseFlag === "ORDERED") b.incoming += rest;
  else b.toPurchase += rest;
  b.buyers.add(it.order.buyerId);
}

const itemSelect = {
  qty: true,
  cancelledQtyCache: true,
  shippedQtyCache: true,
  reservedQtyCache: true,
  purchaseFlag: true,
  categoryId: true,
  productId: true,
  unitPrice: true,
  order: { select: { buyerId: true, confirmation: true } },
} as const;

export async function categoryOverview(db: Db) {
  const [cats, links, items] = await Promise.all([
    db.category.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }] }),
    db.productCategory.groupBy({ by: ["categoryId"], _count: { productId: true } }),
    db.orderItem.findMany({ select: itemSelect }),
  ]);
  const byCat = new Map<string, QtyBreakdown>();
  for (const it of items) {
    const key = it.categoryId ?? "__none__";
    const b = byCat.get(key) ?? emptyBreakdown();
    addItem(b, it);
    byCat.set(key, b);
  }
  const productCount = new Map(links.map((l) => [l.categoryId, l._count.productId]));
  return {
    categories: cats.map((c) => ({ ...c, productCount: productCount.get(c.id) ?? 0, stats: byCat.get(c.id) ?? emptyBreakdown() })),
    unassigned: byCat.get("__none__") ?? emptyBreakdown(),
  };
}

export async function categoryDetail(db: Db, categoryId: string) {
  const category = await db.category.findUniqueOrThrow({ where: { id: categoryId } });
  const products = await db.product.findMany({
    where: { categories: { some: { categoryId } } },
    include: { productType: true, characters: { include: { character: true } } },
    orderBy: { name: "asc" },
  });
  const items = await db.orderItem.findMany({ where: { categoryId }, select: itemSelect });
  const total = emptyBreakdown();
  const byProduct = new Map<string, QtyBreakdown>();
  for (const it of items) {
    addItem(total, it);
    const b = byProduct.get(it.productId) ?? emptyBreakdown();
    addItem(b, it);
    byProduct.set(it.productId, b);
  }
  return { category, total, products: products.map((p) => ({ product: p, stats: byProduct.get(p.id) ?? emptyBreakdown() })) };
}

/** 商品在某分類（或全部）的買家明細 */
export async function productBuyers(db: Db, productId: string, categoryId?: string | null) {
  return db.orderItem.findMany({
    where: { productId, ...(categoryId ? { categoryId } : {}) },
    include: {
      order: { select: { id: true, orderNo: true, orderedAt: true, confirmation: true, paymentStatusCache: true, statusCache: true, buyer: { select: { id: true, name: true, code: true } } } },
      cancellations: true,
      category: { select: { name: true } },
    },
    orderBy: { order: { orderedAt: "asc" } },
  });
}

// ── 成本 ──

interface ShipMove {
  qty: number;
  purchaseBatchItemId: string | null;
  unitCostTwd: number | null;
  estUnitCostTwd: number | null;
}

/**
 * 單筆出貨流水的銷貨成本：
 *  - 來自採購批次：該採購明細實際總成本 × 出貨件數 ÷ 採購件數
 *  - 手動入庫：入庫時的成本快照 × 件數
 *  - 都沒有：建單時的預估成本 × 件數（並計入「以預估成本計算的件數」）
 */
export function costOfMove(landed: Map<string, { qty: number; totalTwd: number }>, m: ShipMove) {
  if (m.purchaseBatchItemId) {
    const l = landed.get(m.purchaseBatchItemId);
    return { cost: l && l.qty > 0 ? mulDiv(l.totalTwd, m.qty, l.qty) : 0, estimatedUnits: 0 };
  }
  if (m.unitCostTwd !== null) return { cost: m.qty * m.unitCostTwd, estimatedUnits: 0 };
  return { cost: m.qty * (m.estUnitCostTwd ?? 0), estimatedUnits: m.qty };
}

// ── 月報 ──

export async function monthlyReport(db: Db, ym: string) {
  const { start, end } = monthRange(ym);
  // 本月有出貨的訂單：已實現營收 = 截至月底認列 − 截至月初認列
  const shipItems = await db.shipmentItem.findMany({
    where: { shipment: { shippedAt: { gte: start, lt: end } } },
    select: { orderItem: { select: { orderId: true } } },
  });
  const orderIds = [...new Set(shipItems.map((s) => s.orderItem.orderId))];
  const orders = await db.order.findMany({
    where: { id: { in: orderIds } },
    include: {
      buyer: { select: { id: true, name: true } },
      items: {
        include: {
          cancellations: { select: { qty: true } },
          shipmentItems: { select: { qty: true, shipment: { select: { shippedAt: true } } } },
          product: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
        },
      },
      payments: { select: { amount: true, voidedAt: true } },
      refunds: { select: { amount: true, status: true } },
    },
  });
  let revenue = 0;
  let shippingIncome = 0;
  const byCategory = new Map<string, { name: string; revenue: number; cost: number; qty: number }>();
  const byProduct = new Map<string, { name: string; revenue: number; cost: number; qty: number }>();
  const itemMeta = new Map<string, { productId: string; productName: string; categoryId: string; categoryName: string; estUnitCostTwd: number | null }>();
  for (const o of orders) {
    const shippedAt = (cut: Date) => new Map(o.items.map((it) => [it.id, it.shipmentItems.filter((s) => s.shipment.shippedAt < cut).reduce((a, s) => a + s.qty, 0)]));
    const calc = computeOrder({
      confirmation: o.confirmation,
      shippingFee: o.shippingFee,
      orderDiscount: o.orderDiscount,
      items: o.items.map((it) => ({
        id: it.id,
        qty: it.qty,
        unitPrice: it.unitPrice,
        lineDiscount: it.lineDiscount,
        cancelledQty: it.cancellations.reduce((s, c) => s + c.qty, 0),
        reservedQty: 0,
        shippedQty: it.shipmentItems.reduce((s, x) => s + x.qty, 0),
        purchaseFlag: it.purchaseFlag,
        packFlag: it.packFlag,
      })),
      payments: o.payments.map((p) => ({ amount: p.amount, voided: !!p.voidedAt })),
      refunds: o.refunds.map((r) => ({ amount: r.amount, status: r.status })),
    });
    const atEnd = shippedAt(end);
    const atStart = shippedAt(start);
    const total = realizedRevenue(calc, atEnd) - realizedRevenue(calc, atStart);
    let goods = 0;
    calc.items.forEach((ci, idx) => {
      const it = o.items[idx];
      const e = Math.min(atEnd.get(it.id) ?? 0, ci.activeQty);
      const s = Math.min(atStart.get(it.id) ?? 0, ci.activeQty);
      if (ci.activeQty === 0 || e === s) return;
      const r = mulDiv(ci.netRevenue, e, ci.activeQty) - mulDiv(ci.netRevenue, s, ci.activeQty);
      goods += r;
      const cKey = it.category?.id ?? "__none__";
      const c = byCategory.get(cKey) ?? { name: it.category?.name ?? "未歸類", revenue: 0, cost: 0, qty: 0 };
      c.revenue += r;
      c.qty += e - s;
      byCategory.set(cKey, c);
      const p = byProduct.get(it.productId) ?? { name: it.product.name, revenue: 0, cost: 0, qty: 0 };
      p.revenue += r;
      p.qty += e - s;
      byProduct.set(it.productId, p);
    });
    for (const it of o.items) itemMeta.set(it.id, { productId: it.productId, productName: it.product.name, categoryId: it.category?.id ?? "__none__", categoryName: it.category?.name ?? "未歸類", estUnitCostTwd: it.estUnitCostTwd });
    revenue += total;
    shippingIncome += total - goods;
  }

  // 銷貨成本：本月出貨流水
  const sItems = await db.shipmentItem.findMany({
    where: { shipment: { shippedAt: { gte: start, lt: end } } },
    select: { id: true },
  });
  const monthMoves = await db.inventoryMovement.findMany({
    where: { kind: "SHIP", shipmentItemId: { in: sItems.map((s) => s.id) } },
    select: { onHandDelta: true, purchaseBatchItemId: true, unitCostTwd: true, orderItemId: true, orderItem: { select: { estUnitCostTwd: true } } },
  });
  const landed = await landedCosts(db as Tx, [...new Set(monthMoves.map((m) => m.purchaseBatchItemId).filter(Boolean) as string[])]);
  let cogs = 0;
  let estimatedUnits = 0;
  for (const m of monthMoves) {
    const meta = itemMeta.get(m.orderItemId!);
    const { cost, estimatedUnits: eu } = costOfMove(landed, {
      qty: -m.onHandDelta,
      purchaseBatchItemId: m.purchaseBatchItemId,
      unitCostTwd: m.unitCostTwd,
      estUnitCostTwd: m.orderItem?.estUnitCostTwd ?? null,
    });
    cogs += cost;
    estimatedUnits += eu;
    if (meta) {
      const c = byCategory.get(meta.categoryId);
      if (c) c.cost += cost;
      const p = byProduct.get(meta.productId);
      if (p) p.cost += cost;
    }
  }

  const expensesAgg = await db.expense.aggregate({ where: { date: { gte: start, lt: end } }, _sum: { amountTwd: true } });
  // 採購團裡「不攤，單獨記」的運費等費用：以登記日期算進當月其他費用
  const loneFees = await db.batchCost.findMany({
    where: { method: "NONE", createdAt: { gte: start, lt: end }, batch: { status: { not: "CANCELLED" } } },
    select: { id: true, currency: true, amount: true, kind: true, note: true, createdAt: true, batch: { select: { id: true, code: true, name: true, rateMicro: true } } },
  });
  const batchFeeItems = loneFees.map((c) => ({ id: c.id, date: c.createdAt, kind: c.kind, note: c.note, batch: c.batch, amountTwd: feeTwd(c, c.batch.rateMicro) }));
  const batchFeesTwd = batchFeeItems.reduce((x, c) => x + c.amountTwd, 0);
  const expenses = (expensesAgg._sum.amountTwd ?? 0) + batchFeesTwd;

  // 現金流（與營收分開）
  const [payAgg, refundAgg] = await Promise.all([
    db.payment.aggregate({ where: { paidAt: { gte: start, lt: end }, voidedAt: null }, _sum: { amount: true } }),
    db.refund.aggregate({ where: { status: "COMPLETED", completedAt: { gte: start, lt: end } }, _sum: { amount: true } }),
  ]);

  // 本月新訂單（以訂單日期計）的有效訂購金額，依買家
  const newOrders = await db.order.findMany({
    where: { orderedAt: { gte: start, lt: end }, confirmation: "CONFIRMED" },
    select: { receivableCache: true, buyer: { select: { id: true, name: true } } },
  });
  const byBuyer = new Map<string, { name: string; amount: number; orders: number }>();
  let bookedSales = 0;
  for (const o of newOrders) {
    bookedSales += o.receivableCache;
    const b = byBuyer.get(o.buyer.id) ?? { name: o.buyer.name, amount: 0, orders: 0 };
    b.amount += o.receivableCache;
    b.orders += 1;
    byBuyer.set(o.buyer.id, b);
  }

  return {
    ym,
    revenue, // 已實現營收（含運費收入）
    shippingIncome,
    cogs,
    estimatedCostUnits: estimatedUnits,
    expenses,
    batchFeeItems,
    grossProfit: revenue - cogs,
    realizedProfit: revenue - cogs - expenses,
    bookedSales,
    cashIn: payAgg._sum.amount ?? 0,
    cashOut: refundAgg._sum.amount ?? 0,
    byCategory: [...byCategory.values()].sort((a, b) => b.revenue - a.revenue),
    byProduct: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
    byBuyer: [...byBuyer.values()].sort((a, b) => b.amount - a.amount),
  };
}

/** 預估未實現利潤：已確認、尚未出貨的部分，以建單時的預估成本計算 */
export async function unrealizedEstimate(db: Db) {
  const orders = await db.order.findMany({
    where: { confirmation: "CONFIRMED", statusCache: { notIn: ["COMPLETED", "CANCELLED"] } },
    include: { items: true, payments: { select: { amount: true, voidedAt: true } }, refunds: { select: { amount: true, status: true } } },
  });
  let revenue = 0;
  let cost = 0;
  let unknownCostUnits = 0;
  for (const o of orders) {
    const calc: OrderResult = computeOrder({
      confirmation: o.confirmation,
      shippingFee: o.shippingFee,
      orderDiscount: o.orderDiscount,
      items: o.items.map((it) => ({
        id: it.id,
        qty: it.qty,
        unitPrice: it.unitPrice,
        lineDiscount: it.lineDiscount,
        cancelledQty: it.cancelledQtyCache,
        reservedQty: it.reservedQtyCache,
        shippedQty: it.shippedQtyCache,
        purchaseFlag: it.purchaseFlag,
        packFlag: it.packFlag,
      })),
      payments: o.payments.map((p) => ({ amount: p.amount, voided: !!p.voidedAt })),
      refunds: o.refunds.map((r) => ({ amount: r.amount, status: r.status })),
    });
    const shipped = new Map(o.items.map((it) => [it.id, it.shippedQtyCache]));
    revenue += calc.receivable - realizedRevenue(calc, shipped);
    calc.items.forEach((ci, idx) => {
      const left = ci.activeQty - Math.min(o.items[idx].shippedQtyCache, ci.activeQty);
      if (left <= 0) return;
      if (o.items[idx].estUnitCostTwd === null) unknownCostUnits += left;
      cost += left * (o.items[idx].estUnitCostTwd ?? 0);
    });
  }
  return { revenue, cost, profit: revenue - cost, unknownCostUnits };
}

export async function receivablesSnapshot(db: Db) {
  const agg = await db.order.aggregate({
    where: { confirmation: { not: "PENDING" } },
    _sum: { receivableCache: true, paidCache: true, refundedCache: true, balanceCache: true, refundDueCache: true, refundPendingCache: true },
  });
  return {
    receivable: agg._sum.receivableCache ?? 0,
    netReceived: (agg._sum.paidCache ?? 0) - (agg._sum.refundedCache ?? 0),
    balance: agg._sum.balanceCache ?? 0,
    refundDue: agg._sum.refundDueCache ?? 0,
    refundPending: agg._sum.refundPendingCache ?? 0,
  };
}

export async function dashboard(db: Db) {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86400000);
  const ym = currentYm();
  const [pendingConfirm, unpaidOrders, toShipItems, refundPending, refundUnscheduled, closingGroupBuys, incomingBatches, upcomingProducts, purchaseNeeds, month, snap] = await Promise.all([
    db.order.count({ where: { confirmation: "PENDING" } }),
    db.order.count({ where: { confirmation: "CONFIRMED", balanceCache: { gt: 0 } } }),
    db.orderItem.findMany({ where: { reservedQtyCache: { gt: 0 }, order: { confirmation: "CONFIRMED" } }, select: { reservedQtyCache: true, order: { select: { buyerId: true } } } }),
    db.refund.count({ where: { status: "PENDING" } }),
    db.order.count({ where: { refundDueCache: { gt: 0 }, refundPendingCache: 0 } }),
    db.groupBuy.findMany({ where: { status: "OPEN", closeAt: { not: null, lte: soon } }, orderBy: { closeAt: "asc" }, take: 8 }),
    db.purchaseBatch.findMany({ where: { status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } }, orderBy: { orderedAt: "asc" }, take: 8 }),
    db.product.findMany({ where: { archivedAt: null, actualArrivalDate: null, expectedArrivalDate: { not: null, lte: new Date(now.getTime() + 14 * 86400000) } }, orderBy: { expectedArrivalDate: "asc" }, take: 8 }),
    db.orderItem.findMany({
      where: { order: { confirmation: "CONFIRMED" }, purchaseFlag: { not: "ORDERED" } },
      select: { productId: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, reservedQtyCache: true },
    }),
    monthlyReport(db, ym),
    receivablesSnapshot(db),
  ]);
  const toShipQty = toShipItems.reduce((s, i) => s + i.reservedQtyCache, 0);
  const toShipBuyers = new Set(toShipItems.map((i) => i.order.buyerId)).size;
  const needProducts = new Set(purchaseNeeds.filter((i) => i.qty - i.cancelledQtyCache - i.shippedQtyCache - i.reservedQtyCache > 0).map((i) => i.productId)).size;
  return { ym, pendingConfirm, unpaidOrders, toShipQty, toShipBuyers, refundPending, refundUnscheduled, closingGroupBuys, incomingBatches, upcomingProducts, needProducts, month, snap };
}

// ── 庫存估值 ──
export interface ProductValuation {
  onHand: number; // 實際在庫（不含自留）
  reserved: number; // 已保留給買家
  free: number; // 可售
  kept: number; // 自留
  freeValue: number; // 可售部分的成本（台幣）
  reservedValue: number;
  keptValue: number;
  avgUnitCost: number | null; // 目前持有（在庫＋自留）的加權平均單件成本
  tentative: boolean; // 含暫估成本（實際單價未確認或該團未登記費用）
  unknownCostUnits: number; // 手動入庫且沒有填成本的件數
}

/**
 * 依成本批次計算庫存估值：每個批次的單件成本 = 該採購品項的完整成本（商品＋分攤費用）÷ 有效數量；
 * 手動入庫以填寫的成本加權平均。與出貨時的銷貨成本使用同一套口徑。
 */
export async function stockValuation(db: Db, productIds?: string[]) {
  const t = db as Tx;
  const where = productIds ? { productId: { in: productIds } } : {};
  const [lots, keeps, manualIn] = await Promise.all([
    t.inventoryMovement.groupBy({ by: ["productId", "purchaseBatchItemId"], where, _sum: { onHandDelta: true, reservedDelta: true } }),
    t.inventoryMovement.groupBy({ by: ["productId", "purchaseBatchItemId"], where: { ...where, kind: "KEEP" }, _sum: { onHandDelta: true } }),
    t.inventoryMovement.findMany({ where: { ...where, purchaseBatchItemId: null, onHandDelta: { gt: 0 }, unitCostTwd: { not: null }, kind: { in: ["RECEIVE", "ADJUST"] } }, select: { productId: true, onHandDelta: true, unitCostTwd: true } }),
  ]);
  const lotIds = [...new Set(lots.map((l) => l.purchaseBatchItemId).filter(Boolean) as string[])];
  const landed = await landedCosts(t, lotIds);
  const info = lotIds.length ? await t.purchaseBatchItem.findMany({ where: { id: { in: lotIds } }, select: { id: true, actualUnitCost: true, batch: { select: { costs: { select: { id: true }, take: 1 } } } } }) : [];
  const tentativeLot = new Set(info.filter((i) => i.actualUnitCost === null || i.batch.costs.length === 0).map((i) => i.id));
  const manualAvg = new Map<string, { qty: number; sum: number }>();
  for (const m of manualIn) {
    const v = manualAvg.get(m.productId) ?? { qty: 0, sum: 0 };
    v.qty += m.onHandDelta;
    v.sum += m.onHandDelta * (m.unitCostTwd ?? 0);
    manualAvg.set(m.productId, v);
  }
  const keptBy = new Map(keeps.map((k) => [`${k.productId}|${k.purchaseBatchItemId ?? ""}`, -(k._sum.onHandDelta ?? 0) || 0]));
  const out = new Map<string, ProductValuation & { _qty: number; _val: number }>();
  for (const l of lots) {
    const v = out.get(l.productId) ?? { onHand: 0, reserved: 0, free: 0, kept: 0, freeValue: 0, reservedValue: 0, keptValue: 0, avgUnitCost: null, tentative: false, unknownCostUnits: 0, _qty: 0, _val: 0 };
    const on = l._sum.onHandDelta ?? 0;
    const rs = l._sum.reservedDelta ?? 0;
    const kp = keptBy.get(`${l.productId}|${l.purchaseBatchItemId ?? ""}`) ?? 0;
    const free = on - rs;
    // 以整數比例計算（與出貨成本 costOfMove 相同），不使用浮點單價
    let valueOf: ((q: number) => number) | null = null;
    if (l.purchaseBatchItemId) {
      const lc = landed.get(l.purchaseBatchItemId);
      if (lc && lc.qty > 0) valueOf = (q) => mulDiv(lc.totalTwd, q, lc.qty);
      if (tentativeLot.has(l.purchaseBatchItemId) && on + kp > 0) v.tentative = true;
    } else {
      const m = manualAvg.get(l.productId);
      if (m && m.qty > 0) valueOf = (q) => mulDiv(m.sum, q, m.qty);
      else v.unknownCostUnits += Math.max(0, on + kp);
    }
    v.onHand += on;
    v.reserved += rs;
    v.free += free;
    v.kept += kp;
    if (valueOf) {
      v.freeValue += valueOf(free);
      v.reservedValue += valueOf(rs);
      v.keptValue += valueOf(kp);
      v._qty += on + kp;
      v._val += valueOf(on + kp);
    }
    out.set(l.productId, v);
  }
  const result = new Map<string, ProductValuation>();
  const total = { free: 0, reserved: 0, kept: 0, freeValue: 0, reservedValue: 0, keptValue: 0, tentative: false, unknownCostUnits: 0 };
  for (const [id, v] of out) {
    const r: ProductValuation = {
      onHand: v.onHand,
      reserved: v.reserved,
      free: v.free,
      kept: v.kept,
      freeValue: v.freeValue,
      reservedValue: v.reservedValue,
      keptValue: v.keptValue,
      avgUnitCost: v._qty > 0 ? divRound(v._val, v._qty) : null,
      tentative: v.tentative,
      unknownCostUnits: v.unknownCostUnits,
    };
    result.set(id, r);
    total.free += r.free;
    total.reserved += r.reserved;
    total.kept += r.kept;
    total.freeValue += r.freeValue;
    total.reservedValue += r.reservedValue;
    total.keptValue += r.keptValue;
    total.tentative ||= r.tentative;
    total.unknownCostUnits += r.unknownCostUnits;
  }
  return { byProduct: result, total };
}
