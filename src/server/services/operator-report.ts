// 經營者對帳：只呈現「誰負責、誰實際付了多少、誰收了哪些貨」的事實。
// 不推算合夥人之間的成本分攤、墊款或誰該還誰錢；那需要另外設計清楚的結算規則。
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/server/db";
import { jpyToTwd } from "@/lib/money";
import { listOperators } from "./operators";

export const UNASSIGNED = "none";

export interface OperatorFilter {
  from?: Date | null; // 含當天
  toExclusive?: Date | null; // 不含
  supplierId?: string | null;
  batchId?: string | null;
  operatorId?: string | null; // 經營者 id，或 UNASSIGNED 代表「未指定」
}

export interface CurrencySum {
  paidAmount: number; // 已付款（原幣）
  paidCount: number;
  pendingAmount: number; // 待付款（原幣，不計入已付）
  pendingCount: number;
  ratedAmount: number; // 已付款中有填實際匯率的原幣金額
  twdFromRated: number; // 上述金額以各筆實際匯率換算的台幣（台幣付款即原金額）
  unratedCount: number; // 日幣已付款但沒有實際匯率、無法換算的筆數
}

export interface OperatorRow {
  key: string; // 經營者 id 或 UNASSIGNED
  name: string;
  code: string | null;
  active: boolean;
  batches: { ordered: number; paymentResponsible: number; receivingResponsible: number };
  payments: Record<string, CurrencySum>;
  receiving: { records: number; batches: number; receivedQty: number; defectQty: number; missingQty: number; goodQty: number };
}

function range(f: OperatorFilter) {
  if (!f.from && !f.toExclusive) return undefined;
  return { ...(f.from ? { gte: f.from } : {}), ...(f.toExclusive ? { lt: f.toExclusive } : {}) };
}

function batchWhere(f: OperatorFilter): Prisma.PurchaseBatchWhereInput {
  return { ...(f.supplierId ? { supplierId: f.supplierId } : {}), ...(f.batchId ? { id: f.batchId } : {}) };
}

const opMatch = (id: string | null | undefined) => (id === UNASSIGNED ? null : id);

export function paymentWhere(f: OperatorFilter, extra: { currency?: string | null; status?: string | null } = {}): Prisma.SupplierPaymentWhereInput {
  const r = range(f);
  return {
    ...(r ? { paidAt: r } : {}),
    batch: batchWhere(f),
    ...(f.operatorId ? { paidById: opMatch(f.operatorId) } : {}),
    ...(extra.currency ? { currency: extra.currency } : {}),
    ...(extra.status ? { status: extra.status as "PAID" | "PENDING" | "VOIDED" } : {}),
  };
}

export function receivingWhere(f: OperatorFilter): Prisma.ReceivingRecordWhereInput {
  const r = range(f);
  return {
    ...(r ? { receivedAt: r } : {}),
    batch: batchWhere(f),
    ...(f.operatorId && f.operatorId !== UNASSIGNED ? { receivedById: f.operatorId } : {}),
    ...(f.operatorId === UNASSIGNED ? { id: "__none__" } : {}), // 收貨確認人必填，不會有未指定
  };
}

const emptySum = (): CurrencySum => ({ paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0, ratedAmount: 0, twdFromRated: 0, unratedCount: 0 });

