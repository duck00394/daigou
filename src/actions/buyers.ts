"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import * as b from "@/server/services/buyers";

const buyerSchema = z.object({
  name: z.string().max(100),
  lineName: z.string().max(100).nullish(),
  contact: z.string().max(200).nullish(),
  recipientName: z.string().max(100).nullish(),
  recipientPhone: z.string().max(50).nullish(),
  address: z.string().max(300).nullish(),
  shippingMethod: z.string().max(100).nullish(),
  notes: z.string().max(5000).nullish(),
});
export type BuyerForm = z.infer<typeof buyerSchema>;

export async function saveBuyerAction(id: string | null, form: BuyerForm) {
  return run(async (a) => {
    const f = buyerSchema.parse(form);
    if (id) {
      await tx((t) => b.updateBuyer(t, a, id, f));
      return { id };
    }
    const row = await tx((t) => b.createBuyer(t, a, f));
    return { id: row.id, name: row.name, code: row.code };
  });
}
export async function addBuyerAliasAction(buyerId: string, alias: string) {
  return run((a) => tx((t) => b.addBuyerAlias(t, a, buyerId, z.string().max(100).parse(alias))));
}
export async function removeBuyerAliasAction(id: string) {
  return run((a) => tx((t) => b.removeBuyerAlias(t, a, id)));
}
export async function addBuyerTagAction(buyerId: string, tagId: string, reason: string | null) {
  return run((a) => tx((t) => b.addBuyerTag(t, a, { buyerId, tagId, reason })));
}
export async function removeBuyerTagAction(buyerTagId: string) {
  return run((a) => tx((t) => b.removeBuyerTag(t, a, buyerTagId)));
}
export async function addIncidentAction(input: { buyerId: string; kind: "LATE_PAYMENT" | "CANCELLATION" | "REFUND_DISPUTE" | "CHANGE_REQUEST" | "OTHER"; description: string | null; orderId?: string | null }) {
  return run((a) => tx((t) => b.addIncident(t, a, input)));
}
export async function mergePreviewAction(sourceId: string, targetId: string) {
  return run(() => tx((t) => b.mergePreview(t, sourceId, targetId)).then((p) => ({ counts: p.counts, source: { name: p.source.name, code: p.source.code }, target: { name: p.target.name, code: p.target.code } })), "read");
}
export async function mergeBuyersAction(sourceId: string, targetId: string) {
  return run((a) => tx((t) => b.mergeBuyers(t, a, sourceId, targetId), { timeout: 120_000 }), "admin");
}

const tagSchema = z.object({
  name: z.string().max(50),
  color: z.string().max(10),
  description: z.string().max(500).nullish(),
  kind: z.enum(["RISK", "POSITIVE", "OPERATION", "CUSTOM"]),
  warnOnOrder: z.boolean(),
  active: z.boolean(),
});
export async function saveTagAction(id: string | null, form: z.infer<typeof tagSchema>) {
  return run((a) => tx((t) => b.saveTag(t, a, id, tagSchema.parse(form))));
}
export async function deleteTagAction(id: string, force: boolean) {
  return run((a) => tx((t) => b.deleteTag(t, a, id, force)), "admin");
}
