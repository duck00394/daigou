// 匯入引擎：LINE 與 Excel 共用的驗證、重複偵測與正式建單流程。
// 原則：
//   1. 預覽階段只寫入 ImportBatch / ImportRow（暫存區），不建立正式訂單。
//   2. 只有狀態為 READY 的列會建立訂單；待確認、錯誤、可能重複（未確認）、排除的列一律跳過。
//   3. 每張訂單一個交易：訂單與明細與「列已完成」標記同時成功或同時失敗。
//   4. 重試只處理尚未完成的列，已完成的列不會重複建立。
import { createHash } from "node:crypto";
import { BizError, prisma, tx, type Db, type Tx } from "@/server/db";
import { normalizeKey } from "@/lib/normalize";
import type { Actor } from "@/server/services/common";
import { createOrder, appendItems } from "@/server/services/orders";
import { createBuyer, addBuyerAlias, buyerWarnings } from "@/server/services/buyers";
import { addProductAlias } from "@/server/services/catalog";
import { addPayment } from "@/server/services/payments";
import { matchBuyer, matchProduct, type Lexicon } from "@/server/services/matching";
import type { Candidates, RowMessage, RowParsed, RowResolution } from "./types";
import type { ImportRow, ImportRowStatus, Prisma } from "@prisma/client";

export const DUP_WINDOW_DAYS = 3;
const STALE_COMMIT_MS = 5 * 60 * 1000;

