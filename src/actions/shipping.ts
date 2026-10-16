"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import { saveShippingMethod } from "@/server/services/shipping-methods";

export async function saveShippingMethodAction(id: string | null, input: { name: string; amount: number; currency?: string; kind?: string; active?: boolean }) {
  const v = z.object({ name: z.string().max(30), amount: z.number().int(), currency: z.enum(["TWD", "JPY"]).optional(), kind: z.string().max(40).optional(), active: z.boolean().optional() }).parse(input);
  return run((a) => tx((t) => saveShippingMethod(t, a, id ? z.string().max(64).parse(id) : null, v)).then((r) => ({ id: r.id })));
}
