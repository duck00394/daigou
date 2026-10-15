// 收貨與清點紀錄：每一次到貨都是一筆紀錄，記錄收貨確認人（必填）與各品項實收、瑕疵、缺少數量。
// 庫存只增加「實收 − 瑕疵」的良品數量，並透過 InventoryMovement.receivingLineId 連回這次收貨。
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, emptyToNull, type Actor } from "./common";
import { checkOperator } from "./operators";
import { receiveStock } from "./inventory";

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