export function hashOf(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/** 依解析結果產生初始的確認值：只有完全相符且唯一的買家與商品會自動帶入 */
export function initialResolution(lex: Lexicon, p: RowParsed, defaults: { groupBuyId?: string | null }): { resolution: RowResolution; candidates: Candidates } {
  const bm = matchBuyer(lex, p.buyerText);
  let buyerId: string | null = bm.status === "exact" ? bm.match.id : null;
  let buyerCands = bm.candidates;
  if (!buyerId && p.lineNameText) {
    const lm = matchBuyer(lex, p.lineNameText);
    if (lm.status === "exact") buyerId = lm.match.id;
    buyerCands = [...buyerCands, ...lm.candidates.filter((c) => !buyerCands.some((x) => x.id === c.id))];
  }
  const pm = p.vague ? null : matchProduct(lex, p.productText);
  const productId = pm?.status === "exact" ? pm.match.id : null;
  let unitPrice = p.unitPrice ?? null;
  if (unitPrice === null && p.subtotal !== null && p.subtotal !== undefined && p.qty && p.subtotal % p.qty === 0) unitPrice = p.subtotal / p.qty;
  return {
    resolution: {
      buyerId,
      productId,
      qty: p.qty,
      unitPrice,
      specNote: p.specText ?? null,
      groupBuyId: defaults.groupBuyId ?? null,
      appendMode: "NEW",
      externalRef: p.externalRef ?? null,
      orderedAt: p.orderDate ?? null,
      paidAmount: p.paidAmount ?? null,
      shippingFee: p.shippingFee ?? null,
      notes: p.notes ?? null,
    },
    candidates: {
      buyers: buyerCands.map((c) => ({ id: c.id, code: c.code, name: c.name, via: c.via, score: c.score })),
      products: (pm?.candidates ?? []).map((c) => ({ id: c.id, code: c.code, name: c.name, salePriceTwd: c.salePriceTwd, via: c.via, score: c.score })),
    },
  };
}

interface EvalCtx {
  products: Map<string, { id: string; name: string; salePriceTwd: number | null; archivedAt: Date | null; categoryIds: string[] }>;
  buyers: Map<string, { id: string; name: string; mergedIntoId: string | null }>;
  orders: Map<string, { id: string; buyerId: string; groupBuyId: string | null; confirmation: string; statusCache: string; orderNo: string }>;
  existingRefs: Set<string>; // 已存在的 Excel 來源訂單編號
  committedHashes: Set<string>; // 已建立訂單的列雜湊
  recentItems: { buyerId: string; productId: string; qty: number; orderedAt: Date; orderNo: string }[];
  warnings: Map<string, { name: string; reason: string | null }[]>;
}

export async function buildEvalCtx(db: Db, rows: { resolution: RowResolution; rowHash: string | null }[], source: "LINE" | "EXCEL"): Promise<EvalCtx> {
  const productIds = [...new Set(rows.map((r) => r.resolution.productId).filter(Boolean) as string[])];
  const buyerIds = [...new Set(rows.map((r) => r.resolution.buyerId).filter(Boolean) as string[])];
  const orderIds = [...new Set(rows.map((r) => r.resolution.appendOrderId).filter(Boolean) as string[])];
  const refs = [...new Set(rows.map((r) => r.resolution.externalRef).filter(Boolean) as string[])];
  const hashes = [...new Set(rows.map((r) => r.rowHash).filter(Boolean) as string[])];
  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const [products, buyers, orders, existing, committed, recent, warnings] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, include: { categories: { select: { categoryId: true } } } }),
    db.buyer.findMany({ where: { id: { in: buyerIds } }, select: { id: true, name: true, mergedIntoId: true } }),
    db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, buyerId: true, groupBuyId: true, confirmation: true, statusCache: true, orderNo: true } }),
    refs.length ? db.order.findMany({ where: { source, externalRef: { in: refs } }, select: { externalRef: true } }) : Promise.resolve([]),
    hashes.length ? db.importRow.findMany({ where: { rowHash: { in: hashes }, status: "COMMITTED" }, select: { rowHash: true } }) : Promise.resolve([]),
    buyerIds.length
      ? db.orderItem.findMany({
          where: { order: { buyerId: { in: buyerIds }, orderedAt: { gte: since }, confirmation: { not: "CANCELLED" } }, productId: { in: productIds } },
          select: { productId: true, qty: true, order: { select: { buyerId: true, orderedAt: true, orderNo: true } } },
        })
      : Promise.resolve([]),
    buyerIds.length ? buyerWarnings(db as Tx, buyerIds) : Promise.resolve(new Map()),
  ]);
  return {
    products: new Map(products.map((p) => [p.id, { id: p.id, name: p.name, salePriceTwd: p.salePriceTwd, archivedAt: p.archivedAt, categoryIds: p.categories.map((c) => c.categoryId) }])),
    buyers: new Map(buyers.map((b) => [b.id, b])),
    orders: new Map(orders.map((o) => [o.id, o])),
    existingRefs: new Set(existing.map((e) => e.externalRef as string)),
    committedHashes: new Set(committed.map((c) => c.rowHash as string)),
    recentItems: recent.map((r) => ({ buyerId: r.order.buyerId, productId: r.productId, qty: r.qty, orderedAt: r.order.orderedAt, orderNo: r.order.orderNo })),
    warnings: warnings as EvalCtx["warnings"],
  };
}

