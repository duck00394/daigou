// 採購團的運費／代購費等費用：
// - method = NONE：不攤進商品成本，單獨記一筆（仍算在這團總額與「還要付」裡）
// - payer：誰付的。null＝跟著這團的歸屬（個人團算主人、合資團依付款比例）；
//   經營者 id＝算那個人的；"joint"＝兩人一起付，依 shareSplit 分
import type { Tx } from "@/server/db";
import { jpyToTwd } from "@/lib/money";

export const JOINT_PAYER = "joint";

export type FeeRow = { currency: string; amount: number; method: string; payer: string | null; shareSplit: unknown };

export const feeTwd = (c: { currency: string; amount: number }, rateMicro: number) => (c.currency === "JPY" ? jpyToTwd(c.amount, rateMicro) : c.amount);

export interface BatchFeeInfo {
  /** 不攤進商品成本的費用合計（台幣） */
  unallocTwd: number;
  /** 有指定付款人的費用合計（台幣）；這部分不跟著這團的歸屬，而是算給 byPayer */
  overrideTwd: number;
  /** 指定付款人的費用：經營者 id → 台幣 */
  byPayer: Map<string, number>;
}

/** 這團全部砍單、一件都沒買到：運費等費用不用付（要搶到、收貨才付） */
export function allCancelled(items?: { qty: number; cancelledQty: number }[] | null) {
  return !!items && items.length > 0 && items.every((i) => i.qty - i.cancelledQty <= 0);
}

export function summarizeFees(costs: FeeRow[], rateMicro: number, items?: { qty: number; cancelledQty: number }[] | null): BatchFeeInfo {
  const out: BatchFeeInfo = { unallocTwd: 0, overrideTwd: 0, byPayer: new Map() };
  if (allCancelled(items)) return out;
  for (const c of costs) {
    const twd = feeTwd(c, rateMicro);
    if (c.method === "NONE") out.unallocTwd += twd;
    if (!c.payer) continue;
    out.overrideTwd += twd;
    if (c.payer === JOINT_PAYER) {
      for (const [k, v] of Object.entries((c.shareSplit ?? {}) as Record<string, number>)) out.byPayer.set(k, (out.byPayer.get(k) ?? 0) + Number(v));
    } else out.byPayer.set(c.payer, (out.byPayer.get(c.payer) ?? 0) + twd);
  }
  return out;
}

export async function batchFees(t: Tx, batchIds: string[]) {
  const ids = [...new Set(batchIds)];
  const out = new Map<string, BatchFeeInfo>();
  if (!ids.length) return out;
  const rows = await t.purchaseBatch.findMany({
    where: { id: { in: ids } },
    select: { id: true, rateMicro: true, items: { select: { qty: true, cancelledQty: true } }, costs: { select: { currency: true, amount: true, method: true, payer: true, shareSplit: true } } },
  });
  for (const b of rows) out.set(b.id, summarizeFees(b.costs, b.rateMicro, b.items));
  return out;
}
