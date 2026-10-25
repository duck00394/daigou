// 合資團：每件是誰的（PurchaseBatchItem.ownerId，空白＝一起的）、一起的怎麼分（jointSplit 百分比，空白＝平均）、
// 運費怎麼分（feeSplit：HALF 平均／GOODS 照商品金額），誰付了多少給代購（付款紀錄的付款人），兩人之間轉過的錢（jointTransfers）。
import { BizError, lockRows, type Tx } from "@/server/db";
import { jpyToTwd } from "@/lib/money";
import { audit, type Actor } from "./common";
import { summarizeFees } from "./fees";
import { itemGoodsTwd } from "./purchase";
import { addSupplierPayment } from "./supplier-payments";
import type { OwnerKey } from "./ownership";

export type Transfer = { from: string; to: string; amount: number; at: string };

type SplitMap = Map<string, number>;

/** 一起的商品分法：{經營者: 百分比}；沒設或不合理就平均分給所有在用的經營者 */
export function parseSplit(json: unknown, opIds: string[]): SplitMap {
  const m = new Map<string, number>();
  if (json && typeof json === "object") for (const [k, v] of Object.entries(json as Record<string, unknown>)) if (opIds.includes(k) && Number(v) > 0) m.set(k, Number(v));
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return new Map(opIds.map((id) => [id, 100 / Math.max(1, opIds.length)]));
  return new Map([...m.entries()].map(([k, v]) => [k, (v * 100) / total]));
}

async function activeOps(t: Tx) {
  return (await t.operator.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }));
}

/** 賣掉「一起的」商品時，錢怎麼分（百分比當權重） */
export async function jointSplitWeights(t: Tx, batchIds: string[]) {
  const ids = [...new Set(batchIds)];
  const out = new Map<string, Map<OwnerKey, number>>();
  if (!ids.length) return out;
  const [ops, bs] = await Promise.all([activeOps(t), t.purchaseBatch.findMany({ where: { id: { in: ids } }, select: { id: true, jointSplit: true } })]);
  for (const b of bs) out.set(b.id, parseSplit(b.jointSplit, ops.map((o) => o.id)));
  return out;
}

type BatchForShare = {
  id: string;
  rateMicro: number;
  jointSplit: unknown;
  feeSplit: string;
  items: { ownerId: string | null; qty: number; cancelledQty: number; currency: string; estUnitCost: number; actualUnitCost: number | null; allocations: { amountTwd: number }[] }[];
  costs: { currency: string; amount: number; method: string; payer: string | null; shareSplit: unknown }[];
};

/** 一團合資：每個人應該負擔多少（商品：自己的＋一起的照比例；運費：平均或照商品金額） */
export function shareOf(b: BatchForShare, opIds: string[]) {
  const split = parseSplit(b.jointSplit, opIds);
  const goods = new Map<string, number>(opIds.map((id) => [id, 0]));
  let shared = 0;
  for (const i of b.items) {
    const v = itemGoodsTwd(i, b.rateMicro) + i.allocations.reduce((s, a) => s + a.amountTwd, 0);
    if (i.ownerId && goods.has(i.ownerId)) goods.set(i.ownerId, goods.get(i.ownerId)! + v);
    else shared += v;
  }
  const own = new Map(goods);
  for (const [k, p] of split) goods.set(k, (goods.get(k) ?? 0) + (shared * p) / 100);
  const fee = summarizeFees(b.costs as never, b.rateMicro).unallocTwd;
  const goodsTotal = [...goods.values()].reduce((a, x) => a + x, 0);
  const owed = new Map<string, number>();
  for (const id of opIds) {
    const g = goods.get(id) ?? 0;
    const f = b.feeSplit === "GOODS" && goodsTotal > 0 ? (fee * g) / goodsTotal : fee / Math.max(1, opIds.length);
    owed.set(id, g + f);
  }
  return { owed, goods, own, shared, fee, split };
}

/** 每團合資各人負擔的金額（用來把整團總額分給各人） */
export async function jointWeights(t: Tx, batchIds: string[]) {
  const ids = [...new Set(batchIds)];
  const out = new Map<string, Map<OwnerKey, number>>();
  if (!ids.length) return out;
  const ops = (await activeOps(t)).map((o) => o.id);
  const bs = await t.purchaseBatch.findMany({ where: { id: { in: ids } }, select: batchShareSelect });
  for (const b of bs) out.set(b.id, shareOf(b, ops).owed);
  return out;
}

