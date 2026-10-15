// 採購團的日常操作：修改基本資料、砍單、跨團複製品項、活動（代購系列）總覽與跨團價格比較
import { BizError, lockRows, type Tx } from "@/server/db";
import { jpyToTwd } from "@/lib/money";
import { audit, emptyToNull, type Actor } from "./common";
import { addBatchItem, effectiveUnitCost, itemGoodsTwd, minCommittedQty, reallocateBatch, type Currency } from "./purchase";
import { recomputeOrder } from "./recompute";
import { refreshBatchStatus } from "./inventory";

// ── 基本資料 ──
export function checkUrl(u: string | null | undefined) {
  const v = emptyToNull(u);
  if (v && !/^https?:\/\//i.test(v)) throw new BizError("訂購連結請以 http:// 或 https:// 開頭");
  return v;
}

export interface BatchInfo {
  name?: string;
  supplierId?: string | null;
  categoryId?: string | null;
  supplierOrderNo?: string | null;
  orderUrl?: string | null;
  expectedAt?: Date | null;
  notes?: string | null;
}

export async function updateBatchInfo(t: Tx, actor: Actor, batchId: string, input: BatchInfo) {
  await lockRows(t, "PurchaseBatch", [batchId]);
  const before = await t.purchaseBatch.findUnique({ where: { id: batchId } });
  if (!before) throw new BizError("找不到採購團");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new BizError("請填寫採購團名稱");
    data.name = input.name.trim();
  }
  if (input.supplierId !== undefined) {
    const sp = input.supplierId ? await t.supplier.findUnique({ where: { id: input.supplierId } }) : null;
    if (input.supplierId && !sp) throw new BizError("找不到供應商");
    data.supplierId = sp?.id ?? null;
    data.supplier = sp?.name ?? null;
  }
  if (input.categoryId !== undefined) {
    if (input.categoryId && !(await t.category.findUnique({ where: { id: input.categoryId } }))) throw new BizError("找不到活動／系列");
    data.categoryId = input.categoryId || null;
  }
  if (input.supplierOrderNo !== undefined) data.supplierOrderNo = emptyToNull(input.supplierOrderNo);
  if (input.orderUrl !== undefined) data.orderUrl = checkUrl(input.orderUrl);
  if (input.expectedAt !== undefined) data.expectedAt = input.expectedAt;
  if (input.notes !== undefined) data.notes = emptyToNull(input.notes);
  const b = before as unknown as Record<string, unknown>;
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
  const changed = Object.keys(data).filter((k) => norm(b[k]) !== norm(data[k]));
  if (!changed.length) return before;
  const row = await t.purchaseBatch.update({ where: { id: batchId }, data: Object.fromEntries(changed.map((k) => [k, data[k]])) });
  await audit(t, actor, "batch.updateInfo", "PurchaseBatch", batchId, {
    before: Object.fromEntries(changed.map((k) => [k, norm(b[k])])),
    after: Object.fromEntries(changed.map((k) => [k, norm(data[k])])),
  });
  return row;
}

// ── 砍單 ──
export const CANCEL_REASONS: Record<string, string> = {
  AGENT_CANCEL: "代購砍單",
  SELLER_CANCEL: "賣家取消",
  OUT_OF_STOCK: "商品缺貨",
  SELF_CANCEL: "自己取消",
  OTHER: "其他",
};

/**
 * 砍掉採購品項的部分或全部數量（已到貨的不能砍）。
 * - 只影響這一個品項，同團其他品項不變；費用重新分攤。
 * - 不會刪除買家訂單：回傳因此缺貨的訂單明細；markShortage 時把它們標為「缺貨」並留下事件紀錄。
 * - 已付給供應商的款項不會被當成已退款，回傳本團已付款金額供畫面提醒。
 */