/** 依目前的確認值判斷列狀態與訊息 */
export function evaluateRow(
  row: { status: ImportRowStatus; parsed: RowParsed; resolution: RowResolution; rowHash: string | null },
  ctx: EvalCtx,
  batchHashCount?: Map<string, number>,
): { status: ImportRowStatus; messages: RowMessage[] } {
  if (row.status === "COMMITTED" || row.status === "EXCLUDED") return { status: row.status, messages: [] };
  const p = row.parsed;
  const r = row.resolution;
  const msgs: RowMessage[] = [];
  let pending = false;
  let error = false;
  let dup = false;

  for (const issue of p.parseIssues ?? []) msgs.push({ level: "warning", text: issue });

  // 買家
  if (r.buyerId) {
    const b = ctx.buyers.get(r.buyerId);
    if (!b) {
      msgs.push({ level: "error", text: "選擇的買家不存在" });
      error = true;
    } else if (b.mergedIntoId) {
      msgs.push({ level: "error", text: `買家「${b.name}」已合併，請改選主要買家` });
      error = true;
    } else {
      for (const w of ctx.warnings.get(r.buyerId) ?? []) msgs.push({ level: "warning", text: `買家標籤提醒：${w.name}${w.reason ? `（${w.reason}）` : ""}` });
    }
  } else if (r.newBuyerName?.trim()) {
    msgs.push({ level: "info", text: `將新增買家「${r.newBuyerName.trim()}」` });
  } else {
    msgs.push({ level: "warning", text: p.buyerText ? `買家「${p.buyerText}」待確認：請選擇既有買家或新增買家` : "缺少買家" });
    pending = true;
  }

  // 商品
  if (p.vague && !r.productId) {
    msgs.push({ level: "warning", text: `「${p.productText}」無法判斷是哪個商品，請手動選擇` });
    pending = true;
  } else if (r.productId) {
    const prod = ctx.products.get(r.productId);
    if (!prod) {
      msgs.push({ level: "error", text: "選擇的商品不存在" });
      error = true;
    } else {
      if (prod.archivedAt) {
        msgs.push({ level: "error", text: `商品「${prod.name}」已封存` });
        error = true;
      }
      if ((r.unitPrice === null || r.unitPrice === undefined) && prod.salePriceTwd === null) {
        msgs.push({ level: "warning", text: "商品沒有設定代購售價，請填寫成交單價" });
        pending = true;
      }
      if (r.categoryId && !prod.categoryIds.includes(r.categoryId)) {
        msgs.push({ level: "error", text: "商品不屬於指定的分類" });
        error = true;
      }
    }
  } else {
    msgs.push({ level: "warning", text: p.productText ? `商品「${p.productText}」待確認：請配對既有商品或先新增商品` : "缺少商品" });
    pending = true;
  }

  // 數量與金額
  if (r.qty === null || r.qty === undefined || !Number.isInteger(r.qty) || r.qty <= 0) {
    msgs.push({ level: "error", text: p.qtyText ? `數量「${p.qtyText}」不是有效的正整數` : "數量必須是正整數" });
    error = true;
  } else if (p.qtyMissing) {
    msgs.push({ level: "info", text: "原文沒有寫數量，預設 1" });
  }
  if (r.unitPrice !== null && r.unitPrice !== undefined && (!Number.isInteger(r.unitPrice) || r.unitPrice < 0)) {
    msgs.push({ level: "error", text: "單價必須是不小於 0 的整數" });
    error = true;
  }
  if (p.subtotal !== null && p.subtotal !== undefined && r.unitPrice != null && r.qty) {
    if (r.unitPrice * r.qty !== p.subtotal) msgs.push({ level: "warning", text: `小計 ${p.subtotal} 與單價 × 數量（${r.unitPrice * r.qty}）不符，將以單價 × 數量為準` });
  }
  if (r.orderedAt && Number.isNaN(Date.parse(r.orderedAt))) {
    msgs.push({ level: "error", text: "訂單日期格式錯誤" });
    error = true;
  }
  if (r.paidAmount != null && (!Number.isInteger(r.paidAmount) || r.paidAmount < 0)) {
    msgs.push({ level: "error", text: "已付金額必須是不小於 0 的整數" });
    error = true;
  }
  if (p.shipStatusText && /已出|出貨|寄出|已寄/.test(p.shipStatusText)) {
    msgs.push({ level: "warning", text: `原始出貨狀態為「${p.shipStatusText}」：匯入不會自動建立出貨紀錄，請在出貨頁登記` });
  }

  // 追加
  if (r.appendMode === "APPEND") {
    const o = r.appendOrderId ? ctx.orders.get(r.appendOrderId) : null;
    if (!o) {
      msgs.push({ level: "warning", text: "請選擇要追加的原訂單" });
      pending = true;
    } else if (r.buyerId && o.buyerId !== r.buyerId) {
      msgs.push({ level: "error", text: `原訂單 ${o.orderNo} 不屬於這位買家` });
      error = true;
    } else if (o.confirmation === "CANCELLED" || o.statusCache === "COMPLETED") {
      msgs.push({ level: "error", text: `原訂單 ${o.orderNo} 已取消或已完成，請改為建立獨立追加訂單` });
      error = true;
    } else if ((o.groupBuyId ?? null) !== (r.groupBuyId ?? null)) {
      msgs.push({ level: "error", text: `原訂單 ${o.orderNo} 屬於不同代購團，不能合併` });
      error = true;
    }
  } else if (p.append) {
    msgs.push({ level: "info", text: "原文含有追加字樣；預設建立新訂單，可改為追加到原訂單" });
  }

  // 重複偵測
  if (r.externalRef && ctx.existingRefs.has(r.externalRef)) {
    msgs.push({ level: "error", text: `來源訂單編號「${r.externalRef}」已經匯入過` });
    error = true;
  }
  if (row.rowHash && ctx.committedHashes.has(row.rowHash)) {
    msgs.push({ level: "warning", text: "同樣內容先前已經建立過訂單（可能重複）" });
    dup = true;
  }
  if (row.rowHash && (batchHashCount?.get(row.rowHash) ?? 0) > 1) {
    msgs.push({ level: "warning", text: "本次資料中有內容完全相同的列（可能重複）" });
    dup = true;
  }
  if (r.buyerId && r.productId && r.qty && !r.externalRef) {
    const at = r.orderedAt ? new Date(r.orderedAt) : new Date();
    const hit = ctx.recentItems.find(
      (x) => x.buyerId === r.buyerId && x.productId === r.productId && x.qty === r.qty && Math.abs(x.orderedAt.getTime() - at.getTime()) <= DUP_WINDOW_DAYS * 86400000,
    );
    if (hit) {
      msgs.push({ level: "warning", text: `${DUP_WINDOW_DAYS} 天內已有相同買家、商品、數量的訂單 ${hit.orderNo}（可能重複）` });
      dup = true;
    }
  }

  let status: ImportRowStatus;
  if (error) status = "ERROR";
  else if (pending) status = "PENDING_REVIEW";
  else if (dup && !r.forceDuplicate) status = "DUPLICATE_SUSPECT";
  else status = row.status === "FAILED" ? "READY" : "READY";
  if (dup && r.forceDuplicate) msgs.push({ level: "info", text: "已確認仍要建立" });
  return { status, messages: msgs };
}