export async function operatorReport(t: Tx, f: OperatorFilter) {
  const operators = await listOperators(t, { includeInactive: true });
  const rows = new Map<string, OperatorRow>();
  const row = (key: string) => {
    let r = rows.get(key);
    if (!r) {
      const op = operators.find((o) => o.id === key);
      r = {
        key,
        name: op?.name ?? "未指定",
        code: op?.code ?? null,
        active: op?.active ?? true,
        batches: { ordered: 0, paymentResponsible: 0, receivingResponsible: 0 },
        payments: {},
        receiving: { records: 0, batches: 0, receivedQty: 0, defectQty: 0, missingQty: 0, goodQty: 0 },
      };
      rows.set(key, r);
    }
    return r;
  };
  for (const o of operators) if (o.active && (!f.operatorId || f.operatorId === o.id)) row(o.id);

  // 1. 負責的採購團（依下單日篩選，不含已取消）
  const r = range(f);
  const batches = await t.purchaseBatch.findMany({
    where: { ...batchWhere(f), status: { not: "CANCELLED" }, ...(r ? { orderedAt: r } : {}) },
    select: { id: true, orderedById: true, paymentResponsibleById: true, receivingResponsibleById: true },
  });
  const want = (id: string | null) => !f.operatorId || (id ?? UNASSIGNED) === f.operatorId;
  for (const b of batches) {
    if (want(b.orderedById)) row(b.orderedById ?? UNASSIGNED).batches.ordered++;
    if (want(b.paymentResponsibleById)) row(b.paymentResponsibleById ?? UNASSIGNED).batches.paymentResponsible++;
    if (want(b.receivingResponsibleById)) row(b.receivingResponsibleById ?? UNASSIGNED).batches.receivingResponsible++;
  }

  // 2. 實際付款（依付款日；已作廢不計；不同幣別分開，不直接加總）
  const payments = await t.supplierPayment.findMany({
    where: { ...paymentWhere(f), status: { in: ["PAID", "PENDING"] } },
    select: { paidById: true, amount: true, currency: true, rateMicro: true, status: true },
  });
  const totals: Record<string, CurrencySum> = {};
  for (const p of payments) {
    const sums = row(p.paidById ?? UNASSIGNED).payments;
    for (const s of [(sums[p.currency] ??= emptySum()), (totals[p.currency] ??= emptySum())]) {
      if (p.status === "PENDING") {
        s.pendingAmount += p.amount;
        s.pendingCount++;
        continue;
      }
      s.paidAmount += p.amount;
      s.paidCount++;
      if (p.currency === "TWD") {
        s.ratedAmount += p.amount;
        s.twdFromRated += p.amount;
      } else if (p.rateMicro) {
        s.ratedAmount += p.amount;
        s.twdFromRated += jpyToTwd(p.amount, p.rateMicro);
      } else s.unratedCount++;
    }
  }

  // 3. 收貨與清點（依收貨日）
  const recs = await t.receivingRecord.findMany({
    where: receivingWhere(f),
    select: { batchId: true, receivedById: true, lines: { select: { receivedQty: true, defectQty: true, missingQty: true } } },
  });
  const batchSets = new Map<string, Set<string>>();
  for (const rec of recs) {
    const x = row(rec.receivedById).receiving;
    x.records++;
    const s = batchSets.get(rec.receivedById) ?? new Set();
    s.add(rec.batchId);
    batchSets.set(rec.receivedById, s);
    for (const l of rec.lines) {
      x.receivedQty += l.receivedQty;
      x.defectQty += l.defectQty;
      x.missingQty += l.missingQty;
      x.goodQty += l.receivedQty - l.defectQty;
    }
  }
  for (const [k, s] of batchSets) row(k).receiving.batches = s.size;

  const order = (k: string) => {
    const i = operators.findIndex((o) => o.id === k);
    return i < 0 ? 999 : i;
  };
  return { rows: [...rows.values()].sort((a, b) => order(a.key) - order(b.key)), totals };
}

export async function listSupplierPayments(t: Tx, f: OperatorFilter, extra: { currency?: string | null; status?: string | null } = {}) {
  return t.supplierPayment.findMany({
    where: paymentWhere(f, extra),
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: { paidBy: true, batch: { select: { id: true, code: true, name: true, supplierRef: { select: { name: true } } } } },
  });
}

export async function listReceivingRecords(t: Tx, f: OperatorFilter) {
  return t.receivingRecord.findMany({
    where: receivingWhere(f),
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      receivedBy: true,
      batch: { select: { id: true, code: true, name: true, supplierRef: { select: { name: true } } } },
      lines: { include: { batchItem: { include: { product: { select: { name: true } } } } } },
    },
  });
}