export async function cancelBatchItem(t: Tx, actor: Actor, itemId: string, input: { qty: number; reason: string; note?: string | null; markShortage?: boolean }) {
  const bi0 = await t.purchaseBatchItem.findUnique({ where: { id: itemId }, select: { batchId: true, productId: true } });
  if (!bi0) throw new BizError("找不到採購品項");
  await lockRows(t, "PurchaseBatch", [bi0.batchId]);
  await lockRows(t, "Product", [bi0.productId]);
  const bi = await t.purchaseBatchItem.findUniqueOrThrow({ where: { id: itemId }, include: { batch: true, product: { select: { name: true } } } });
  if (bi.batch.status === "CANCELLED") throw new BizError("採購團已取消");
  const label = CANCEL_REASONS[input.reason];
  if (!label) throw new BizError("請選擇砍單原因");
  const note = emptyToNull(input.note);
  if (input.reason === "OTHER" && !note) throw new BizError("選擇「其他」時請補充原因");
  const { received } = await minCommittedQty(t, itemId);
  const active = bi.qty - bi.cancelledQty;
  const max = active - received;
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BizError("砍單數量必須是正整數");
  if (input.qty > max) throw new BizError(max <= 0 ? "這個品項已全部到貨或已取消，沒有可以砍的數量" : `最多只能砍 ${max} 件（已到貨 ${received} 件不能砍）`);
  const reasonText = note ? `${label}：${note}` : label;
  await t.purchaseBatchItem.update({ where: { id: itemId }, data: { cancelledQty: bi.cancelledQty + input.qty, cancelReason: reasonText } });
  await reallocateBatch(t, bi.batchId);
  await refreshBatchStatus(t, itemId);

  const affected = await shortageItems(t, bi.productId);
  if (input.markShortage) {
    const touched = new Set<string>();
    for (const a of affected) {
      await t.orderItem.update({ where: { id: a.orderItemId }, data: { purchaseFlag: "OUT_OF_STOCK" } });
      await t.orderItemEvent.create({ data: { orderItemId: a.orderItemId, type: "PURCHASE_FLAG", fromValue: "ORDERED", toValue: "OUT_OF_STOCK", note: `${bi.batch.code} 砍單（${reasonText}）`, actorId: actor.userId } });
      touched.add(a.orderId);
    }
    for (const id of touched) await recomputeOrder(t, id);
  }
  const paid = await t.supplierPayment.groupBy({ by: ["currency"], where: { batchId: bi.batchId, status: "PAID" }, _sum: { amount: true } });
  await audit(t, actor, "batch.cancelItem", "PurchaseBatch", bi.batchId, { itemId, qty: input.qty, reason: input.reason, note, markShortage: !!input.markShortage, affected: affected.map((a) => a.orderItemId) });
  return {
    cancelled: input.qty,
    remaining: active - input.qty,
    affected: affected.map((a) => ({ orderNo: a.orderNo, buyerName: a.buyerName, qty: a.short })),
    marked: !!input.markShortage && affected.length > 0,
    paid: paid.map((p) => ({ currency: p.currency, amount: p._sum.amount ?? 0 })).filter((p) => p.amount > 0),
  };
}