/** 重新驗證整個批次（每次使用者修改後呼叫） */
export async function revalidateBatch(db: Db, batchId: string) {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { rows: true } });
  const rows = batch.rows.map((r) => ({ ...r, parsed: r.parsed as unknown as RowParsed & { candidates?: Candidates }, resolution: (r.resolution ?? {}) as RowResolution }));
  const ctx = await buildEvalCtx(db, rows, batch.kind);
  const hashCount = new Map<string, number>();
  for (const r of rows) if (r.rowHash && r.status !== "EXCLUDED" && r.status !== "COMMITTED") hashCount.set(r.rowHash, (hashCount.get(r.rowHash) ?? 0) + 1);
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const r of rows) {
    const ev = evaluateRow(r, ctx, hashCount);
    if (ev.status !== r.status || JSON.stringify(ev.messages) !== JSON.stringify(r.messages)) {
      if (r.status === "COMMITTED" || r.status === "EXCLUDED") continue;
      updates.push(db.importRow.update({ where: { id: r.id }, data: { status: ev.status, messages: ev.messages as unknown as Prisma.InputJsonValue } }));
    }
  }
  if (updates.length) {
    // 分段執行，避免單一交易過大
    for (let i = 0; i < updates.length; i += 200) await prisma.$transaction(updates.slice(i, i + 200));
  }
}

