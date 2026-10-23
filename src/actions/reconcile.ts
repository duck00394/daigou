"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import { saveReconcile } from "@/server/services/reconcile";
import { getMe } from "@/server/me";

export async function saveReconcileAction(batchId: string, input: { rows: { itemId: string; bought: number; cutRest: boolean }[]; reason?: string | null; note?: string | null; paidTotal?: number | null; payKey?: string | null }) {
  const v = z.object({
    rows: z.array(z.object({ itemId: z.string().max(64), bought: z.number().int().min(0).max(100000), cutRest: z.boolean() })).max(500),
    reason: z.string().max(30).nullable().optional(),
    note: z.string().max(200).nullable().optional(),
    paidTotal: z.number().int().min(0).max(100_000_000).nullable().optional(),
    payKey: z.string().min(8).max(100).nullable().optional(),
  }).parse(input);
  const me = await getMe(); // 付款人：這台裝置的人
  return run((a) => tx((t) => saveReconcile(t, a, z.string().max(64).parse(batchId), { ...v, paidById: me })));
}

export async function resetReconcileAction(batchIds: string[]) {
  const ids = z.array(z.string().max(64)).max(500).parse(batchIds);
  const { resetReconcile } = await import("@/server/services/reconcile");
  return run((a) => tx((t) => resetReconcile(t, a, ids)));
}

export async function recordRefundAction(batchId: string, amount: number) {
  const { recordRefund } = await import("@/server/services/batch-ops");
  return run((a) => tx((t) => recordRefund(t, a, z.string().max(64).parse(batchId), z.number().int().parse(amount))));
}