/** 已向供應商下單、但目前庫存與所有在途都不夠的買家明細（從最晚下單的開始算缺貨） */
async function shortageItems(t: Tx, productId: string) {
  const demand = await t.orderItem.findMany({
    where: { productId, purchaseFlag: "ORDERED", order: { confirmation: "CONFIRMED" } },
    include: { order: { select: { id: true, orderNo: true, createdAt: true, buyer: { select: { name: true } } } } },
    orderBy: [{ order: { createdAt: "desc" } }, { createdAt: "desc" }],
  });
  const open = demand.map((d) => ({ d, need: Math.max(0, d.qty - d.cancelledQtyCache - d.shippedQtyCache - d.reservedQtyCache) })).filter((x) => x.need > 0);
  const promised = open.reduce((s, x) => s + x.need, 0);
  if (!promised) return [];
  const batches = await t.purchaseBatchItem.findMany({
    where: { productId, batch: { status: { notIn: ["CANCELLED", "DRAFT"] } } },
    include: { movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
  });
  const incoming = batches.reduce((s, b) => s + Math.max(0, b.qty - b.cancelledQty - b.movements.reduce((a, m) => a + m.onHandDelta, 0)), 0);
  const stock = await t.inventoryMovement.aggregate({ where: { productId }, _sum: { onHandDelta: true, reservedDelta: true } });
  const free = Math.max(0, (stock._sum.onHandDelta ?? 0) - (stock._sum.reservedDelta ?? 0));
  let short = promised - incoming - free;
  const out: { orderItemId: string; orderId: string; orderNo: string; buyerName: string; short: number }[] = [];
  for (const x of open) {
    if (short <= 0) break;
    const take = Math.min(short, x.need);
    out.push({ orderItemId: x.d.id, orderId: x.d.order.id, orderNo: x.d.order.orderNo, buyerName: x.d.order.buyer.name, short: take });
    short -= take;
  }
  return out;
}

// ── 跨團複製品項 ──
export interface CopyRow {
  sourceItemId: string;
  qty: number;
  unitCost: number; // 由使用者確認的新單價（舊價格只是參考值）
  currency: Currency;
}

/**
 * 把來源採購團的商品清單複製到目標團，建立新的採購品項。
 * 只複製商品與規格；付款、收貨、退款、出貨、庫存與費用都不複製。
 * 以 submissionKey 防重複：重送不會再建立一次。
 */
export async function copyBatchItems(t: Tx, actor: Actor, input: { fromBatchId: string; toBatchId: string; submissionKey: string; rows: CopyRow[] }) {
  if (input.fromBatchId === input.toBatchId) throw new BizError("來源與目標是同一個採購團");
  if (!input.submissionKey || input.submissionKey.length < 8) throw new BizError("缺少送出識別碼");
  await lockRows(t, "PurchaseBatch", [input.toBatchId]);
  const target = await t.purchaseBatch.findUnique({ where: { id: input.toBatchId } });
  if (!target) throw new BizError("找不到目標採購團");
  if (target.status === "CANCELLED") throw new BizError("已取消的採購團不能新增品項");
  const source = await t.purchaseBatchItem.findMany({ where: { batchId: input.fromBatchId }, select: { id: true, productId: true, specNote: true, weightGrams: true, qty: true } });
  const byId = new Map(source.map((s) => [s.id, s]));
  const rows = input.rows.filter((r) => r.qty > 0);
  if (!rows.length) throw new BizError("請至少保留一列數量大於 0 的品項");
  for (const r of rows) {
    if (!byId.has(r.sourceItemId)) throw new BizError("品項不屬於來源採購團");
    if (!Number.isInteger(r.qty) || r.qty <= 0) throw new BizError("數量必須是正整數");
    if (!Number.isInteger(r.unitCost) || r.unitCost < 0) throw new BizError("單價必須是不小於 0 的整數");
  }
  let created = 0;
  let duplicated = 0;
  for (const r of rows) {
    const s = byId.get(r.sourceItemId)!;
    const key = `copy:${input.submissionKey}:${r.sourceItemId}`;
    if (await t.purchaseBatchItem.findUnique({ where: { dedupeKey: key } })) {
      duplicated++;
      continue;
    }
    await addBatchItem(t, actor, input.toBatchId, {
      productId: s.productId,
      qty: r.qty,
      unitCost: r.unitCost,
      currency: r.currency,
      specNote: s.specNote,
      weightGrams: s.weightGrams && s.qty ? Math.round((s.weightGrams * r.qty) / s.qty) : null,
      dedupeKey: key,
    });
    created++;
  }
  await audit(t, actor, "batch.copyItems", "PurchaseBatch", input.toBatchId, { fromBatchId: input.fromBatchId, created, duplicated });
  return { created, duplicated };
}

// ── 活動（代購系列）總覽與跨團價格比較 ──
export interface PriceCell {
  itemId: string;
  qty: number;
  currency: string;
  unitCost: number; // 原幣單價（實際優先，否則預估）
  estimated: boolean; // 尚未確認實際單價
  unitTwd: number; // 商品單價換算台幣（依該團鎖定匯率）
  fullUnitTwd: number; // 含分攤費用的單件完整成本
  feesConfirmed: boolean; // 該團是否已登記任何共同費用
}

export async function categoryOverview(t: Tx, categoryId: string) {
  const batches = await t.purchaseBatch.findMany({
    where: { categoryId },
    orderBy: [{ orderedAt: "asc" }, { createdAt: "asc" }],
    include: {
      supplierRef: { select: { name: true } },
      orderedBy: { select: { name: true } },
      paymentResponsibleBy: { select: { name: true } },
      receivingResponsibleBy: { select: { name: true } },
      costs: { select: { id: true } },
      supplierPayments: { where: { status: { in: ["PAID", "PENDING"] } }, select: { amount: true, currency: true, status: true } },
      receivings: { select: { lines: { select: { defectQty: true, missingQty: true } } } },
      items: {
        include: {
          product: { select: { id: true, code: true, name: true } },
          allocations: { select: { amountTwd: true } },
          movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } },
        },
      },
    },
  });
  const today = new Date();
  const rows = new Map<string, { product: { id: string; code: string; name: string }; cells: Map<string, PriceCell[]> }>();
  const summaries = batches.map((b) => {
    let qty = 0;
    let received = 0;
    let cancelled = 0;
    let goodsTwd = 0;
    let feesTwd = 0;
    let estimated = false;
    for (const i of b.items) {
      const q = i.qty - i.cancelledQty;
      const rec = i.movements.reduce((s, m) => s + m.onHandDelta, 0);
      qty += q;
      received += rec;
      cancelled += i.cancelledQty;
      const goods = itemGoodsTwd(i, b.rateMicro);
      const fees = i.allocations.reduce((s, a) => s + a.amountTwd, 0);
      goodsTwd += goods;
      feesTwd += fees;
      if (q > 0 && i.actualUnitCost === null) estimated = true;
      if (q <= 0) continue;
      const unitCost = effectiveUnitCost(i);
      const cell: PriceCell = {
        itemId: i.id,
        qty: q,
        currency: i.currency,
        unitCost,
        estimated: i.actualUnitCost === null,
        unitTwd: i.currency === "TWD" ? unitCost : jpyToTwd(unitCost, b.rateMicro),
        fullUnitTwd: Math.round((goods + fees) / q),
        feesConfirmed: b.costs.length > 0,
      };
      let row = rows.get(i.productId);
      if (!row) {
        row = { product: i.product, cells: new Map() };
        rows.set(i.productId, row);
      }
      const arr = row.cells.get(b.id) ?? [];
      arr.push(cell);
      row.cells.set(b.id, arr);
    }
    const paid: Record<string, number> = {};
    const pending: Record<string, number> = {};
    for (const p of b.supplierPayments) {
      const m = p.status === "PAID" ? paid : pending;
      m[p.currency] = (m[p.currency] ?? 0) + p.amount;
    }
    const defects = b.receivings.reduce((s, r) => s + r.lines.reduce((a, l) => a + l.defectQty, 0), 0);
    const missing = b.receivings.reduce((s, r) => s + r.lines.reduce((a, l) => a + l.missingQty, 0), 0);
    const outstanding = Math.max(0, qty - received);
    const issues: string[] = [];
    if (cancelled) issues.push(`砍單 ${cancelled} 件`);
    if (defects) issues.push(`瑕疵 ${defects} 件`);
    if (missing) issues.push(`缺少 ${missing} 件`);
    if (b.expectedAt && b.expectedAt < today && outstanding > 0 && b.status !== "CANCELLED") issues.push("超過預計到貨日");
    if (!Object.keys(paid).length && !Object.keys(pending).length && qty > 0 && b.status !== "CANCELLED") issues.push("尚未登記付款");
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      status: b.status,
      supplier: b.supplierRef?.name ?? b.supplier,
      orderedBy: b.orderedBy?.name ?? null,
      paymentResponsibleBy: b.paymentResponsibleBy?.name ?? null,
      receivingResponsibleBy: b.receivingResponsibleBy?.name ?? null,
      expectedAt: b.expectedAt,
      qty,
      received,
      outstanding,
      cancelled,
      goodsTwd,
      feesTwd,
      totalTwd: goodsTwd + feesTwd,
      estimated,
      feesRecorded: b.costs.length > 0,
      paid,
      pending,
      issues,
    };
  });
  const active = summaries.filter((s) => s.status !== "CANCELLED");
  const matrix = [...rows.values()]
    .map((r) => {
      const all = [...r.cells.values()].flat();
      const units = all.map((c) => c.unitTwd);
      const fulls = all.map((c) => c.fullUnitTwd);
      return {
        product: r.product,
        cells: Object.fromEntries(r.cells),
        totalQty: all.reduce((s, c) => s + c.qty, 0),
        minUnitTwd: Math.min(...units),
        maxUnitTwd: Math.max(...units),
        minFullUnitTwd: Math.min(...fulls),
        anyEstimated: all.some((c) => c.estimated || !c.feesConfirmed),
      };
    })
    .sort((a, b) => a.product.name.localeCompare(b.product.name, "zh-Hant"));
  return {
    batches: summaries,
    matrix,
    total: {
      batches: active.length,
      qty: active.reduce((s, b) => s + b.qty, 0),
      received: active.reduce((s, b) => s + b.received, 0),
      outstanding: active.reduce((s, b) => s + b.outstanding, 0),
      totalTwd: active.reduce((s, b) => s + b.totalTwd, 0),
      estimated: active.some((b) => b.estimated || !b.feesRecorded),
    },
  };
}
