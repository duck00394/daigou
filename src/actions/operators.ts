"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import * as op from "@/server/services/operators";
import * as sp from "@/server/services/supplier-payments";
import { createReceivingRecord } from "@/server/services/receiving";
import { parseDateTimeInput } from "@/lib/labels";

const opId = z.string().max(64).nullable();

export async function saveOperatorAction(id: string | null, input: { name: string; active?: boolean; code?: string }) {
  return run((a) => tx((t) => op.saveOperator(t, a, id, z.object({ name: z.string().max(60), active: z.boolean().optional(), code: z.string().max(8).optional() }).parse(input))).then((o) => ({ id: o.id })));
}

export async function updateResponsibilityAction(batchId: string, input: { ownership?: "PERSONAL" | "JOINT"; orderedById?: string | null; paymentResponsibleById?: string | null; receivingResponsibleById?: string | null; responsibilityNote?: string | null }) {
  const v = z.object({ ownership: z.enum(["PERSONAL", "JOINT"]).optional(), orderedById: opId.optional(), paymentResponsibleById: opId.optional(), receivingResponsibleById: opId.optional(), responsibilityNote: z.string().max(500).nullable().optional() }).parse(input);
  return run((a) => tx((t) => op.updateBatchResponsibility(t, a, batchId, v)).then(() => null));
}

const payment = z.object({
  paidById: opId,
  paidAt: z.string(),
  amount: z.number().int().positive(),
  currency: z.enum(["JPY", "TWD"]),
  rate: z.string().max(20).nullable().optional(),
  method: z.string().max(40).nullable().optional(),
  status: z.enum(["PENDING", "PAID"]).optional(),
  reference: z.string().max(100).nullable().optional(),
  purpose: z.enum(sp.PAYMENT_PURPOSES).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

function paidAtOf(s: string) {
  const d = parseDateTimeInput(s);
  if (!d) throw new Error("bad date");
  return d;
}

export async function addSupplierPaymentAction(batchId: string, input: z.infer<typeof payment>, dedupeKey: string) {
  return run(async (a) => {
    const v = payment.parse(input);
    const r = await tx((t) => sp.addSupplierPayment(t, a, { ...v, batchId, paidAt: paidAtOf(v.paidAt), dedupeKey: z.string().min(8).max(100).parse(dedupeKey) }));
    return { duplicated: r.duplicated };
  });
}

export async function updateSupplierPaymentAction(id: string, input: z.infer<typeof payment> & { reason?: string | null }) {
  return run(async (a) => {
    const v = payment.extend({ reason: z.string().max(200).nullable().optional() }).parse(input);
    await tx((t) => sp.updateSupplierPayment(t, a, id, { ...v, paidAt: paidAtOf(v.paidAt) }));
    return null;
  });
}

export async function voidSupplierPaymentAction(id: string, reason: string) {
  return run((a) => tx((t) => sp.voidSupplierPayment(t, a, id, z.string().max(200).parse(reason))).then(() => null));
}

const line = z.object({ batchItemId: z.string(), receivedQty: z.number().int().min(0), defectQty: z.number().int().min(0).optional(), missingQty: z.number().int().min(0).optional(), note: z.string().max(200).nullable().optional() });

export async function createReceivingAction(input: { batchId: string; receivedById: string; receivedAt: string | null; note: string | null; lines: z.infer<typeof line>[] }, dedupeKey: string) {
  return run(async (a) => {
    const lines = z.array(line).min(1).max(500).parse(input.lines);
    const r = await tx(
      (t) =>
        createReceivingRecord(t, a, {
          batchId: z.string().parse(input.batchId),
          receivedById: z.string().parse(input.receivedById),
          receivedAt: parseDateTimeInput(input.receivedAt),
          note: input.note,
          lines,
          dedupeKey: z.string().min(8).max(100).parse(dedupeKey),
        }),
      { timeout: 120_000 },
    );
    return { id: r.record.id, duplicated: r.duplicated, goodQty: r.record.lines.reduce((s, l) => s + l.receivedQty - l.defectQty, 0) };
  });
}

export async function updateBatchProgressAction(batchId: string, progress: "ASKED" | "AGENT_HAS" | "SHIPPED") {
  return run((a) => tx((t) => op.updateBatchProgress(t, a, batchId, z.enum(["ASKED", "AGENT_HAS", "SHIPPED"]).parse(progress))).then(() => null));
}

/** 設定「這支手機是誰在用」（只是預設值，存在這台裝置的 Cookie） */
export async function setMeAction(operatorId: string | null) {
  return run(async () => {
    const { cookies } = await import("next/headers");
    const { ME_COOKIE } = await import("@/server/me");
    const jar = await cookies();
    if (!operatorId) {
      jar.delete(ME_COOKIE);
      return null;
    }
    const found = await tx((t) => t.operator.findUnique({ where: { id: z.string().max(64).parse(operatorId) } }));
    if (!found || !found.active) throw new Error("bad operator");
    jar.set(ME_COOKIE, found.id, { httpOnly: true, sameSite: "lax", secure: process.env.INSECURE_COOKIE !== "1" && process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return null;
  }, "read");
}
