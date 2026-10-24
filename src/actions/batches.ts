"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import * as bo from "@/server/services/batch-ops";
import { keepStock } from "@/server/services/inventory";
import { parseDay } from "@/lib/labels";
import { claimRequest } from "@/server/services/common";

const str = (n: number) => z.string().max(n).nullable().optional();

export async function updateBatchInfoAction(batchId: string, input: { name?: string; supplierId?: string | null; categoryId?: string | null; supplierOrderNo?: string | null; orderUrl?: string | null; expectedAt?: string | null; notes?: string | null }) {
  const v = z.object({ name: z.string().max(100).optional(), supplierId: str(64), categoryId: str(64), supplierOrderNo: str(100), orderUrl: str(500), expectedAt: str(10), notes: str(2000) }).parse(input);
  return run((a) => tx((t) => bo.updateBatchInfo(t, a, batchId, { ...v, expectedAt: v.expectedAt === undefined ? undefined : parseDay(v.expectedAt) })).then(() => null));
}

export async function cancelBatchItemAction(itemId: string, input: { qty: number; reason: string; note?: string | null; markShortage?: boolean; requestKey?: string }) {
  const v = z.object({ qty: z.number().int(), reason: z.string().max(30), note: str(200), markShortage: z.boolean().optional(), requestKey: z.string().max(120).optional() }).parse(input);
  return run((a) =>
    tx(async (t) => {
      await claimRequest(t, v.requestKey, "batch.cancelItem");
      return bo.cancelBatchItem(t, a, itemId, v);
    }),
  );
}

export async function copyBatchItemsAction(input: { fromBatchId: string; toBatchId: string; submissionKey: string; rows: bo.CopyRow[] }) {
  const v = z
    .object({
      fromBatchId: z.string(),
      toBatchId: z.string(),
      submissionKey: z.string().min(8).max(100),
      rows: z.array(z.object({ sourceItemId: z.string(), qty: z.number().int().min(0), unitCost: z.number().int().min(0), currency: z.enum(["JPY", "TWD"]) })).max(500),
    })
    .parse(input);
  return run((a) => tx((t) => bo.copyBatchItems(t, a, v), { timeout: 120_000 }));
}

export async function keepAction(input: { productId: string; delta: number; note?: string | null; dedupeKey: string; owner?: string | null }) {
  const v = z.object({ productId: z.string(), delta: z.number().int(), note: str(100), dedupeKey: z.string().min(8).max(100), owner: str(64) }).parse(input);
  return run((a) => tx((t) => keepStock(t, a, v)));
}

/** 讀取來源採購團的品項（複製用） */
export async function batchItemsForCopyAction(batchId: string) {
  return run(
    () =>
      tx((t) =>
        t.purchaseBatchItem.findMany({
          where: { batchId, qty: { gt: 0 } },
          orderBy: { createdAt: "asc" },
          select: { id: true, qty: true, cancelledQty: true, currency: true, estUnitCost: true, actualUnitCost: true, specNote: true, product: { select: { name: true } } },
        }),
      ).then((rows) =>
        rows.map((r) => ({ id: r.id, name: r.product.name, specNote: r.specNote, qty: r.qty - r.cancelledQty, currency: r.currency as "JPY" | "TWD", refPrice: r.actualUnitCost ?? r.estUnitCost, refActual: r.actualUnitCost !== null })),
      ),
    "read",
  );
}

export async function payRemainingAction(batchId: string, paidById: string | null, dedupeKey: string) {
  const v = z.object({ batchId: z.string().max(64), paidById: z.string().max(64).nullable(), dedupeKey: z.string().min(8).max(100) }).parse({ batchId, paidById, dedupeKey });
  return run((a) => tx((t) => bo.payRemaining(t, a, v.batchId, { paidById: v.paidById, dedupeKey: `payoff:${v.dedupeKey}` })).then((r) => ({ duplicated: r.duplicated })));
}

/** 全部到了：還沒收到的一次入庫（重送不重複） */
export async function receiveAllAction(batchId: string, receivedById: string | null, dedupeKey: string) {
  const v = z.object({ batchId: z.string().max(64), receivedById: z.string().max(64).nullable(), dedupeKey: z.string().min(8).max(100) }).parse({ batchId, receivedById, dedupeKey });
  const { receiveAll } = await import("@/server/services/receiving");
  return run((a) => tx((t) => receiveAll(t, a, v.batchId, { receivedById: v.receivedById, dedupeKey: `all:${v.dedupeKey}` })));
}

export async function undoReceivingAction(batchId: string, recordId: string | null) {
  const { undoReceiving } = await import("@/server/services/receiving");
  return run((a) => tx((t) => undoReceiving(t, a, { batchId: z.string().max(64).parse(batchId), recordId: z.string().max(64).nullable().parse(recordId) })));
}

export async function deleteBatchAction(batchId: string) {
  const { deleteBatch } = await import("@/server/services/purchase");
  return run((a) => tx((t) => deleteBatch(t, a, z.string().max(64).parse(batchId))).then(() => null));
}

const splitSchema = z.record(z.string().max(64), z.number().min(0).max(100000)).nullable();
export async function saveJointSetupAction(batchId: string, input: { split?: Record<string, number> | null; feeSplit?: "HALF" | "GOODS" }) {
  const v = z.object({ split: splitSchema.optional(), feeSplit: z.enum(["HALF", "GOODS"]).optional() }).parse(input);
  const { saveJointSetup } = await import("@/server/services/joint");
  return run((a) => tx((t) => saveJointSetup(t, a, z.string().max(64).parse(batchId), v)).then(() => null));
}
export async function setPaidByAction(batchId: string, entries: { paidById: string; total: number }[], payKey: string) {
  const v = z.array(z.object({ paidById: z.string().max(64), total: z.number().int().min(0).max(100_000_000) })).max(10).parse(entries);
  const { setPaidBy } = await import("@/server/services/joint");
  return run((a) => tx((t) => setPaidBy(t, a, z.string().max(64).parse(batchId), v, z.string().min(8).max(100).parse(payKey))));
}
export async function recordJointTransferAction(batchId: string, input: { from: string; to: string; amount: number }) {
  const v = z.object({ from: z.string().max(64), to: z.string().max(64), amount: z.number().int() }).parse(input);
  const { recordJointTransfer } = await import("@/server/services/joint");
  return run((a) => tx((t) => recordJointTransfer(t, a, z.string().max(64).parse(batchId), v)).then(() => null));
}
export async function jointSettlementAction(batchId: string) {
  const { jointSettlement } = await import("@/server/services/joint");
  return run(async () => {
    const s = await tx((t) => jointSettlement(t, z.string().max(64).parse(batchId)));
    const name = (id: string) => s.people.find((p) => p.id === id)?.name ?? "";
    const text = s.debts.length ? s.debts.map((d) => `${name(d.from)}要給${name(d.to)} NT$${d.amount.toLocaleString()}`).join("、") : s.paidTotal > 0 ? "兩人之間不用互相給錢" : "";
    return { ...s, text };
  });
}
