// 收貨與清點紀錄：每一次到貨都是一筆紀錄，記錄收貨確認人（必填）與各品項實收、瑕疵、缺少數量。
// 庫存只增加「實收 − 瑕疵」的良品數量，並透過 InventoryMovement.receivingLineId 連回這次收貨。
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, emptyToNull, type Actor } from "./common";
import { checkOperator } from "./operators";
import { receiveStock, refreshBatchStatusById } from "./inventory";

export interface ReceivingLineInput {
  batchItemId: string;
  receivedQty: number; // 這次實際收到的件數（含瑕疵）
  defectQty?: number; // 其中瑕疵件數（不入庫）
  missingQty?: number; // 這次應到而未到的件數（僅記錄，不影響庫存）
  note?: string | null;
}

const isCount = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;

export async function createReceivingRecord(
  t: Tx,
  actor: Actor,
  input: { batchId: string; receivedById: string; receivedAt?: Date | null; note?: string | null; dedupeKey?: string | null; lines: ReceivingLineInput[] },
) {
  if (input.dedupeKey) {
    const dup = await t.receivingRecord.findUnique({ where: { dedupeKey: input.dedupeKey }, include: { lines: true } });
    if (dup) return { record: dup, duplicated: true };
  }
  if (!input.receivedById) throw new BizError("請選擇收貨確認人");
  await lockRows(t, "PurchaseBatch", [input.batchId]);
  if (input.dedupeKey) {
    const dup = await t.receivingRecord.findUnique({ where: { dedupeKey: input.dedupeKey }, include: { lines: true } });
    if (dup) return { record: dup, duplicated: true };
  }
  const batch = await t.purchaseBatch.findUnique({ where: { id: input.batchId }, include: { items: { include: { product: { select: { name: true } } } } } });
  if (!batch) throw new BizError("找不到採購團");
  if (batch.status === "CANCELLED") throw new BizError("已取消的採購團不能登記收貨");
  const receivedById = await checkOperator(t, input.receivedById, "收貨確認人");
  if (!receivedById) throw new BizError("請選擇收貨確認人");

  const lines: (Required<Omit<ReceivingLineInput, "note">> & { note: string | null; productId: string; name: string })[] = [];
  const seen = new Set<string>();
  for (const l of input.lines ?? []) {
    const defect = l.defectQty ?? 0;
    const missing = l.missingQty ?? 0;
    if (!isCount(l.receivedQty) || !isCount(defect) || !isCount(missing)) throw new BizError("收貨、瑕疵、缺少數量都必須是不小於 0 的整數");
    if (l.receivedQty === 0 && defect === 0 && missing === 0 && !l.note?.trim()) continue;
    const bi = batch.items.find((i) => i.id === l.batchItemId);
    if (!bi) throw new BizError("收貨品項不屬於這個採購團");
    if (seen.has(bi.id)) throw new BizError(`「${bi.product.name}」重複出現，請合併成一列`);
    seen.add(bi.id);
    if (defect > l.receivedQty) throw new BizError(`「${bi.product.name}」瑕疵數量不能多於實收數量`);
    lines.push({ batchItemId: bi.id, receivedQty: l.receivedQty, defectQty: defect, missingQty: missing, note: emptyToNull(l.note), productId: bi.productId, name: bi.product.name });
  }
  if (!lines.length) throw new BizError("請至少填寫一個品項的收貨數量");

  const record = await t.receivingRecord.create({
    data: { batchId: batch.id, receivedById, receivedAt: input.receivedAt ?? new Date(), note: emptyToNull(input.note), dedupeKey: input.dedupeKey ?? null },
  });
  for (const l of lines) {
    const line = await t.receivingLine.create({
      data: { recordId: record.id, batchItemId: l.batchItemId, receivedQty: l.receivedQty, defectQty: l.defectQty, missingQty: l.missingQty, note: l.note },
    });
    const good = l.receivedQty - l.defectQty;
    if (good > 0) {
      try {
        await receiveStock(t, actor, { productId: l.productId, qty: good, batchItemId: l.batchItemId, reason: "採購到貨", dedupeKey: `rcv:${line.id}`, receivingLineId: line.id });
      } catch (e) {
        if (e instanceof BizError) throw new BizError(`「${l.name}」：${e.message}`);
        throw e;
      }
    }
  }
  await audit(t, actor, "receiving.create", "ReceivingRecord", record.id, {
    batchId: batch.id,
    receivedById,
    lines: lines.map((l) => ({ batchItemId: l.batchItemId, receivedQty: l.receivedQty, defectQty: l.defectQty, missingQty: l.missingQty })),
  });
  return { record: await t.receivingRecord.findUniqueOrThrow({ where: { id: record.id }, include: { lines: true } }), duplicated: false };
}