export async function updateRowResolution(batchId: string, rowId: string, patch: Partial<RowResolution> & { exclude?: boolean }) {
  const row = await prisma.importRow.findUniqueOrThrow({ where: { id: rowId }, include: { batch: true } });
  if (row.batchId !== batchId) throw new BizError("資料列不屬於這個批次");
  if (row.batch.status === "COMMITTED" || row.batch.status === "DISCARDED") throw new BizError("這個批次已結束，不能再修改");
  if (row.batch.status === "COMMITTING") throw new BizError("正在建立訂單中，請稍候");
  if (row.status === "COMMITTED") throw new BizError("這一列已建立訂單，不能修改");
  const { exclude, ...rest } = patch;
  const resolution = { ...((row.resolution ?? {}) as RowResolution), ...rest };
  if (rest.buyerId) resolution.newBuyerName = null;
  if (rest.newBuyerName) resolution.buyerId = null;
  let status: ImportRowStatus = row.status;
  if (exclude === true) status = "EXCLUDED";
  if (exclude === false && row.status === "EXCLUDED") status = "PENDING_REVIEW";
  await prisma.importRow.update({ where: { id: rowId }, data: { resolution: resolution as unknown as Prisma.InputJsonValue, status } });
  await revalidateBatch(prisma, batchId);
}

/** 批次套用（例如整批指定代購團） */
export async function bulkUpdateRows(batchId: string, rowIds: string[], patch: Partial<RowResolution> & { exclude?: boolean }) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status !== "DRAFT" && batch.status !== "PARTIAL") throw new BizError("這個批次目前不能修改");
  const rows = await prisma.importRow.findMany({ where: { batchId, id: { in: rowIds }, status: { not: "COMMITTED" } } });
  const { exclude, ...rest } = patch;
  for (const row of rows) {
    const resolution = { ...((row.resolution ?? {}) as RowResolution), ...rest };
    let status: ImportRowStatus = row.status;
    if (exclude === true) status = "EXCLUDED";
    if (exclude === false && row.status === "EXCLUDED") status = "PENDING_REVIEW";
    await prisma.importRow.update({ where: { id: row.id }, data: { resolution: resolution as unknown as Prisma.InputJsonValue, status } });
  }
  await revalidateBatch(prisma, batchId);
}

export interface CommitSummary {
  ordersCreated: number;
  ordersAppended: number;
  rowsCommitted: number;
  rowsFailed: number;
  rowsSkipped: number; // 待確認、錯誤、可能重複（未確認）
  rowsExcluded: number;
  buyersCreated: number;
  orderNos: string[];
  failures: { rowNo: number; message: string }[];
  alreadyCommitted?: boolean;
}

type GroupRow = Omit<ImportRow, "parsed"> & { res: RowResolution; parsed: RowParsed };

export function groupKey(kind: "LINE" | "EXCEL", r: GroupRow): string {
  const buyerKey = r.res.buyerId ? `b:${r.res.buyerId}` : `n:${normalizeKey(r.res.newBuyerName ?? "")}`;
  const mode = r.res.appendMode ?? "NEW";
  const base = [buyerKey, r.res.groupBuyId ?? "", mode, mode === "APPEND" ? r.res.appendOrderId : ""].join("|");
  if (kind === "EXCEL") {
    if (r.res.externalRef) return `ref:${r.res.externalRef}`;
    const d = r.res.orderedAt ? r.res.orderedAt.slice(0, 10) : "";
    return `${base}|${d}`;
  }
  return base;
}

/**
 * 正式建立訂單。可安全重複呼叫：
 *  - 批次以狀態鎖（DRAFT/PARTIAL → COMMITTING）防止同時送出兩次；
 *  - 已完成的列不會再處理。
 */
