// 採購團的日常操作：修改基本資料、砍單、跨團複製品項、活動（代購系列）總覽與跨團價格比較
import { summarizeFees } from "./fees";
import { BizError, lockRows, type Tx } from "@/server/db";
import { jpyToTwd } from "@/lib/money";
import { audit, emptyToNull, type Actor } from "./common";
import { addBatchItem, clampConfirmed, effectiveUnitCost, itemGoodsTwd, minCommittedQty, reallocateBatch, type Currency } from "./purchase";
import { recomputeOrder } from "./recompute";
import { refreshBatchStatus } from "./inventory";
import { batchOwnerKey, JOINT, jointWeights, sharePercents, splitByWeights, stockByOwner } from "./ownership";
import { batchStage, isStoreKind } from "@/lib/labels";

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
  await clampConfirmed(t, itemId);
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

/** 恢復砍單（砍錯了）：把砍掉的數量加回來 */
export async function restoreCancelled(t: Tx, actor: Actor, itemId: string, qty?: number) {
  const bi = await t.purchaseBatchItem.findUnique({ where: { id: itemId }, include: { batch: true } });
  if (!bi) throw new BizError("找不到採購品項");
  if (bi.batch.status === "CANCELLED") throw new BizError("採購團已取消");
  const n = qty ?? bi.cancelledQty;
  if (!Number.isInteger(n) || n <= 0 || n > bi.cancelledQty) throw new BizError(`最多只能恢復 ${bi.cancelledQty} 件`);
  await lockRows(t, "PurchaseBatch", [bi.batchId]);
  const left = bi.cancelledQty - n;
  // 砍錯了＝其實有買到：加回來的算「買到」
  await t.purchaseBatchItem.update({ where: { id: itemId }, data: { cancelledQty: left, confirmedQty: bi.confirmedQty + n, ...(left === 0 ? { cancelReason: null } : {}) } });
  await reallocateBatch(t, bi.batchId);
  await refreshBatchStatus(t, itemId);
  await audit(t, actor, "batch.restoreCancel", "PurchaseBatch", bi.batchId, { itemId, qty: n });
}


/** 總計買了什麼：把好幾團的品項加起來（依系列 › 品項 › 角色） */
export async function purchasedSummary(t: Tx, batchIds: string[]) {
  const items = await t.purchaseBatchItem.findMany({
    where: { batchId: { in: batchIds } },
    select: {
      productId: true,
      qty: true,
      cancelledQty: true,
      categoryId: true,
      batchId: true,
      confirmedQty: true,
      batch: { select: { categoryId: true, status: true, supplierRef: { select: { kind: true } } } },
      movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } },
      product: { select: { name: true, spec: true, productType: { select: { id: true, name: true, sortOrder: true } }, characters: { select: { character: { select: { id: true, name: true } } } } } },
    },
  });
  type Row = { productId: string; name: string; charId: string | null; ordered: number; received: number; cancelled: number; unsure: number; batches: Set<string> };
  const map = new Map<string, { seriesId: string | null; typeName: string; typeSort: number; row: Row }>();
  for (const i of items) {
    const seriesId = i.categoryId ?? i.batch.categoryId;
    const key = `${seriesId ?? "-"}|${i.productId}`;
    const ch = i.product.characters.length === 1 ? i.product.characters[0].character : null;
    const v = map.get(key) ?? { seriesId, typeName: i.product.productType?.name ?? "其他", typeSort: i.product.productType?.sortOrder ?? 9999, row: { productId: i.productId, name: ch?.name ?? i.product.name, charId: ch?.id ?? null, ordered: 0, received: 0, cancelled: 0, unsure: 0, batches: new Set<string>() } };
    const active = i.qty - i.cancelledQty;
    const rec = i.movements.reduce((s, m) => s + m.onHandDelta, 0);
    v.row.ordered += active;
    v.row.received += rec;
    v.row.cancelled += i.cancelledQty;
    v.row.unsure += pendingQty(i, rec);
    v.row.batches.add(i.batchId);
    map.set(key, v);
  }
  return [...map.values()].map((v) => ({ seriesId: v.seriesId, typeName: v.typeName, typeSort: v.typeSort, ...v.row, batches: v.row.batches.size }));
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

/** 一團可以放好幾個系列：品項的系列＝品項自己的，沒填就跟著這團 */
export const itemSeries = (i: { categoryId?: string | null }, b: { categoryId: string | null }) => i.categoryId ?? b.categoryId;
/** 有這個系列商品的團（這團的系列是它，或裡面有品項是它） */
export const batchesWithSeries = (categoryId: string) => ({ OR: [{ categoryId }, { items: { some: { categoryId } } }] });