/**
 * 全部到了：把這團每個品項「還沒收到的數量」一次收貨入庫（現貨、或代購一次寄齊時用）。
 * 沒有還沒到的就什麼都不做；收貨確認人預設這團的收貨負責人、主人，再來是傳入的人。
 */
export async function receiveAll(t: Tx, actor: Actor, batchId: string, input: { receivedById: string | null; dedupeKey?: string | null }) {
  await lockRows(t, "PurchaseBatch", [batchId]);
  const b = await t.purchaseBatch.findUnique({
    where: { id: batchId },
    include: { items: { select: { id: true, qty: true, cancelledQty: true, receivingLines: { select: { receivedQty: true } } } } },
  });
  if (!b) throw new BizError("找不到採購團");
  const lines = b.items
    .map((i) => ({ batchItemId: i.id, receivedQty: i.qty - i.cancelledQty - i.receivingLines.reduce((s, l) => s + l.receivedQty, 0) }))
    .filter((l) => l.receivedQty > 0);
  if (!lines.length) return { received: 0, duplicated: false };
  const who = input.receivedById || b.receivingResponsibleById || b.orderedById;
  if (!who) throw new BizError("請先選這團是誰的，或選收貨的人");
  const r = await createReceivingRecord(t, actor, { batchId, receivedById: who, dedupeKey: input.dedupeKey ?? null, note: "全部到了", lines });
  return { received: r.duplicated ? 0 : lines.reduce((s, l) => s + l.receivedQty, 0), duplicated: r.duplicated };
}

/**
 * 撤回收貨（按錯了）：把入庫拿掉，這團變回還沒到。
 * 只撤回還在手上的：已經賣掉、自留、留給買家的不能撤，要先作廢或取消。
 * recordId：撤回某一次收貨；不給就撤回這團全部的收貨。
 */
export async function undoReceiving(t: Tx, actor: Actor, input: { batchId: string; recordId?: string | null }) {
  await lockRows(t, "PurchaseBatch", [input.batchId]);
  const b = await t.purchaseBatch.findUnique({ where: { id: input.batchId }, select: { id: true, status: true, items: { select: { id: true, productId: true, product: { select: { name: true } } } } } });
  if (!b) throw new BizError("找不到採購團");
  const itemIds = b.items.map((i) => i.id);
  await lockRows(t, "Product", [...new Set(b.items.map((i) => i.productId))]);
  const recv = await t.inventoryMovement.findMany({
    where: { kind: "RECEIVE", purchaseBatchItemId: { in: itemIds }, ...(input.recordId ? { receivingLine: { recordId: input.recordId } } : {}) },
    select: { id: true, onHandDelta: true, purchaseBatchItemId: true },
  });
  if (!recv.length) throw new BizError("沒有可以撤回的收貨");
  // 每個品項：這批手上還有多少（扣掉已賣、自留、保留）
  const lots = await t.inventoryMovement.groupBy({ by: ["purchaseBatchItemId"], where: { purchaseBatchItemId: { in: itemIds } }, _sum: { onHandDelta: true, reservedDelta: true } });
  const free = new Map(lots.map((l) => [l.purchaseBatchItemId, (l._sum.onHandDelta ?? 0) - (l._sum.reservedDelta ?? 0)]));
  const want = new Map<string, number>();
  for (const m of recv) want.set(m.purchaseBatchItemId!, (want.get(m.purchaseBatchItemId!) ?? 0) + m.onHandDelta);
  for (const [id, q] of want) {
    const f = free.get(id) ?? 0;
    if (q > f) {
      const name = b.items.find((i) => i.id === id)?.product.name ?? "";
      throw new BizError(`「${name}」這批只剩 ${Math.max(0, f)} 件在手上（其他已賣出、自留或留給買家），要先作廢出售或取消自留，才能撤回`);
    }
  }
  await t.inventoryMovement.deleteMany({ where: { id: { in: recv.map((m) => m.id) } } });
  // 收貨清點紀錄：撤回的那幾筆一起拿掉
  const recWhere = input.recordId ? { id: input.recordId, batchId: b.id } : { batchId: b.id };
  const recs = await t.receivingRecord.findMany({ where: recWhere, select: { id: true } });
  await t.inventoryMovement.updateMany({ where: { receivingLine: { recordId: { in: recs.map((r) => r.id) } } }, data: { receivingLineId: null } });
  await t.receivingLine.deleteMany({ where: { recordId: { in: recs.map((r) => r.id) } } });
  await t.receivingRecord.deleteMany({ where: { id: { in: recs.map((r) => r.id) } } });
  await refreshBatchStatusById(t, b.id);
  const qty = [...want.values()].reduce((a, x) => a + x, 0);
  await audit(t, actor, "batch.undoReceiving", "PurchaseBatch", b.id, { recordId: input.recordId ?? null, qty });
  return { qty };
}