const batchShareSelect = {
  id: true,
  rateMicro: true,
  jointSplit: true,
  feeSplit: true,
  refundedTwd: true,
  items: { select: { ownerId: true, qty: true, cancelledQty: true, currency: true, estUnitCost: true, actualUnitCost: true, allocations: { select: { amountTwd: true } } } },
  costs: { select: { currency: true, amount: true, method: true, payer: true, shareSplit: true } },
} as const;

/**
 * 合資分帳：每個人應負擔多少、付了多少、差多少，還有誰要給誰
 * 還沒全部付給代購時，照「已經付的比例」算目前誰多付
 */
export async function jointSettlement(t: Tx, batchId: string) {
  const ops = await activeOps(t);
  const b = await t.purchaseBatch.findUnique({ where: { id: batchId }, select: { ...batchShareSelect, ownership: true, jointTransfers: true, supplierPayments: { where: { status: "PAID" }, select: { paidById: true, amount: true, currency: true, rateMicro: true } } } });
  if (!b) throw new BizError("找不到採購團");
  const opIds = ops.map((o) => o.id);
  const s = shareOf(b, opIds);
  const paid = new Map<string, number>(opIds.map((id) => [id, 0]));
  let paidTotal = 0;
  for (const p of b.supplierPayments) {
    const twd = p.currency === "TWD" ? p.amount : jpyToTwd(p.amount, p.rateMicro ?? b.rateMicro);
    paidTotal += twd;
    if (p.paidById && paid.has(p.paidById)) paid.set(p.paidById, paid.get(p.paidById)! + twd);
  }
  // 代購退回的錢：照各人付的比例退
  if (b.refundedTwd && paidTotal > 0) for (const [k, v] of paid) paid.set(k, v - (b.refundedTwd * v) / paidTotal);
  const netPaid = paidTotal - b.refundedTwd;
  const total = [...s.owed.values()].reduce((a, x) => a + x, 0);
  const transfers = (Array.isArray(b.jointTransfers) ? b.jointTransfers : []) as Transfer[];
  // 每個人：付的 − 自己該付的。付超過自己那份的，多付的部分由還沒付夠的人還給他；
  // 還沒付夠的其他部分是要付給代購的，不算兩人之間的帳
  const balance = new Map<string, number>();
  for (const id of opIds) balance.set(id, (paid.get(id) ?? 0) - (s.owed.get(id) ?? 0));
  for (const tr of transfers) {
    if (balance.has(tr.from)) balance.set(tr.from, balance.get(tr.from)! + tr.amount);
    if (balance.has(tr.to)) balance.set(tr.to, balance.get(tr.to)! - tr.amount);
  }
  const cred = [...balance.entries()].filter(([, v]) => v > 0.5).map(([k, v]) => ({ k, v })).sort((a, c) => c.v - a.v);
  const short = [...balance.entries()].filter(([, v]) => v < -0.5).map(([k, v]) => ({ k, v: -v })).sort((a, c) => c.v - a.v);
  const credTotal = cred.reduce((a, x) => a + x.v, 0);
  const shortTotal = short.reduce((a, x) => a + x.v, 0);
  const toPartner = shortTotal > 0 ? Math.min(1, credTotal / shortTotal) : 0;
  const toSupplier = new Map<string, number>();
  const debt = short.map((d) => {
    const owe = d.v * toPartner;
    toSupplier.set(d.k, Math.round(d.v - owe));
    return { k: d.k, v: owe };
  });
  // 誰要給誰（金額取整數）
  const debts: { from: string; to: string; amount: number }[] = [];
  for (const d of debt) {
    for (const c of cred) {
      if (d.v < 0.5) break;
      if (c.v < 0.5) continue;
      const x = Math.min(d.v, c.v);
      debts.push({ from: d.k, to: c.k, amount: Math.round(x) });
      d.v -= x;
      c.v -= x;
    }
  }
  const people = ops.map((o) => ({ id: o.id, name: o.name, goods: Math.round(s.goods.get(o.id) ?? 0), own: Math.round(s.own.get(o.id) ?? 0), owed: Math.round(s.owed.get(o.id) ?? 0), paid: Math.round(paid.get(o.id) ?? 0), percent: Math.round((s.split.get(o.id) ?? 0) * 10) / 10, toSupplier: toSupplier.get(o.id) ?? 0 }));
  return { joint: b.ownership === "JOINT", people, total: Math.round(total), paidTotal: Math.round(netPaid), feeSplit: b.feeSplit, fee: Math.round(s.fee), shared: Math.round(s.shared), debts: debts.filter((x) => x.amount > 0), transfers, fullyPaid: netPaid >= total - 0.5 };
}