/**
 * 這團的錢有多少算這個系列：照商品金額（含分攤的運費）比例分；
 * 這團沒有商品金額時，整團算這團自己的系列。
 */
export function seriesRatio(b: { categoryId: string | null; rateMicro: number; items: Parameters<typeof itemGoodsTwd>[0][] & { categoryId?: string | null; allocations: { amountTwd: number }[] }[] }, categoryId: string | null) {
  let all = 0;
  let mine = 0;
  for (const i of b.items) {
    const v = itemGoodsTwd(i, b.rateMicro) + i.allocations.reduce((s, a) => s + a.amountTwd, 0);
    all += v;
    if (itemSeries(i, b) === categoryId) mine += v;
  }
  if (all > 0) return mine / all;
  return b.categoryId === categoryId ? 1 : 0;
}

export async function categoryOverview(t: Tx, categoryId: string) {
  const batches = await t.purchaseBatch.findMany({
    where: batchesWithSeries(categoryId),
    orderBy: [{ orderedAt: "asc" }, { createdAt: "asc" }],
    include: {
      supplierRef: { select: { name: true, kind: true } },
      orderedBy: { select: { name: true } },
      paymentResponsibleBy: { select: { name: true } },
      receivingResponsibleBy: { select: { name: true } },
      costs: { select: { id: true, currency: true, amount: true, method: true, payer: true, shareSplit: true } },
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
    const ratio = seriesRatio(b, categoryId);
    const allItems = b.items;
    const mineItems = allItems.filter((i) => itemSeries(i, b) === categoryId);
    let qty = 0;
    let received = 0;
    let cancelled = 0;
    let goodsTwd = 0;
    let feesTwd = 0;
    let estimated = false;
    for (const i of mineItems) {
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
    const fullFee = summarizeFees(b.costs, b.rateMicro);
    // 一團有好幾個系列時，不攤的運費、指定付款人的費用也照比例分
    const fee = { unallocTwd: Math.round(fullFee.unallocTwd * ratio), overrideTwd: Math.round(fullFee.overrideTwd * ratio), byPayer: new Map([...fullFee.byPayer].map(([k, v]) => [k, Math.round(v * ratio)])) };
    feesTwd += fee.unallocTwd; // 不攤的費用也算在這團總額
    const otherSeries = allItems.some((i) => itemSeries(i, b) !== categoryId);
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
      store: b.supplierRef?.kind === "STORE" || b.supplierRef?.kind === "OFFICIAL_STORE",
      orderedBy: b.orderedBy?.name ?? null,
      ownership: b.ownership,
      ownerKey: batchOwnerKey(b),
      stage: batchStage(b),
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
      fee,
      ratio,
      partial: otherSeries,
      paid,
      pending,
      issues,
    };
  });
  const pay = await batchPaySummary(t, batches.map((b) => b.id));
  // 已付、還要付也照這個系列占的比例
  const summariesWithPay = summaries.map((x) => ({ ...x, paidTwd: Math.round((pay.get(x.id)?.paidTwd ?? 0) * x.ratio), dueTwd: Math.round((pay.get(x.id)?.dueTwd ?? 0) * x.ratio) }));
  const active = summariesWithPay.filter((s) => s.status !== "CANCELLED");
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
  // 依人分：個人團歸主人；合資團依實際付款比例分，還沒付款的列在「合資（未分）」
  const weights = await jointWeights(t, active.filter((b) => b.ownership === "JOINT").map((b) => b.id));
  const byOwner = new Map<string, { amount: number; batches: number; qty: number }>();
  const addOwner = (k: string, amount: number, batches: number, qty: number) => {
    const v = byOwner.get(k) ?? { amount: 0, batches: 0, qty: 0 };
    v.amount += amount;
    v.batches += batches;
    v.qty += qty;
    byOwner.set(k, v);
  };
  const jointShares: Record<string, { key: string; amount: number; percent: number }[]> = {};
  for (const b of active) {
    // 有指定「誰付的」費用直接算給那個人；其餘跟著這團的歸屬
    for (const [k, v] of b.fee.byPayer) addOwner(k, v, 0, 0);
    const base = b.totalTwd - b.fee.overrideTwd;
    if (b.ownership !== "JOINT") {
      addOwner(b.ownerKey, base, 1, b.qty);
      continue;
    }
    jointShares[b.id] = sharePercents(weights.get(b.id));
    const split = splitByWeights(base, weights.get(b.id));
    if (!split) addOwner(JOINT, base, 1, b.qty);
    else {
      addOwner(JOINT, 0, 1, b.qty);
      for (const [k, v] of split) addOwner(k, v, 0, 0);
    }
  }
  // 依進度分（金額＝該團總額；待到貨件數）
  const byStage = new Map<string, { amount: number; batches: number; outstanding: number }>();
  for (const b of active) {
    const v = byStage.get(b.stage) ?? { amount: 0, batches: 0, outstanding: 0 };
    v.amount += b.totalTwd;
    v.batches += 1;
    v.outstanding += b.outstanding;
    byStage.set(b.stage, v);
  }
  // 這個活動進來的庫存，依歸屬分
  const itemIds = batches.flatMap((b) => b.items.filter((i) => itemSeries(i, b) === categoryId).map((i) => i.id));
  const stockPer = await stockByOwner(t, { batchItemIds: itemIds });
  const stock = new Map<string, { onHand: number; free: number; reserved: number; kept: number }>();
  for (const per of stockPer.values())
    for (const [k, v] of per) {
      const x = stock.get(k) ?? { onHand: 0, free: 0, reserved: 0, kept: 0 };
      x.onHand += v.onHand;
      x.free += v.free;
      x.reserved += v.reserved;
      x.kept += v.kept;
      stock.set(k, x);
    }
  return {
    batches: summariesWithPay.map(({ fee: f, ...x }) => { const { ratio, ...rest } = x; void ratio; return { ...rest, unallocFeesTwd: f.unallocTwd }; }),
    matrix,
    byOwner: Object.fromEntries(byOwner),
    byStage: Object.fromEntries(byStage),
    stock: Object.fromEntries(stock),
    jointShares,
    total: {
      paidTwd: active.reduce((s, b) => s + b.paidTwd, 0),
      dueTwd: active.reduce((s, b) => s + b.dueTwd, 0),
      batches: active.length,
      qty: active.reduce((s, b) => s + b.qty, 0),
      received: active.reduce((s, b) => s + b.received, 0),
      outstanding: active.reduce((s, b) => s + b.outstanding, 0),
      totalTwd: active.reduce((s, b) => s + b.totalTwd, 0),
      estimated: active.some((b) => b.estimated || !b.feesRecorded),
    },
  };
}

/** 活動總表：每個活動的採購團數、總額、依人分的金額、待到貨件數（不含已取消的團） */
export async function categoriesSummary(t: Tx) {
  const batches = await t.purchaseBatch.findMany({
    where: { OR: [{ categoryId: { not: null } }, { items: { some: { categoryId: { not: null } } } }], status: { not: "CANCELLED" } },
    select: {
      id: true,
      categoryId: true,
      ownership: true,
      orderedById: true,
      rateMicro: true,
      items: { select: { categoryId: true, qty: true, cancelledQty: true, currency: true, estUnitCost: true, actualUnitCost: true, allocations: { select: { amountTwd: true } }, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } },
      costs: { select: { currency: true, amount: true, method: true, payer: true, shareSplit: true } },
    },
  });
  const weights = await jointWeights(t, batches.filter((b) => b.ownership === "JOINT").map((b) => b.id));
  const out = new Map<string, { batches: number; totalTwd: number; outstanding: number; byOwner: Record<string, number> }>();
  for (const b of batches) {
    // 一團有好幾個系列：每個系列照商品金額比例分這團的錢
    const fullFee = summarizeFees(b.costs, b.rateMicro);
    let full = fullFee.unallocTwd;
    for (const i of b.items) full += itemGoodsTwd(i, b.rateMicro) + i.allocations.reduce((s, a) => s + a.amountTwd, 0);
    const seriesIds = new Set(b.items.map((i) => itemSeries(i, b)).filter((x): x is string => !!x));
    if (!b.items.length && b.categoryId) seriesIds.add(b.categoryId);
    for (const cid of seriesIds) {
      const r = seriesRatio(b, cid);
      const v = out.get(cid) ?? { batches: 0, totalTwd: 0, outstanding: 0, byOwner: {} };
      for (const i of b.items) if (itemSeries(i, b) === cid) v.outstanding += Math.max(0, i.qty - i.cancelledQty - i.movements.reduce((s, m) => s + m.onHandDelta, 0));
      const total = Math.round(full * r);
      v.batches += 1;
      v.totalTwd += total;
      for (const [k, x] of fullFee.byPayer) v.byOwner[k] = (v.byOwner[k] ?? 0) + Math.round(x * r);
      const base = total - Math.round(fullFee.overrideTwd * r);
      const key = batchOwnerKey(b);
      const split = key === JOINT ? splitByWeights(base, weights.get(b.id)) : null;
      if (split) for (const [k, x] of split) v.byOwner[k] = (v.byOwner[k] ?? 0) + x;
      else v.byOwner[key] = (v.byOwner[key] ?? 0) + base;
      out.set(cid, v);
    }
  }
  return out;
}

/**
 * 採購團付款狀態（台幣）：總額＝商品（依該團鎖定匯率換算）＋分攤費用；已付＝已付款的供應商付款
 * （日幣用該筆實際匯率，沒填用該團匯率）；還要付＝總額 − 已付（不小於 0）。待付款的登記不算已付。
 */
export async function batchPaySummary(t: Tx, batchIds: string[]) {
  const ids = [...new Set(batchIds)];
  const out = new Map<string, { totalTwd: number; paidTwd: number; dueTwd: number }>();
  if (!ids.length) return out;
  const batches = await t.purchaseBatch.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      rateMicro: true,
      items: { select: { qty: true, cancelledQty: true, currency: true, estUnitCost: true, actualUnitCost: true, allocations: { select: { amountTwd: true } } } },
      supplierPayments: { where: { status: "PAID" }, select: { amount: true, currency: true, rateMicro: true } },
      costs: { select: { currency: true, amount: true, method: true, payer: true, shareSplit: true } },
    },
  });
  for (const b of batches) {
    const total = b.items.reduce((s, i) => s + itemGoodsTwd(i, b.rateMicro) + i.allocations.reduce((a, x) => a + x.amountTwd, 0), 0) + summarizeFees(b.costs, b.rateMicro).unallocTwd;
    const paid = b.supplierPayments.reduce((s, p) => s + (p.currency === "TWD" ? p.amount : jpyToTwd(p.amount, p.rateMicro ?? b.rateMicro)), 0);
    out.set(b.id, { totalTwd: total, paidTwd: paid, dueTwd: Math.max(0, total - paid) });
  }
  return out;
}

