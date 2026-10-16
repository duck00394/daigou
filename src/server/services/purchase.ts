// 採購團（採購批次）：向供應商採購的品項、預估與實際單價、匯率快照與共同費用分攤。
import { BizError, lockRows, type Tx } from "@/server/db";
import { allocate, jpyToTwd, mulDiv, parseRate } from "@/lib/money";
import { audit, emptyToNull, nextCode, type Actor } from "./common";
import { getDefaultRateMicro } from "./settings";
import { recomputeOrder } from "./recompute";
import { checkOperator } from "./operators";
import { refreshBatchStatusById } from "./inventory";
import type { AllocationMethod, BatchCostKind } from "@prisma/client";
import { JOINT_PAYER, feeTwd } from "./fees";

export type Currency = "JPY" | "TWD";
export const CURRENCIES: Currency[] = ["JPY", "TWD"];

export interface BatchItemInput {
  productId: string;
  qty: number;
  unitCost: number; // 採購預估單價（依幣別）
  currency?: Currency;
  actualUnitCost?: number | null;
  salePriceTwd?: number | null;
  specNote?: string | null;
  weightGrams?: number | null;
  markOrderItemIds?: string[];
  dedupeKey?: string | null;
}

export async function createBatch(
  t: Tx,
  actor: Actor,
  input: {
    name: string;
    supplierId?: string | null;
    supplier?: string | null; // 相容舊介面：供應商名稱，不存在時自動建立
    rate?: string | null; // 未填時使用目前預設匯率，建立後即鎖定
    orderedAt?: Date | null;
    notes?: string | null;
    items?: BatchItemInput[];
    orderedById?: string | null; // 訂購負責人（經營者）
    paymentResponsibleById?: string | null; // 主要付款負責人
    receivingResponsibleById?: string | null; // 收貨負責人
    responsibilityNote?: string | null;
    categoryId?: string | null; // 所屬代購活動／系列
    supplierOrderNo?: string | null;
    orderUrl?: string | null;
    expectedAt?: Date | null;
    ownership?: "PERSONAL" | "JOINT"; // 個人（歸 orderedById）或合資
    progress?: "ASKED" | "AGENT_HAS" | "SHIPPED";
  },
) {
  if (!input.name?.trim()) throw new BizError("請填寫採購團名稱");
  const ownership = input.ownership === "JOINT" ? "JOINT" : "PERSONAL";
  if (input.categoryId && !(await t.category.findUnique({ where: { id: input.categoryId } }))) throw new BizError("找不到活動／系列");
  const rateMicro = input.rate ? safeRate(input.rate) : await getDefaultRateMicro(t);
  let supplierId = input.supplierId ?? null;
  const supplierName = emptyToNull(input.supplier ?? null);
  if (!supplierId && supplierName) {
    const sp = await t.supplier.upsert({ where: { name: supplierName }, update: {}, create: { name: supplierName } });
    supplierId = sp.id;
  }
  const sp = supplierId ? await t.supplier.findUnique({ where: { id: supplierId } }) : null;
  if (supplierId && !sp) throw new BizError("找不到供應商");
  const orderedById = ownership === "JOINT" ? null : await checkOperator(t, input.orderedById, "這團是誰的");
  const paymentResponsibleById = await checkOperator(t, input.paymentResponsibleById, "主要付款負責人");
  const receivingResponsibleById = await checkOperator(t, input.receivingResponsibleById, "收貨負責人");
  const batch = await t.purchaseBatch.create({
    data: {
      code: await nextCode(t, "batch"),
      name: input.name.trim(),
      supplierId,
      supplier: sp?.name ?? null,
      rateMicro,
      orderedAt: input.orderedAt ?? new Date(),
      notes: emptyToNull(input.notes ?? null),
      status: "ORDERED",
      orderedById,
      paymentResponsibleById,
      receivingResponsibleById,
      responsibilityNote: emptyToNull(input.responsibilityNote ?? null),
      categoryId: input.categoryId || null,
      ownership,
      progress: input.progress ?? "ASKED",
      supplierOrderNo: emptyToNull(input.supplierOrderNo ?? null),
      orderUrl: (() => {
        const u = emptyToNull(input.orderUrl ?? null);
        if (u && !/^https?:\/\//i.test(u)) throw new BizError("訂購連結請以 http:// 或 https:// 開頭");
        return u;
      })(),
      expectedAt: input.expectedAt ?? null,
    },
  });
  for (const it of input.items ?? []) await addBatchItem(t, actor, batch.id, it);
  await audit(t, actor, "batch.create", "PurchaseBatch", batch.id, { rateMicro, items: input.items?.length ?? 0, supplierId, orderedById, paymentResponsibleById, receivingResponsibleById });
  return batch;
}

function safeRate(s: string) {
  try {
    return parseRate(s);
  } catch (e) {
    throw new BizError((e as Error).message);
  }
}

function checkMoney(n: unknown, label: string, allowNull = false): number | null {
  if (n === null || n === undefined) {
    if (allowNull) return null;
    throw new BizError(`請填寫${label}`);
  }
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new BizError(`${label}必須是不小於 0 的整數`);
  return n;
}

function checkCurrency(c: unknown): Currency {
  if (c === undefined || c === null) return "JPY";
  if (c !== "JPY" && c !== "TWD") throw new BizError("幣別只支援日幣（JPY）或台幣（TWD）");
  return c;
}

export async function addBatchItem(t: Tx, actor: Actor, batchId: string, it: BatchItemInput) {
  if (!Number.isInteger(it.qty) || it.qty <= 0) throw new BizError("採購數量必須是正整數");
  checkMoney(it.unitCost, "採購單價");
  const batch = await t.purchaseBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status === "CANCELLED") throw new BizError("已取消的採購團不能新增品項");
  if (it.dedupeKey) {
    const dup = await t.purchaseBatchItem.findUnique({ where: { dedupeKey: it.dedupeKey } });
    if (dup) return dup;
  }
  const row = await t.purchaseBatchItem.create({
    data: {
      batchId,
      productId: it.productId,
      qty: it.qty,
      currency: checkCurrency(it.currency),
      estUnitCost: it.unitCost,
      actualUnitCost: checkMoney(it.actualUnitCost, "實際單價", true),
      salePriceTwd: checkMoney(it.salePriceTwd, "對客售價", true),
      specNote: emptyToNull(it.specNote ?? null),
      weightGrams: it.weightGrams ?? null,
      dedupeKey: it.dedupeKey ?? null,
    },
  });
  // 將相關訂單明細標記為「已下單給供應商」
  const touched = new Set<string>();
  for (const oid of it.markOrderItemIds ?? []) {
    const oi = await t.orderItem.findUnique({ where: { id: oid } });
    if (!oi || oi.productId !== it.productId) continue;
    if (oi.purchaseFlag === "PENDING_PURCHASE" || oi.purchaseFlag === "DELAYED" || oi.purchaseFlag === "OUT_OF_STOCK") {
      await t.orderItem.update({ where: { id: oid }, data: { purchaseFlag: "ORDERED" } });
      await t.orderItemEvent.create({ data: { orderItemId: oid, type: "PURCHASE_FLAG", fromValue: oi.purchaseFlag, toValue: "ORDERED", note: `採購團 ${batch.code}`, actorId: actor.userId } });
      touched.add(oi.orderId);
    }
  }
  for (const id of touched) await recomputeOrder(t, id);
  await reallocateBatch(t, batchId);
  await refreshBatchStatusById(t, batchId);
  return row;
}