/** 改合資的分法：一起的比例、運費怎麼分 */
export async function saveJointSetup(t: Tx, actor: Actor, batchId: string, input: { split?: Record<string, number> | null; feeSplit?: "HALF" | "GOODS" }) {
  const data: { jointSplit?: object | null; feeSplit?: string } = {};
  if (input.split !== undefined) {
    if (input.split) {
      const vals = Object.values(input.split);
      if (vals.some((v) => !Number.isFinite(v) || v < 0)) throw new BizError("比例請填 0 以上的數字");
      if (vals.reduce((a, b) => a + b, 0) <= 0) throw new BizError("比例加起來要大於 0");
    }
    data.jointSplit = input.split ?? null;
  }
  if (input.feeSplit) data.feeSplit = input.feeSplit;
  await t.purchaseBatch.update({ where: { id: batchId }, data: data as never });
  await audit(t, actor, "batch.jointSetup", "PurchaseBatch", batchId, input);
}

/** 填「誰付了多少給代購」（累計）：比已登記的多，就把差額記成那個人的一筆付款 */
export async function setPaidBy(t: Tx, actor: Actor, batchId: string, entries: { paidById: string; total: number }[], payKey?: string | null) {
  await lockRows(t, "PurchaseBatch", [batchId]);
  const b = await t.purchaseBatch.findUnique({ where: { id: batchId }, select: { rateMicro: true, status: true, supplierPayments: { where: { status: "PAID" }, select: { paidById: true, amount: true, currency: true, rateMicro: true } } } });
  if (!b) throw new BizError("找不到採購團");
  let added = 0;
  for (const e of entries) {
    if (!Number.isInteger(e.total) || e.total < 0) throw new BizError("付了多少請填整數");
    const now = Math.round(b.supplierPayments.filter((p) => p.paidById === e.paidById).reduce((s, p) => s + (p.currency === "TWD" ? p.amount : jpyToTwd(p.amount, p.rateMicro ?? b.rateMicro)), 0));
    if (e.total < now) {
      const op = await t.operator.findUnique({ where: { id: e.paidById }, select: { name: true } });
      throw new BizError(`${op?.name ?? ""}已經登記付了 NT$${now.toLocaleString()}，要改少請到這團的付款紀錄作廢那一筆`);
    }
    if (e.total > now) {
      await addSupplierPayment(t, actor, { batchId, paidById: e.paidById, paidAt: new Date(), amount: e.total - now, currency: "TWD", purpose: "OTHER", note: "合資：誰付了多少", dedupeKey: payKey ? `paidby:${payKey}:${e.paidById}:${e.total}` : null });
      added += e.total - now;
    }
  }
  return { added };
}

/** 兩人之間轉錢（結清）：from 給 to amount 元 */
export async function recordJointTransfer(t: Tx, actor: Actor, batchId: string, input: { from: string; to: string; amount: number }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BizError("金額請填正整數");
  if (input.from === input.to) throw new BizError("要選兩個不同的人");
  await lockRows(t, "PurchaseBatch", [batchId]);
  const b = await t.purchaseBatch.findUnique({ where: { id: batchId }, select: { jointTransfers: true } });
  if (!b) throw new BizError("找不到採購團");
  const list = (Array.isArray(b.jointTransfers) ? b.jointTransfers : []) as Transfer[];
  list.push({ ...input, at: new Date().toISOString() });
  await t.purchaseBatch.update({ where: { id: batchId }, data: { jointTransfers: list as never } });
  await audit(t, actor, "batch.jointTransfer", "PurchaseBatch", batchId, input);
}

/** 首頁用：哪些合資團兩人之間還沒結清 */
export async function unsettledJoint(t: Tx) {
  const bs = await t.purchaseBatch.findMany({ where: { ownership: "JOINT", status: { not: "CANCELLED" }, supplierPayments: { some: { status: "PAID" } } }, select: { id: true } });
  const out: { id: string; debts: { from: string; to: string; amount: number }[] }[] = [];
  for (const b of bs) {
    const s = await jointSettlement(t, b.id);
    if (s.debts.length) out.push({ id: b.id, debts: s.debts });
  }
  return out;
}
