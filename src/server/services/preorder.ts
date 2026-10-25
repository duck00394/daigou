// 預購成本與客人預訂預估可賺
// 預購平均成本＝（現有＋一定到）的加權平均，含攤進去的運費、關稅；對單還沒確定的「不一定」不算
import type { Tx } from "@/server/db";
import { stockValuation } from "./reports";
import { landedCosts } from "./purchase";
import { pendingQty } from "./batch-ops";

export type PreorderCost = { avg: number; tentative: boolean };

export async function preorderCosts(t: Tx, productIds: string[]) {
  const ids = [...new Set(productIds)];
  const out = new Map<string, PreorderCost>();
  if (!ids.length) return out;
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
  }
  return out;
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