/** 一鍵付清：把「還要付」的金額登記成一筆台幣付款（重送不重複） */
export async function payRemaining(t: Tx, actor: Actor, batchId: string, input: { paidById: string | null; dedupeKey: string }) {
  await lockRows(t, "PurchaseBatch", [batchId]);
  const dup = await t.supplierPayment.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (dup) return { payment: dup, duplicated: true };
  const b = await t.purchaseBatch.findUnique({ where: { id: batchId } });
  if (!b) throw new BizError("找不到採購團");
  if (b.status === "CANCELLED") throw new BizError("已取消的採購團不能登記付款");
  const s = (await batchPaySummary(t, [batchId])).get(batchId)!;
  if (s.dueTwd <= 0) throw new BizError("這團已經付清了");
  const { addSupplierPayment } = await import("./supplier-payments");
  return addSupplierPayment(t, actor, { batchId, paidById: input.paidById, paidAt: new Date(), amount: s.dueTwd, currency: "TWD", purpose: s.paidTwd > 0 ? "BALANCE" : "FULL", note: "一鍵付清", dedupeKey: input.dedupeKey });
}

/** 每個人還要付多少（現金流）：個人團算主人、合資團另外列、沒指定的列在未指定。不含已取消的團 */
export async function dueByOwner(t: Tx, where: { categoryId?: string | null } = {}) {
  const cid = where.categoryId;
  const batches = await t.purchaseBatch.findMany({
    where: { status: { not: "CANCELLED" }, ...(cid ? batchesWithSeries(cid) : cid === null ? { categoryId: null } : {}) },
    select: { id: true, ownership: true, orderedById: true, categoryId: true, rateMicro: true, items: { select: { categoryId: true, qty: true, cancelledQty: true, currency: true, estUnitCost: true, actualUnitCost: true, allocations: { select: { amountTwd: true } } } } },
  });
  const pay = await batchPaySummary(t, batches.map((b) => b.id));
  const out = new Map<string, { due: number; batches: number }>();
  for (const b of batches) {
    // 看某個系列時，一團有好幾個系列就只算這個系列的比例
    const due = Math.round((pay.get(b.id)?.dueTwd ?? 0) * (cid ? seriesRatio(b, cid) : 1));
    if (due <= 0) continue;
    const k = b.ownership === "JOINT" ? "joint" : (b.orderedById ?? "none");
    const v = out.get(k) ?? { due: 0, batches: 0 };
    v.due += due;
    v.batches += 1;
    out.set(k, v);
  }
  return out;
}

/**
 * 對單：還在「待確認」的件數（代購還沒回買不買得到）
 * 已取消的團、實體店買的不用確認；已到貨的一定算買到
 */
export function pendingQty(i: { qty: number; cancelledQty: number; confirmedQty: number; batch: { status: string; supplierRef?: { kind: string | null } | null } }, received: number) {
  if (i.batch.status === "CANCELLED" || isStoreKind(i.batch.supplierRef?.kind)) return 0;
  return Math.max(0, i.qty - i.cancelledQty - Math.max(i.confirmedQty, received));
}