/**
 * 採購品項目前不能低於的數量（有效數量 = qty − cancelledQty）：
 *   已到貨數量 ＋ 依賴這批到貨的買家需求
 * 依賴量 = 已向供應商下單、尚未保留也未出貨的訂單需求 − 其他採購團的在途數量 − 目前可用庫存（不小於 0）
 */
export async function minCommittedQty(t: Tx, batchItemId: string) {
  const bi = await t.purchaseBatchItem.findUniqueOrThrow({
    where: { id: batchItemId },
    include: { movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
  });
  const received = bi.movements.reduce((s, m) => s + m.onHandDelta, 0);
  const demandItems = await t.orderItem.findMany({
    where: { productId: bi.productId, purchaseFlag: "ORDERED", order: { confirmation: "CONFIRMED" } },
    select: { qty: true, cancelledQtyCache: true, shippedQtyCache: true, reservedQtyCache: true },
  });
  const promised = demandItems.reduce((s, i) => s + Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache - i.reservedQtyCache), 0);
  const others = await t.purchaseBatchItem.findMany({
    where: { productId: bi.productId, id: { not: bi.id }, batch: { status: { notIn: ["CANCELLED", "DRAFT"] } } },
    include: { movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
  });
  const otherIncoming = others.reduce((s, o) => s + Math.max(0, o.qty - o.cancelledQty - o.movements.reduce((a, m) => a + m.onHandDelta, 0)), 0);
  const stock = await t.inventoryMovement.aggregate({ where: { productId: bi.productId }, _sum: { onHandDelta: true, reservedDelta: true } });
  const free = Math.max(0, (stock._sum.onHandDelta ?? 0) - (stock._sum.reservedDelta ?? 0));
  const dependent = Math.max(0, promised - otherIncoming - free);
  return { min: received + dependent, received, promised, dependent };
}

export async function updateBatchItem(
  t: Tx,
  actor: Actor,
  itemId: string,
  input: {
    qty?: number; // 新的有效數量
    unitCost?: number;
    actualUnitCost?: number | null;
    currency?: Currency;
    salePriceTwd?: number | null;
    specNote?: string | null;
    weightGrams?: number | null;
    cancelQty?: number;
  },
) {
  const bi0 = await t.purchaseBatchItem.findUniqueOrThrow({ where: { id: itemId }, select: { batchId: true, productId: true } });
  await lockRows(t, "PurchaseBatch", [bi0.batchId]);
  await lockRows(t, "Product", [bi0.productId]);
  const bi = await t.purchaseBatchItem.findUniqueOrThrow({ where: { id: itemId }, include: { batch: true, product: { select: { name: true } } } });
  if (bi.batch.status === "CANCELLED") throw new BizError("已取消的採購團不能修改");
  const data: Record<string, unknown> = {};
  const before = { qty: bi.qty - bi.cancelledQty, estUnitCost: bi.estUnitCost, actualUnitCost: bi.actualUnitCost, currency: bi.currency, salePriceTwd: bi.salePriceTwd };
  if (input.unitCost !== undefined) data.estUnitCost = checkMoney(input.unitCost, "採購預估單價");
  if (input.actualUnitCost !== undefined) data.actualUnitCost = checkMoney(input.actualUnitCost, "實際單價", true);
  if (input.currency !== undefined) data.currency = checkCurrency(input.currency);
  if (input.salePriceTwd !== undefined) data.salePriceTwd = checkMoney(input.salePriceTwd, "對客售價", true);
  if (input.specNote !== undefined) data.specNote = emptyToNull(input.specNote);
  if (input.weightGrams !== undefined) data.weightGrams = input.weightGrams;
  const { min, received, dependent } = await minCommittedQty(t, itemId);
  if (input.qty !== undefined && input.qty !== before.qty) {
    if (!Number.isInteger(input.qty) || input.qty < 0) throw new BizError("數量必須是不小於 0 的整數");
    if (input.qty < min) {
      throw new BizError(
        `「${bi.product.name}」數量不能少於 ${min}（已到貨 ${received} 件${dependent ? `、買家已訂購且只能靠這批到貨 ${dependent} 件` : ""}）`,
      );
    }
    data.qty = input.qty + bi.cancelledQty;
  }
  if (input.cancelQty) {
    const active = bi.qty - bi.cancelledQty;
    if (active - input.cancelQty < min) throw new BizError(`最多只能取消 ${Math.max(0, active - min)} 件`);
    data.cancelledQty = bi.cancelledQty + input.cancelQty;
  }
  await t.purchaseBatchItem.update({ where: { id: itemId }, data });
  await reallocateBatch(t, bi.batchId);
  await refreshBatchStatusById(t, bi.batchId);
  await audit(t, actor, "batch.updateItem", "PurchaseBatch", bi.batchId, { itemId, before, after: input });
}

/** 刪除採購品項：只有沒有到貨紀錄、也沒有買家依賴時才可以 */
export async function deleteBatchItem(t: Tx, actor: Actor, itemId: string) {
  const bi = await t.purchaseBatchItem.findUniqueOrThrow({ where: { id: itemId }, include: { product: { select: { name: true } }, movements: { take: 1 } } });
  await lockRows(t, "PurchaseBatch", [bi.batchId]);
  if (bi.movements.length > 0) throw new BizError(`「${bi.product.name}」已有到貨或庫存紀錄，不能刪除，請改為修改數量`);
  const { min } = await minCommittedQty(t, itemId);
  if (min > 0) throw new BizError(`「${bi.product.name}」有 ${min} 件買家訂購需要靠這批到貨，不能刪除`);
  await t.costAllocation.deleteMany({ where: { batchItemId: itemId } });
  await t.purchaseBatchItem.delete({ where: { id: itemId } });
  await reallocateBatch(t, bi.batchId);
  await refreshBatchStatusById(t, bi.batchId);
  await audit(t, actor, "batch.deleteItem", "PurchaseBatch", bi.batchId, { itemId, productId: bi.productId, qty: bi.qty, estUnitCost: bi.estUnitCost, currency: bi.currency });
}

/** 採購品項用於成本計算的單價：有實際單價用實際，否則用預估 */
export function effectiveUnitCost(i: { estUnitCost: number; actualUnitCost: number | null }) {
  return i.actualUnitCost ?? i.estUnitCost;
}

/** 採購品項商品金額（台幣） */
export function itemGoodsTwd(i: { estUnitCost: number; actualUnitCost: number | null; currency: string; qty: number; cancelledQty: number }, rateMicro: number) {
  const amount = effectiveUnitCost(i) * (i.qty - i.cancelledQty);
  return i.currency === "TWD" ? amount : jpyToTwd(amount, rateMicro);
}

export async function addBatchCost(
  t: Tx,
  actor: Actor,
  input: {
    batchId: string;
    kind: BatchCostKind;
    currency: "TWD" | "JPY";
    amount: number;
    method: AllocationMethod;
    manualSplit?: Record<string, number> | null;
    note?: string | null;
    payer?: string | null; // 經營者 id、"joint"（兩人一起付）或 null（跟著這團）
    shareSplit?: Record<string, number> | null; // payer = "joint" 時每人台幣金額
  },
) {
  if (!Number.isInteger(input.amount) || input.amount < 0) throw new BizError("費用金額必須是不小於 0 的整數");
  await lockRows(t, "PurchaseBatch", [input.batchId]);
  const batch = await t.purchaseBatch.findUnique({ where: { id: input.batchId }, select: { rateMicro: true } });
  if (!batch) throw new BizError("找不到採購團");
  let payer: string | null = input.payer ?? null;
  let shareSplit: Record<string, number> | null = null;
  if (payer === JOINT_PAYER) {
    const twd = feeTwd(input, batch.rateMicro);
    const split = Object.entries(input.shareSplit ?? {}).filter(([, v]) => Number(v) !== 0);
    if (split.length < 1) throw new BizError("兩人一起付時，請填每個人付多少");
    for (const [k, v] of split) {
      if (!Number.isInteger(v) || v < 0) throw new BizError("每人金額必須是不小於 0 的整數");
      await checkOperator(t, k, "付款人");
    }
    const sum = split.reduce((a, [, v]) => a + v, 0);
    if (sum !== twd) throw new BizError(`兩人金額合計 ${sum} 元，和費用 ${twd} 元不一樣`);
    shareSplit = Object.fromEntries(split);
  } else if (payer) payer = await checkOperator(t, payer, "付款人");
  const c = await t.batchCost.create({
    data: {
      batchId: input.batchId,
      kind: input.kind,
      currency: input.currency,
      amount: input.amount,
      method: input.method,
      manualSplit: input.manualSplit ?? undefined,
      payer,
      shareSplit: shareSplit ?? undefined,
      note: emptyToNull(input.note ?? null),
    },
  });
  await reallocateBatch(t, input.batchId);
  await audit(t, actor, "batch.addCost", "PurchaseBatch", input.batchId, { costId: c.id, kind: input.kind, amount: input.amount, currency: input.currency, method: input.method, payer, shareSplit });
  return c;
}

export async function deleteBatchCost(t: Tx, actor: Actor, costId: string) {
  const c = await t.batchCost.findUniqueOrThrow({ where: { id: costId } });
  await lockRows(t, "PurchaseBatch", [c.batchId]);
  await t.batchCost.delete({ where: { id: costId } });
  await reallocateBatch(t, c.batchId);
  await audit(t, actor, "batch.deleteCost", "PurchaseBatch", c.batchId, { costId, amount: c.amount, kind: c.kind });
}

/** 重新計算整個批次的共同費用分攤；每筆費用的分攤總和恰好等於費用台幣金額 */
export async function reallocateBatch(t: Tx, batchId: string) {
  const batch = await t.purchaseBatch.findUniqueOrThrow({ where: { id: batchId }, include: { items: true, costs: true } });
  const items = batch.items.filter((i) => i.qty - i.cancelledQty > 0);
  await t.costAllocation.deleteMany({ where: { batchCost: { batchId } } });
  for (const cost of batch.costs) {
    if (cost.method === "NONE") continue; // 不攤，單獨記
    const amountTwd = cost.currency === "JPY" ? jpyToTwd(cost.amount, batch.rateMicro) : cost.amount;
    if (items.length === 0 || amountTwd === 0) continue;
    let parts: number[];
    if (cost.method === "MANUAL") {
      const split = (cost.manualSplit ?? {}) as Record<string, number>;
      parts = items.map((i) => Math.round(Number(split[i.id] ?? 0)));
      const sum = parts.reduce((a, b) => a + b, 0);
      if (sum !== amountTwd) throw new BizError(`手動分配合計 ${sum} 元，與費用 ${amountTwd} 元不符`);
    } else {
      const weights = items.map((i) => {
        const q = i.qty - i.cancelledQty;
        if (cost.method === "BY_QTY") return q;
        if (cost.method === "BY_VALUE") return itemGoodsTwd(i, batch.rateMicro);
        if (i.weightGrams === null) throw new BizError("依重量分攤時，每一項採購明細都要填寫重量");
        return mulDiv(i.weightGrams, q, i.qty); // 取消部分數量時，重量按比例
      });
      parts = allocate(amountTwd, weights);
    }
    for (let k = 0; k < items.length; k++) {
      if (parts[k] === 0) continue;
      await t.costAllocation.create({ data: { batchCostId: cost.id, batchItemId: items[k].id, amountTwd: parts[k] } });
    }
  }
}

/** 採購明細的實際總成本（商品日幣成本換算台幣 + 分攤費用） */
export async function landedCosts(t: Tx, batchItemIds?: string[]) {
  const items = await t.purchaseBatchItem.findMany({
    where: batchItemIds ? { id: { in: batchItemIds } } : {},
    include: { batch: { select: { rateMicro: true } }, allocations: { select: { amountTwd: true } } },
  });
  const map = new Map<string, { qty: number; goodsTwd: number; feesTwd: number; totalTwd: number; estimated: boolean }>();
  for (const i of items) {
    const qty = i.qty - i.cancelledQty;
    const goodsTwd = itemGoodsTwd(i, i.batch.rateMicro);
    const feesTwd = i.allocations.reduce((s, a) => s + a.amountTwd, 0);
    map.set(i.id, { qty, goodsTwd, feesTwd, totalTwd: goodsTwd + feesTwd, estimated: i.actualUnitCost === null });
  }
  return map;
}

export async function cancelBatch(t: Tx, actor: Actor, batchId: string) {
  const b = await t.purchaseBatch.findUniqueOrThrow({ where: { id: batchId }, include: { items: { include: { movements: { take: 1 } } } } });
  if (b.items.some((i) => i.movements.length > 0)) throw new BizError("已有到貨或庫存紀錄的批次不能取消，請改為取消個別未到貨數量");
  await t.purchaseBatch.update({ where: { id: batchId }, data: { status: "CANCELLED" } });
  await audit(t, actor, "batch.cancel", "PurchaseBatch", batchId);
}

/** 待下單清單：有效訂單中尚未被庫存或在途採購涵蓋的需求 */
export async function purchaseDemand(t: Tx) {
  const items = await t.orderItem.findMany({
    where: { order: { confirmation: "CONFIRMED" }, purchaseFlag: { in: ["PENDING_PURCHASE", "OUT_OF_STOCK", "DELAYED"] } },
    select: {
      id: true,
      productId: true,
      qty: true,
      cancelledQtyCache: true,
      shippedQtyCache: true,
      reservedQtyCache: true,
      purchaseFlag: true,
      order: { select: { orderNo: true, buyer: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const byProduct = new Map<string, { qty: number; itemIds: string[]; lines: { orderNo: string; buyer: string; qty: number; flag: string }[] }>();
  for (const it of items) {
    const need = it.qty - it.cancelledQtyCache - it.shippedQtyCache - it.reservedQtyCache;
    if (need <= 0) continue;
    const v = byProduct.get(it.productId) ?? { qty: 0, itemIds: [], lines: [] };
    v.qty += need;
    v.itemIds.push(it.id);
    v.lines.push({ orderNo: it.order.orderNo, buyer: it.order.buyer.name, qty: need, flag: it.purchaseFlag });
    byProduct.set(it.productId, v);
  }
  return byProduct;
}
