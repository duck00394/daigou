// 預購成本與客人預訂預估可賺
// 預購平均成本＝（現有＋一定到）的加權平均，含攤進去的運費、關稅；對單還沒確定的「不一定」不算
import type { Tx } from "@/server/db";
import { stockValuation } from "./reports";
import { landedCosts } from "./purchase";
import { pendingQty } from "./batch-ops";

export type PreorderCost = { avg: number; tentative: boolean };

export async function preorderCosts(t: Tx, productIds: string[]) {
  return (await preorderDetail(t, productIds)).costs;
}

/** 預購成本＋每個商品一定到（對單買到、還沒到）的件數 */
export async function preorderDetail(t: Tx, productIds: string[]) {
  const ids = [...new Set(productIds)];
  const out = new Map<string, PreorderCost>();
  const sureQty = new Map<string, number>();
  if (!ids.length) return { costs: out, sureQty };
  const [val, items] = await Promise.all([
    stockValuation(t, ids),
    t.purchaseBatchItem.findMany({
      where: { productId: { in: ids }, batch: { status: { not: "CANCELLED" } } },
      select: { id: true, productId: true, qty: true, cancelledQty: true, confirmedQty: true, actualUnitCost: true, batch: { select: { status: true, supplierRef: { select: { kind: true } }, costs: { select: { id: true }, take: 1 } } }, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
    }),
  ]);
  const landed = await landedCosts(t, items.map((i) => i.id));
  const sure = new Map<string, { qty: number; val: number; tentative: boolean }>();
  for (const i of items) {
    const rec = i.movements.reduce((a, m) => a + m.onHandDelta, 0);
    const q = Math.max(0, i.qty - i.cancelledQty - rec - pendingQty(i, rec));
    const l = landed.get(i.id);
    if (!q || !l || l.qty <= 0) continue;
    const v = sure.get(i.productId) ?? { qty: 0, val: 0, tentative: false };
    v.qty += q;
    v.val += (l.totalTwd * q) / l.qty;
    if (i.actualUnitCost === null || !i.batch.costs.length) v.tentative = true;
    sure.set(i.productId, v);
  }
  for (const id of ids) {
    const h = val.byProduct.get(id);
    const s = sure.get(id);
    const hq = h?.avgUnitCost != null ? Math.max(0, h.onHand) : 0;
    const q = hq + (s?.qty ?? 0);
    if (q > 0) out.set(id, { avg: Math.round((hq * (h?.avgUnitCost ?? 0) + (s?.val ?? 0)) / q), tentative: !!(s?.tentative || (hq && h?.tentative)) });
    else if (h?.avgUnitCost != null) out.set(id, { avg: h.avgUnitCost, tentative: h.tentative });
    if (s?.qty) sureQty.set(id, s.qty);
  }
  return { costs: out, sureQty };
}

export type ProfitLine = { productId: string; name: string; qty: number; revenue: number; cost: number | null; tentative: boolean };
export type ProfitBuyer = { id: string; name: string; channel: string | null; qty: number; revenue: number; cost: number; profit: number; uncosted: number };

/** 客人預訂還沒給的：預訂金額、成本（預購平均成本）、預估可賺；沒有成本的件數另外算 */
export async function preorderProfit(t: Tx) {
  const rows = await t.orderItem.findMany({
    where: { order: { confirmation: "CONFIRMED", statusCache: { not: "CANCELLED" } } },
    select: { productId: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, unitPrice: true, product: { select: { name: true } }, order: { select: { salesChannel: true, buyer: { select: { id: true, name: true, salesChannel: true } } } } },
  });
  const open = rows.map((r) => ({ ...r, open: Math.max(0, r.qty - r.cancelledQtyCache - r.shippedQtyCache) })).filter((r) => r.open > 0);
  const costs = await preorderCosts(t, open.map((r) => r.productId));
  const buyers = new Map<string, ProfitBuyer>();
  const products = new Map<string, ProfitLine>();
  const total = { qty: 0, revenue: 0, cost: 0, costedRevenue: 0, uncosted: 0, tentative: false };
  for (const r of open) {
    const c = costs.get(r.productId);
    const revenue = r.open * r.unitPrice;
    const cost = c ? c.avg * r.open : null;
    total.qty += r.open;
    total.revenue += revenue;
    if (cost === null) total.uncosted += r.open;
    else {
      total.cost += cost;
      total.costedRevenue += revenue;
      if (c!.tentative) total.tentative = true;
    }
    const by = r.order.buyer;
    const b = buyers.get(by.id) ?? { id: by.id, name: by.name, channel: r.order.salesChannel ?? by.salesChannel, qty: 0, revenue: 0, cost: 0, profit: 0, uncosted: 0 };
    b.qty += r.open;
    b.revenue += revenue;
    if (cost === null) b.uncosted += r.open;
    else {
      b.cost += cost;
      b.profit += revenue - cost;
    }
    buyers.set(by.id, b);
    const p = products.get(r.productId) ?? { productId: r.productId, name: r.product.name, qty: 0, revenue: 0, cost: c ? 0 : null, tentative: !!c?.tentative };
    p.qty += r.open;
    p.revenue += revenue;
    if (p.cost !== null && cost !== null) p.cost += cost;
    products.set(r.productId, p);
  }
  return {
    ...total,
    profit: total.costedRevenue - total.cost,
    buyers: [...buyers.values()].sort((a, b) => b.revenue - a.revenue),
    products: [...products.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

export type SeriesProduct = {
  id: string;
  onHand: number; // 現有（不含自留）
  sure: number; // 一定到
  ordered: number; // 客人訂還沒給
  left: number; // 庫存＝現有＋一定到－客人訂
  sold: { qty: number; revenue: number; cost: number };
  pre: { qty: number; revenue: number; cost: number | null };
  free: { qty: number; revenue: number | null; cost: number | null }; // 還沒人訂的（照售價）
  price: number | null;
  avg: number | null;
  profit: number; // 算得出來的部分加總
};

/** 一個系列：已經賣掉、客人預訂、還沒人訂的（現有＋一定到），各收多少、成本多少、可賺多少 */
export async function seriesProfit(t: Tx, categoryId: string) {
  const [linked, bought, typePrices] = await Promise.all([
    t.productCategory.findMany({ where: { categoryId }, select: { productId: true } }),
    t.purchaseBatchItem.findMany({ where: { OR: [{ categoryId }, { categoryId: null, batch: { categoryId } }] }, select: { productId: true } }),
    t.categoryTypePrice.findMany({ where: { categoryId }, select: { productTypeId: true, salePriceTwd: true } }),
  ]);
  const ids = [...new Set([...linked, ...bought].map((x) => x.productId))];
  const tp = new Map(typePrices.map((x) => [x.productTypeId, x.salePriceTwd]));
  const [products, detail, stock, moves, orderItems] = await Promise.all([
    t.product.findMany({ where: { id: { in: ids } }, select: { id: true, salePriceTwd: true, productTypeId: true } }),
    preorderDetail(t, ids),
    t.inventoryMovement.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _sum: { onHandDelta: true } }),
    t.inventoryMovement.findMany({ where: { productId: { in: ids }, kind: "SHIP", orderItemId: { not: null } }, select: { productId: true, onHandDelta: true, purchaseBatchItemId: true, unitCostTwd: true, orderItem: { select: { id: true, unitPrice: true, estUnitCostTwd: true } } } }),
    t.orderItem.findMany({ where: { productId: { in: ids }, order: { confirmation: "CONFIRMED", statusCache: { not: "CANCELLED" } } }, select: { productId: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, unitPrice: true } }),
  ]);
  // 已經賣掉：出貨流水（作廢退回的會抵掉）× 成交價；成本照出貨批次
  const lots = [...new Set(moves.map((m) => m.purchaseBatchItemId).filter((x): x is string => !!x))];
  const landed = await landedCosts(t, lots);
  const { costOfMove } = await import("./reports");
  const net = new Map<string, { productId: string; qty: number; lot: string | null; unitCost: number | null; price: number; est: number | null }>();
  for (const m of moves) {
    const k = `${m.orderItem!.id}|${m.purchaseBatchItemId ?? ""}|${m.unitCostTwd ?? ""}`;
    const v = net.get(k) ?? { productId: m.productId, qty: 0, lot: m.purchaseBatchItemId, unitCost: m.unitCostTwd, price: m.orderItem!.unitPrice, est: m.orderItem!.estUnitCostTwd };
    v.qty -= m.onHandDelta;
    net.set(k, v);
  }
  const sold = new Map<string, { qty: number; revenue: number; cost: number }>();
  for (const v of net.values()) {
    if (v.qty <= 0) continue;
    const x = sold.get(v.productId) ?? { qty: 0, revenue: 0, cost: 0 };
    x.qty += v.qty;
    x.revenue += v.qty * v.price;
    x.cost += costOfMove(landed, { qty: v.qty, purchaseBatchItemId: v.lot, unitCostTwd: v.unitCost, estUnitCostTwd: v.est }).cost;
    sold.set(v.productId, x);
  }
  const onHandOf = new Map(stock.map((x) => [x.productId, x._sum.onHandDelta ?? 0]));
  const pre = new Map<string, { qty: number; revenue: number }>();
  for (const o of orderItems) {
    const q = Math.max(0, o.qty - o.cancelledQtyCache - o.shippedQtyCache);
    if (!q) continue;
    const x = pre.get(o.productId) ?? { qty: 0, revenue: 0 };
    x.qty += q;
    x.revenue += q * o.unitPrice;
    pre.set(o.productId, x);
  }
  const rows = new Map<string, SeriesProduct>();
  for (const p of products) {
    const c = detail.costs.get(p.id);
    const onHand = Math.max(0, onHandOf.get(p.id) ?? 0);
    const sure = detail.sureQty.get(p.id) ?? 0;
    const pr = pre.get(p.id) ?? { qty: 0, revenue: 0 };
    const sd = sold.get(p.id) ?? { qty: 0, revenue: 0, cost: 0 };
    const left = onHand + sure - pr.qty;
    const freeQty = Math.max(0, left);
    const price = p.salePriceTwd ?? (p.productTypeId ? (tp.get(p.productTypeId) ?? null) : null);
    const preCost = c ? c.avg * pr.qty : null;
    const freeCost = c ? c.avg * freeQty : null;
    const freeRev = price != null ? price * freeQty : null;
    let profit = sd.revenue - sd.cost;
    if (preCost != null) profit += pr.revenue - preCost;
    if (freeCost != null && freeRev != null) profit += freeRev - freeCost;
    rows.set(p.id, { id: p.id, onHand, sure, ordered: pr.qty, left, sold: sd, pre: { ...pr, cost: preCost }, free: { qty: freeQty, revenue: freeRev, cost: freeCost }, price, avg: c?.avg ?? null, profit });
  }
  return { rows, ...seriesTotals([...rows.values()]) };
}

/** 把幾個角色加總成「預估可賺」卡片的數字（系列頁只加總表格裡列出來的，上下對得起來） */
export function seriesTotals(list: SeriesProduct[]) {
  const total = {
    sold: { qty: 0, revenue: 0, cost: 0 },
    pre: { qty: 0, revenue: 0, cost: 0, uncosted: 0 },
    free: { qty: 0, revenue: 0, cost: 0, unpriced: 0, uncosted: 0 },
  };
  for (const r of list) {
    total.sold.qty += r.sold.qty;
    total.sold.revenue += r.sold.revenue;
    total.sold.cost += r.sold.cost;
    total.pre.qty += r.pre.qty;
    if (r.pre.cost == null) total.pre.uncosted += r.pre.qty;
    else {
      total.pre.revenue += r.pre.revenue;
      total.pre.cost += r.pre.cost;
    }
    total.free.qty += r.free.qty;
    if (r.free.qty && r.free.cost == null) total.free.uncosted += r.free.qty;
    else if (r.free.qty && r.free.revenue == null) total.free.unpriced += r.free.qty;
    else if (r.free.qty) {
      total.free.revenue += r.free.revenue!;
      total.free.cost += r.free.cost!;
    }
  }
  const revenue = total.sold.revenue + total.pre.revenue + total.free.revenue;
  const cost = total.sold.cost + total.pre.cost + total.free.cost;
  return { ...total, revenue, cost, profit: revenue - cost };
}
