"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import { saveReconcile } from "@/server/services/reconcile";

export async function saveReconcileAction(batchId: string, input: { rows: { itemId: string; bought: number; cutRest: boolean }[]; reason?: string | null; note?: string | null }) {
  const v = z.object({
    rows: z.array(z.object({ itemId: z.string().max(64), bought: z.number().int().min(0).max(100000), cutRest: z.boolean() })).max(500),
    reason: z.string().max(30).nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  }).parse(input);
  return run((a) => tx((t) => saveReconcile(t, a, z.string().max(64).parse(batchId), v)));
}
