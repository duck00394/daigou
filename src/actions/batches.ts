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
