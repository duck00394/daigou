// 平均成本：同一個商品、同一個人買的所有團，買價＋運費、服務費、關稅加起來 ÷ 隻數
// 賣掉的、手上的、客人訂的都用這個平均，不再照「出貨扣到哪一團」各算各的
// 對單還沒確定有買到的不算進平均（跟「每隻成本」那欄一樣）；全部都還沒確定才先用它們
import type { Tx } from "@/server/db";
import { landedCosts } from "./purchase";
import { pendingQty } from "./batch-ops";
import { lotOwners, ownerOfLot } from "./ownership";

type Landed = Awaited<ReturnType<typeof landedCosts>> extends Map<string, infer V> ? V : never;

/**
 * 跟 landedCosts 同樣的格式（每個成本批次 → 數量、金額），但數量、金額換成「同商品、同一個人」所有團的合計，
 * 所以 costOfMove、庫存估值照原本的算法算出來就是平均成本
 */
export async function pooledCosts(t: Tx, batchItemIds: (string | null)[]) {
  const ids = [...new Set(batchItemIds.filter(Boolean) as string[])];
  const out = new Map<string, Landed>();
  if (!ids.length) return out;
  const seeds = await t.purchaseBatchItem.findMany({ where: { id: { in: ids } }, select: { id: true, productId: true } });
  const pids = [...new Set(seeds.map((s) => s.productId))];
  const all = await t.purchaseBatchItem.findMany({
    where: { productId: { in: pids }, batch: { status: { not: "CANCELLED" } } },
    select: { id: true, productId: true, qty: true, cancelledQty: true, confirmedQty: true, batch: { select: { status: true, supplierRef: { select: { kind: true } } } }, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
  });
  const allIds = [...new Set([...all.map((i) => i.id), ...ids])];
  const [landed, owners] = await Promise.all([landedCosts(t, allIds), lotOwners(t, allIds)]);
  const keyOf = (id: string, pid: string) => `${pid}|${ownerOfLot(owners, id)}`;
  type Pool = { sureQ: number; sureV: number; allQ: number; allV: number; goodsV: number; feesV: number; estimated: boolean };
  const pools = new Map<string, Pool>();
  for (const i of all) {
    const l = landed.get(i.id);
    if (!l || l.qty <= 0) continue;
    const rec = i.movements.reduce((a, m) => a + m.onHandDelta, 0);
    const sure = Math.max(0, l.qty - pendingQty(i, rec));
    const k = keyOf(i.id, i.productId);
    const p = pools.get(k) ?? { sureQ: 0, sureV: 0, allQ: 0, allV: 0, goodsV: 0, feesV: 0, estimated: false };
    p.allQ += l.qty;
    p.allV += l.totalTwd;
    if (sure > 0) {
      p.sureQ += sure;
      p.sureV += (l.totalTwd * sure) / l.qty;
      p.goodsV += (l.goodsTwd * sure) / l.qty;
      p.feesV += (l.feesTwd * sure) / l.qty;
      if (l.estimated) p.estimated = true;
    }
    pools.set(k, p);
  }
  for (const s of seeds) {
    const own = landed.get(s.id);
    const p = pools.get(keyOf(s.id, s.productId));
    if (p && p.sureQ > 0) out.set(s.id, { qty: p.sureQ, totalTwd: Math.round(p.sureV), goodsTwd: Math.round(p.goodsV), feesTwd: Math.round(p.feesV), estimated: p.estimated });
    else if (p && p.allQ > 0) out.set(s.id, { qty: p.allQ, totalTwd: p.allV, goodsTwd: own?.goodsTwd ?? 0, feesTwd: own?.feesTwd ?? 0, estimated: true });
    else if (own) out.set(s.id, own);
  }
  return out;
}
