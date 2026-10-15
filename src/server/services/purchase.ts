// 採購批次：實際向供應商採購的數量、日幣成本、匯率快照與共同費用分攤。
import { BizError, lockRows, type Tx } from "@/server/db";
import { allocate, jpyToTwd, mulDiv, parseRate } from "@/lib/money";
import { audit, emptyToNull, nextCode, type Actor } from "./common";
import { getDefaultRateMicro } from "./settings";
import { recomputeOrder } from "./recompute";
import type { AllocationMethod, BatchCostKind } from "@prisma/client";

export async function createBatch(
  t: Tx,
  actor: Actor,
  input: {
    name: string;
    supplier?: string | null;
    rate?: string | null; // 未填時使用目前預設匯率，建立後即鎖定
    orderedAt?: Date | null;
    notes?: string | null;
    items: { productId: string; qty: number; unitCostJpy: number; weightGrams?: number | null; markOrderItemIds?: string[] }[];
  },
) {
  if (!input.name?.trim()) throw new BizError("請填寫批次名稱");
  const rateMicro = input.rate ? safeRate(input.rate) : await getDefaultRateMicro(t);
  const batch = await t.purchaseBatch.create({
    data: {
      code: await nextCode(t, "batch"),
      name: input.name.trim(),
      supplier: emptyToNull(input.supplier ?? null),
      rateMicro,
      orderedAt: input.orderedAt ?? new Date(),
      notes: emptyToNull(input.notes ?? null),
      status: "ORDERED",
    },
  });
  for (const it of input.items) await addBatchItem(t, actor, batch.id, it);
  await audit(t, actor, "batch.create", "PurchaseBatch", batch.id, { rateMicro, items: input.items.length });
  return batch;
}

function safeRate(s: string) {
  try {
    return parseRate(s);
  } catch (e) {
    throw new BizError((e as Error).message);
  }
}

export async function addBatchItem(
  t: Tx,
  actor: Actor,
  batchId: string,
  it: { productId: string; qty: number; unitCostJpy: number; weightGrams?: number | null; markOrderItemIds?: string[] },
) {
  if (!Number.isInteger(it.qty) || it.qty <= 0) throw new BizError("採購數量必須是正整數");
  if (!Number.isInteger(it.unitCostJpy) || it.unitCostJpy < 0) throw new BizError("日幣成本必須是不小於 0 的整數");
  const row = await t.purchaseBatchItem.create({
    data: { batchId, productId: it.productId, qty: it.qty, unitCostJpy: it.unitCostJpy, weightGrams: it.weightGrams ?? null },
  });
  // 將相關訂單明細標記為「已下單給供應商」
  const touched = new Set<string>();
  for (const oid of it.markOrderItemIds ?? []) {
    const oi = await t.orderItem.findUnique({ where: { id: oid } });
    if (!oi || oi.productId !== it.productId) continue;
    if (oi.purchaseFlag === "PENDING_PURCHASE" || oi.purchaseFlag === "DELAYED" || oi.purchaseFlag === "OUT_OF_STOCK") {
      await t.orderItem.update({ where: { id: oid }, data: { purchaseFlag: "ORDERED" } });
      await t.orderItemEvent.create({ data: { orderItemId: oid, type: "PURCHASE_FLAG", fromValue: oi.purchaseFlag, toValue: "ORDERED", note: `採購批次`, actorId: actor.userId } });
      touched.add(oi.orderId);
    }
  }
  for (const id of touched) await recomputeOrder(t, id);
  await reallocateBatch(t, batchId);
  return row;
}

export async function updateBatchItem(t: Tx, actor: Actor, itemId: string, input: { unitCostJpy?: number; weightGrams?: number | null; cancelQty?: number }) {
  const bi = await t.purchaseBatchItem.findUniqueOrThrow({ where: { id: itemId }, include: { movements: { where: { kind: "RECEIVE" } } } });
  await lockRows(t, "PurchaseBatch", [bi.batchId]);
  const data: Record<string, unknown> = {};
  if (input.unitCostJpy !== undefined) {
    if (!Number.isInteger(input.unitCostJpy) || input.unitCostJpy < 0) throw new BizError("日幣成本必須是不小於 0 的整數");
    data.unitCostJpy = input.unitCostJpy;
  }
  if (input.weightGrams !== undefined) data.weightGrams = input.weightGrams;
  if (input.cancelQty) {
    const received = bi.movements.reduce((s, m) => s + m.onHandDelta, 0);
    const maxCancel = bi.qty - bi.cancelledQty - received;
    if (input.cancelQty > maxCancel) throw new BizError(`最多只能取消 ${maxCancel} 件尚未到貨的數量`);
    data.cancelledQty = bi.cancelledQty + input.cancelQty;
  }
  await t.purchaseBatchItem.update({ where: { id: itemId }, data });
  await reallocateBatch(t, bi.batchId);
  await audit(t, actor, "batch.updateItem", "PurchaseBatch", bi.batchId, { itemId, ...input });
}

export async function addBatchCost(
  t: Tx,
  actor: Actor,
  input: { batchId: string; kind: BatchCostKind; currency: "TWD" | "JPY"; amount: number; method: AllocationMethod; manualSplit?: Record<string, number> | null; note?: string | null },
) {
  if (!Number.isInteger(input.amount) || input.amount < 0) throw new BizError("費用金額必須是不小於 0 的整數");
  await lockRows(t, "PurchaseBatch", [input.batchId]);
  const c = await t.batchCost.create({
    data: {
      batchId: input.batchId,
      kind: input.kind,
      currency: input.currency,
      amount: input.amount,
      method: input.method,
      manualSplit: input.manualSplit ?? undefined,
      note: emptyToNull(input.note ?? null),
    },
  });
  await reallocateBatch(t, input.batchId);
  await audit(t, actor, "batch.addCost", "PurchaseBatch", input.batchId, { costId: c.id, kind: input.kind, amount: input.amount, currency: input.currency, method: input.method });
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
        if (cost.method === "BY_VALUE") return q * i.unitCostJpy;
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
  const map = new Map<string, { qty: number; goodsTwd: number; feesTwd: number; totalTwd: number }>();
  for (const i of items) {
    const qty = i.qty - i.cancelledQty;
    const goodsTwd = jpyToTwd(i.unitCostJpy * qty, i.batch.rateMicro);
    const feesTwd = i.allocations.reduce((s, a) => s + a.amountTwd, 0);
    map.set(i.id, { qty, goodsTwd, feesTwd, totalTwd: goodsTwd + feesTwd });
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
