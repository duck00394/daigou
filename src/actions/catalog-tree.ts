"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import * as ct from "@/server/services/catalog-tree";
import { sellToCustomer } from "@/server/services/sell";

const price = z.number().int().min(0).max(10_000_000).nullable();

export async function addCatalogItemAction(input: { categoryId: string; typeId?: string | null; typeName?: string | null; price?: number | null }) {
  return run((a) => tx((t) => ct.addCatalogItem(t, a, z.object({ categoryId: z.string(), typeId: z.string().nullish(), typeName: z.string().max(30).nullish(), price: price.optional() }).parse(input))));
}
export async function setCatalogPriceAction(input: { categoryId: string; typeId: string; price: number | null }) {
  return run((a) => tx((t) => ct.setCatalogPrice(t, a, z.object({ categoryId: z.string(), typeId: z.string(), price }).parse(input))));
}
export async function addCatalogCharacterAction(input: { categoryId: string; typeId: string; characterName: string }) {
  return run((a) => tx((t) => ct.addCatalogCharacter(t, a, z.object({ categoryId: z.string(), typeId: z.string(), characterName: z.string().max(50) }).parse(input))));
}
export async function sellSheetAction(categoryId: string) {
  return run(() => tx((t) => ct.sellSheet(t, z.string().parse(categoryId))));
}
const sellSchema = z.object({
  buyerName: z.string().max(100).nullish(),
  categoryId: z.string().nullish(),
  idemKey: z.string().min(8).max(100),
  paid: z.boolean().optional(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int(), unitPrice: z.number().int() })).max(300),
});
export async function sellToCustomerAction(input: z.infer<typeof sellSchema>) {
  return run((a) => tx((t) => sellToCustomer(t, a, sellSchema.parse(input)), { timeout: 30000 }));
}
