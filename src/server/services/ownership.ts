// 歸屬：每一件庫存來自哪個採購團，就歸那一團的主人。
// - 個人團：歸「這團是誰的」（PurchaseBatch.orderedById）。
// - 合資團：品項有指定「誰的」就歸那個人；一起的庫存件數列在「合資」，賣掉的錢照這團「一起的」比例分（沒設＝平均）。
// - 手動入庫（不屬於任何採購團）：歸「未指定」。
import type { Tx } from "@/server/db";
import { allocate } from "@/lib/money";
import type { Lot } from "./inventory";

export const JOINT = "joint";
export const NONE = "none";
export type OwnerKey = string; // 經營者 id、JOINT 或 NONE

export function batchOwnerKey(b: { ownership: string; orderedById: string | null }): OwnerKey {
  return b.ownership === "JOINT" ? JOINT : (b.orderedById ?? NONE);
}

/** 採購品項（成本批次）→ 歸屬 */
export async function lotOwners(t: Tx, batchItemIds: (string | null)[]) {
  const ids = [...new Set(batchItemIds.filter(Boolean) as string[])];
  const rows = ids.length ? await t.purchaseBatchItem.findMany({ where: { id: { in: ids } }, select: { id: true, ownerId: true, batch: { select: { id: true, ownership: true, orderedById: true } } } }) : [];
  const m = new Map<string, { key: OwnerKey; batchId: string }>();
  // 合資團裡指定了「誰的」的品項，就歸那個人；一起的歸合資
  for (const r of rows) m.set(r.id, { key: r.batch.ownership === "JOINT" && r.ownerId ? r.ownerId : batchOwnerKey(r.batch), batchId: r.batch.id });
  return m;
}

export const ownerOfLot = (owners: Map<string, { key: OwnerKey }>, batchItemId: string | null): OwnerKey => (batchItemId ? (owners.get(batchItemId)?.key ?? NONE) : NONE);

/** 只留下屬於某人的成本批次（owner 為空＝不限） */
export async function filterLotsByOwner(t: Tx, lots: Lot[], owner: OwnerKey | null | undefined) {
  if (!owner) return lots;
  const owners = await lotOwners(t, lots.map((l) => l.batchItemId));
  return lots.filter((l) => ownerOfLot(owners, l.batchItemId) === owner);
}

/** 合資團的分配權重：各經營者實際付給代購的台幣金額（已付款；日幣用該筆實際匯率，沒有就用該團匯率） */

/** 依權重把整數金額分給各人（最大餘數法，合計不變）；沒有權重時回傳 null */
export function splitByWeights(amount: number, weights: Map<OwnerKey, number> | undefined): Map<OwnerKey, number> | null {
  if (!weights || weights.size === 0) return null;
  const keys = [...weights.keys()];
  const vals = keys.map((k) => Math.max(0, weights.get(k) ?? 0));
  if (vals.every((v) => v === 0)) return null;
  const neg = amount < 0;
  const parts = allocate(Math.abs(amount), vals);
  return new Map(keys.map((k, i) => [k, neg ? -parts[i] : parts[i]]));
}

/** 合資團各人比例（百分比字串，例「阿珍 60%・阿強 40%」用） */
export function sharePercents(weights: Map<OwnerKey, number> | undefined) {
  if (!weights) return [];
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return [...weights.entries()].map(([k, v]) => ({ key: k, amount: v, percent: Math.round((v * 1000) / total) / 10 }));
}

export interface OwnerStock {
  onHand: number;
  reserved: number;
  free: number;
  kept: number;
}

/** 各商品依歸屬分開的庫存（可售、已保留、自留） */
export async function stockByOwner(t: Tx, opts: { productIds?: string[]; batchItemIds?: string[] } = {}) {
  const where = {
    ...(opts.productIds ? { productId: { in: opts.productIds } } : {}),
    ...(opts.batchItemIds ? { purchaseBatchItemId: { in: opts.batchItemIds } } : {}),
  };
  const [lots, keeps] = await Promise.all([
    t.inventoryMovement.groupBy({ by: ["productId", "purchaseBatchItemId"], where, _sum: { onHandDelta: true, reservedDelta: true } }),
    t.inventoryMovement.groupBy({ by: ["productId", "purchaseBatchItemId"], where: { ...where, kind: "KEEP" }, _sum: { onHandDelta: true } }),
  ]);
  const owners = await lotOwners(t, lots.map((l) => l.purchaseBatchItemId));
  const keptBy = new Map(keeps.map((k) => [`${k.productId}|${k.purchaseBatchItemId ?? ""}`, -(k._sum.onHandDelta ?? 0) || 0]));
  const out = new Map<string, Map<OwnerKey, OwnerStock>>();
  for (const l of lots) {
    const key = ownerOfLot(owners, l.purchaseBatchItemId);
    const per = out.get(l.productId) ?? new Map<OwnerKey, OwnerStock>();
    const v = per.get(key) ?? { onHand: 0, reserved: 0, free: 0, kept: 0 };
    const on = l._sum.onHandDelta ?? 0;
    const rs = l._sum.reservedDelta ?? 0;
    v.onHand += on;
    v.reserved += rs;
    v.free += on - rs;
    v.kept += keptBy.get(`${l.productId}|${l.purchaseBatchItemId ?? ""}`) ?? 0;
    per.set(key, v);
    out.set(l.productId, per);
  }
  return out;
}

export interface OwnerMoney {
  qty: number;
  revenue: number;
  cost: number;
}

/**
 * 建立歸屬分配器：先一次查好成本批次的主人與合資付款比例，之後同步分配多筆流水。
 * 合資團的收入與成本依付款比例拆；件數記在「合資」。還沒登記付款的合資團，金額記在 JOINT。
 */
export async function ownerAttributor(t: Tx, batchItemIds: (string | null)[]) {
  const owners = await lotOwners(t, batchItemIds);
  const { jointSplitWeights } = await import("./joint");
  const weights = await jointSplitWeights(t, [...owners.values()].filter((o) => o.key === JOINT).map((o) => o.batchId));
  return (moves: { purchaseBatchItemId: string | null; qty: number; revenue: number; cost: number }[]) => {
    const out = new Map<OwnerKey, OwnerMoney>();
    const add = (k: OwnerKey, qty: number, revenue: number, cost: number) => {
      const v = out.get(k) ?? { qty: 0, revenue: 0, cost: 0 };
      v.qty += qty;
      v.revenue += revenue;
      v.cost += cost;
      out.set(k, v);
    };
    for (const m of moves) {
      const o = m.purchaseBatchItemId ? owners.get(m.purchaseBatchItemId) : undefined;
      const key = o?.key ?? NONE;
      if (key !== JOINT) {
        add(key, m.qty, m.revenue, m.cost);
        continue;
      }
      const w = weights.get(o!.batchId);
      const rv = splitByWeights(m.revenue, w);
      const cs = splitByWeights(m.cost, w);
      if (!rv || !cs) {
        add(JOINT, m.qty, m.revenue, m.cost);
        continue;
      }
      add(JOINT, m.qty, 0, 0);
      for (const [k, v] of rv) add(k, 0, v, cs.get(k) ?? 0);
    }
    return out;
  };
}

export async function attributeShipments(t: Tx, moves: { purchaseBatchItemId: string | null; qty: number; revenue: number; cost: number }[]) {
  return (await ownerAttributor(t, moves.map((m) => m.purchaseBatchItemId)))(moves);
}
