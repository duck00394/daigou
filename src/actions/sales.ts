"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import * as qs from "@/server/services/quick-sale";
import { parseDateInput } from "@/lib/labels";

const sale = z.object({
  productId: z.string().max(64),
  qty: z.number().int(),
  unitPrice: z.number().int(),
  buyerName: z.string().max(60).nullable().optional(),
  soldAt: z.string().max(10).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
  paid: z.boolean().optional(),
  method: z.string().max(40).nullable().optional(),
  owner: z.string().max(64).nullable().optional(),
  idemKey: z.string().min(8).max(100),
});
type SaleIn = z.infer<typeof sale>;
const toInput = (v: SaleIn): qs.QuickSaleInput => ({ ...v, soldAt: parseDateInput(v.soldAt) });

export async function quickSaleAction(input: SaleIn) {
  return run((a) => tx((t) => qs.quickSale(t, a, toInput(sale.parse(input))), { timeout: 60_000 }));
}

export async function correctQuickSaleAction(orderId: string, input: SaleIn & { reason?: string | null }) {
  const v = sale.extend({ reason: z.string().max(200).nullable().optional() }).parse(input);
  return run((a) => tx((t) => qs.correctQuickSale(t, a, orderId, { ...toInput(v), reason: v.reason }), { timeout: 60_000 }));
}

export async function voidQuickSaleAction(orderId: string, reason: string) {
  return run((a) => tx((t) => qs.voidQuickSale(t, a, orderId, z.string().max(200).parse(reason))).then(() => null));
}