export async function commitBatch(actor: Actor, batchId: string): Promise<CommitSummary> {
  const now = Date.now();
  const lock = await prisma.importBatch.updateMany({
    where: {
      id: batchId,
      OR: [{ status: { in: ["DRAFT", "PARTIAL"] } }, { status: "COMMITTING", updatedAt: { lt: new Date(now - STALE_COMMIT_MS) } }],
    },
    data: { status: "COMMITTING" },
  });
  if (lock.count === 0) {
    const b = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (b.status === "COMMITTED") return { ...((b.summary ?? {}) as unknown as CommitSummary), alreadyCommitted: true };
    if (b.status === "COMMITTING") throw new BizError("這批資料正在建立訂單中，請勿重複送出");
    throw new BizError("這個批次目前不能建立訂單");
  }

  const summary: CommitSummary = { ordersCreated: 0, ordersAppended: 0, rowsCommitted: 0, rowsFailed: 0, rowsSkipped: 0, rowsExcluded: 0, buyersCreated: 0, orderNos: [], failures: [] };
  try {
    await revalidateBatch(prisma, batchId);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { rows: { orderBy: [{ rowNo: "asc" }, { seq: "asc" }] } } });
    const rows: GroupRow[] = batch.rows.map((r) => ({ ...r, res: (r.resolution ?? {}) as RowResolution, parsed: r.parsed as unknown as RowParsed }));
    const ready = rows.filter((r) => r.status === "READY");
    summary.rowsExcluded = rows.filter((r) => r.status === "EXCLUDED").length;
    summary.rowsSkipped = rows.filter((r) => ["PENDING_REVIEW", "ERROR", "DUPLICATE_SUSPECT"].includes(r.status)).length;

    const groups = new Map<string, GroupRow[]>();
    for (const r of ready) {
      const k = groupKey(batch.kind, r);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const newBuyerIds = new Map<string, string>(); // 同一批次中同名的新買家只建立一次

    for (const [, grp] of groups) {
      try {
        const result = await tx(async (t) => {
          // 再次確認這些列尚未完成（防止並行重複）
          const fresh = await t.importRow.findMany({ where: { id: { in: grp.map((g) => g.id) } }, select: { id: true, status: true } });
          if (fresh.some((f) => f.status !== "READY")) throw new BizError("資料列狀態已變更，請重新整理後再試");
          const first = grp[0];
          let buyerId = first.res.buyerId ?? null;
          let createdBuyer = false;
          if (!buyerId) {
            const key = normalizeKey(first.res.newBuyerName ?? "");
            buyerId = newBuyerIds.get(key) ?? null;
            if (!buyerId) {
              const existing = await t.buyer.findFirst({ where: { name: first.res.newBuyerName!.trim(), mergedIntoId: null, createdAt: { gte: batch.createdAt } } });
              const b = existing ?? (await createBuyer(t, actor, { name: first.res.newBuyerName!.trim(), lineName: first.res.newBuyerLineName ?? first.parsed.lineNameText ?? null }));
              buyerId = b.id;
              createdBuyer = !existing;
            }
          }
          const items = grp.map((g) => ({
            productId: g.res.productId!,
            qty: g.res.qty!,
            unitPrice: g.res.unitPrice ?? null,
            specNote: g.res.specNote ?? null,
            categoryId: g.res.categoryId ?? null,
            notes: g.res.notes ?? null,
          }));
          const rawInput = grp.map((g) => (typeof g.raw === "object" && g.raw && "text" in (g.raw as object) ? (g.raw as { text: string }).text : JSON.stringify(g.raw))).filter((v, i, a) => a.indexOf(v) === i).join("\n");
          let orderId: string;
          let orderNo: string;
          let itemIds: string[];
          let appended = false;
          if (first.res.appendMode === "APPEND" && first.res.appendOrderId) {
            const created = await appendItems(t, actor, first.res.appendOrderId, items, `由${batch.kind === "LINE" ? " LINE 貼上" : " Excel 匯入"}追加`);
            const o = await t.order.findUniqueOrThrow({ where: { id: first.res.appendOrderId } });
            orderId = o.id;
            orderNo = o.orderNo;
            itemIds = created.map((c) => c.id);
            appended = true;
          } else {
            const shipFee = grp.find((g) => g.res.shippingFee != null)?.res.shippingFee ?? 0;
            const order = await createOrder(t, actor, {
              buyerId,
              groupBuyId: first.res.groupBuyId ?? null,
              parentOrderId: first.res.appendMode === "NEW_LINKED" ? (first.res.appendOrderId ?? null) : null,
              source: batch.kind,
              externalRef: batch.kind === "EXCEL" ? (first.res.externalRef ?? null) : null,
              rawInput,
              orderedAt: first.res.orderedAt ? new Date(first.res.orderedAt) : undefined,
              shippingFee: shipFee,
              importBatchId: batch.id,
              items,
            });
            orderId = order.id;
            orderNo = order.orderNo;
            itemIds = order.items.map((i) => i.id);
          }
          // 使用者勾選「記住別名」時才建立對照
          for (const g of grp) {
            if (g.res.saveProductAlias && g.parsed.productText && g.res.productId) {
              const exists = await t.productAlias.findUnique({ where: { normalized: normalizeKey(g.parsed.productText) } });
              if (!exists) await addProductAlias(t, actor, g.res.productId, g.parsed.productText);
            }
            if (g.res.saveBuyerAlias && g.parsed.buyerText) await addBuyerAlias(t, actor, buyerId, g.parsed.buyerText);
          }
          // Excel 的已付金額：建立一筆付款紀錄
          const paid = grp.reduce((s, g) => s + (g.res.paidAmount ?? 0), 0);
          if (paid > 0) await addPayment(t, actor, { orderId, amount: paid, method: "匯入", note: `Excel 匯入（${batch.fileName ?? ""}）`, dedupeKey: `import:${batch.id}:${orderId}` });
          for (let k = 0; k < grp.length; k++) {
            await t.importRow.update({ where: { id: grp[k].id }, data: { status: "COMMITTED", orderId, orderItemId: itemIds[k] ?? null } });
          }
          return { orderNo, appended, createdBuyer, buyerId, newKey: first.res.buyerId ? null : normalizeKey(first.res.newBuyerName ?? "") };
        }, { timeout: 60_000 });
        if (result.newKey) newBuyerIds.set(result.newKey, result.buyerId);
        if (result.createdBuyer) summary.buyersCreated += 1;
        if (result.appended) summary.ordersAppended += 1;
        else summary.ordersCreated += 1;
        summary.orderNos.push(result.orderNo);
        summary.rowsCommitted += grp.length;
      } catch (e) {
        const message = e instanceof BizError ? e.message : `系統錯誤：${(e as Error).message}`;
        summary.rowsFailed += grp.length;
        for (const g of grp) summary.failures.push({ rowNo: g.rowNo, message });
        await prisma.importRow.updateMany({
          where: { id: { in: grp.map((g) => g.id) }, status: { not: "COMMITTED" } },
          data: { status: "FAILED", messages: [{ level: "error", text: `建立失敗：${message}` }] as unknown as Prisma.InputJsonValue },
        });
      }
    }
    const remaining = await prisma.importRow.count({ where: { batchId, status: { in: ["READY", "FAILED", "PENDING_REVIEW", "ERROR", "DUPLICATE_SUSPECT"] } } });
    const prev = (batch.summary ?? null) as unknown as CommitSummary | null;
    const total: CommitSummary = prev
      ? {
          ...summary,
          ordersCreated: prev.ordersCreated + summary.ordersCreated,
          ordersAppended: prev.ordersAppended + summary.ordersAppended,
          rowsCommitted: prev.rowsCommitted + summary.rowsCommitted,
          buyersCreated: prev.buyersCreated + summary.buyersCreated,
          orderNos: [...prev.orderNos, ...summary.orderNos],
        }
      : summary;
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: remaining > 0 ? "PARTIAL" : "COMMITTED", committedAt: new Date(), summary: total as unknown as Prisma.InputJsonValue },
    });
    await prisma.auditLog.create({ data: { actorId: actor.userId, action: "import.commit", entity: "ImportBatch", entityId: batchId, data: summary as unknown as Prisma.InputJsonValue } });
    return summary;
  } catch (e) {
    // 非預期錯誤：解除鎖定，讓使用者可以重試
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: "PARTIAL" } });
    throw e;
  }
}

export async function discardBatch(actor: Actor, batchId: string) {
  const b = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (b.status === "COMMITTING") throw new BizError("正在建立訂單中，不能放棄");
  if (b.status === "COMMITTED") throw new BizError("已完成的批次不能放棄");
  await prisma.importBatch.update({ where: { id: batchId }, data: { status: "DISCARDED" } });
  await prisma.auditLog.create({ data: { actorId: actor.userId, action: "import.discard", entity: "ImportBatch", entityId: batchId } });
}

