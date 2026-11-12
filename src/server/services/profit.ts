// 賺多少：照系列算。每張單＝已出貨的（實際成本）＋還沒給的（預估：預購平均成本）
// 收入用商品售價×件數（跟現貨出售、客人預訂同一套；運費不算，多半是付給賣貨便的）
import type { Tx } from "@/server/db";
import { landedCosts } from "./purchase";
import { costOfMove } from "./reports";
import { lotOwners } from "./ownership";
import { preorderDetail } from "./preorder";

export type Part = { qty: number; revenue: number; cost: number; uncosted: number; tentative: boolean };
const zero = (): Part => ({ qty: 0, revenue: 0, cost: 0, uncosted: 0, tentative: false });
const add = (a: Part, b: Part) => {
  a.qty += b.qty;
  a.revenue += b.revenue;
  a.cost += b.cost;
  a.uncosted += b.uncosted;
  a.tentative ||= b.tentative;
};
export const profitOf = (p: Part) => p.revenue - p.cost;

export type OrderProfit = { id: string; orderNo: string; buyer: string; source: string; orderedAt: Date; balance: number; shipped: Part; open: Part };
export type SeriesRow = { id: string | null; name: string; shipped: Part; open: Part };

/** owner：看某個人（出貨的照貨是誰的，還沒給的照跟誰訂的；含合資）；categoryId：只看這個系列的商品 */
export async function orderProfits(t: Tx, opts: { owner?: string | null; categoryId?: string | null; orderId?: string | null } = {}) {
  const items = await t.orderItem.findMany({
    where: {
      order: { confirmation: "CONFIRMED", statusCache: { not: "CANCELLED" }, ...(opts.orderId ? { id: opts.orderId } : {}) },
      ...(opts.categoryId ? { OR: [{ categoryId: opts.categoryId }, { categoryId: null, product: { categories: { some: { categoryId: opts.categoryId } } } }] } : {}),
    },
    select: {
      id: true,
      orderId: true,
      productId: true,
      qty: true,
      cancelledQtyCache: true,
      shippedQtyCache: true,
      unitPrice: true,
      estUnitCostTwd: true,
      ownerKey: true,
      category: { select: { id: true, name: true } },
      product: { select: { categories: { select: { category: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" }, take: 1 } } },
      order: { select: { id: true, orderNo: true, source: true, orderedAt: true, balanceCache: true, buyer: { select: { name: true } } } },
    },
  });
  const ids = items.map((i) => i.id);
  const moves = ids.length ? await t.inventoryMovement.findMany({ where: { kind: "SHIP", orderItemId: { in: ids } }, select: { orderItemId: true, onHandDelta: true, purchaseBatchItemId: true, unitCostTwd: true } }) : [];
  const lots = [...new Set(moves.map((m) => m.purchaseBatchItemId).filter(Boolean) as string[])];
  const [landed, owners] = await Promise.all([landedCosts(t, lots), lotOwners(t, lots)]);
  const tentativeLots = new Set(
    (lots.length ? await t.purchaseBatchItem.findMany({ where: { id: { in: lots } }, select: { id: true, actualUnitCost: true, batch: { select: { costs: { select: { id: true }, take: 1 } } } } }) : [])
      .filter((b) => b.actualUnitCost === null || !b.batch.costs.length)
      .map((b) => b.id),
  );
  const keys = opts.owner ? [opts.owner, "joint", "none"] : null;
  // 還沒給的成本：跟「客人預訂」卡片同一套（看某個人只用他的貨、他的團）
  const openIds = items.filter((i) => i.qty - i.cancelledQtyCache - i.shippedQtyCache > 0).map((i) => i.productId);
  const costs = opts.owner
    ? (await preorderDetail(t, openIds, { owner: opts.owner, itemWhere: { batch: { OR: [{ ownership: "JOINT" }, { orderedById: null }, { ownership: "PERSONAL", orderedById: opts.owner }] } } })).costs
    : (await preorderDetail(t, openIds)).costs;

  const byItem = new Map<string, typeof moves>();
  for (const m of moves) byItem.set(m.orderItemId!, [...(byItem.get(m.orderItemId!) ?? []), m]);
  const orders = new Map<string, OrderProfit>();
  const series = new Map<string, SeriesRow>();
  for (const it of items) {
    const sc = it.category ?? it.product.categories[0]?.category ?? null;
    const shipped = zero();
    for (const m of byItem.get(it.id) ?? []) {
      const qty = -m.onHandDelta;
      const key = m.purchaseBatchItemId ? (owners.get(m.purchaseBatchItemId)?.key ?? "none") : "none";
      if (keys && !keys.includes(key)) continue;
      const c = costOfMove(landed, { qty, purchaseBatchItemId: m.purchaseBatchItemId, unitCostTwd: m.unitCostTwd, estUnitCostTwd: it.estUnitCostTwd });
      add(shipped, { qty, revenue: qty * it.unitPrice, cost: c.cost, uncosted: 0, tentative: c.estimatedUnits > 0 || (!!m.purchaseBatchItemId && tentativeLots.has(m.purchaseBatchItemId)) });
    }
    const open = zero();
    const n = Math.max(0, it.qty - it.cancelledQtyCache - it.shippedQtyCache);
    if (n > 0 && (!keys || (!!it.ownerKey && keys.includes(it.ownerKey)))) {
      const c = costs.get(it.productId);
      // 沒有成本的（還沒買、不一定到）只記件數，不算進收入，免得賺多少虛高
      add(open, c ? { qty: n, revenue: n * it.unitPrice, cost: c.avg * n, uncosted: 0, tentative: c.tentative } : { qty: 0, revenue: 0, cost: 0, uncosted: n, tentative: false });
    }
    if (!shipped.qty && !open.qty && !open.uncosted) continue;
    const o = orders.get(it.orderId) ?? { id: it.order.id, orderNo: it.order.orderNo, buyer: it.order.buyer.name, source: it.order.source, orderedAt: it.order.orderedAt, balance: it.order.balanceCache, shipped: zero(), open: zero() };
    add(o.shipped, shipped);
    add(o.open, open);
    orders.set(it.orderId, o);
    const sk = sc?.id ?? "-";
    const s = series.get(sk) ?? { id: sc?.id ?? null, name: sc?.name ?? "沒分系列", shipped: zero(), open: zero() };
    add(s.shipped, shipped);
    add(s.open, open);
    series.set(sk, s);
  }
  const total = { shipped: zero(), open: zero() };
  for (const s of series.values()) {
    add(total.shipped, s.shipped);
    add(total.open, s.open);
  }
  const list = [...orders.values()].sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime());
  return {
    total,
    unpaid: list.reduce((a, o) => a + Math.max(0, o.balance), 0),
    orders: list,
    series: [...series.values()].sort((a, b) => profitOf(b.shipped) + profitOf(b.open) - (profitOf(a.shipped) + profitOf(a.open))),
  };
}
