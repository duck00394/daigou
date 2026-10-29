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
  channel: z.string().max(40).nullish(),
  categoryId: z.string().nullish(),
  idemKey: z.string().min(8).max(100),
  paid: z.boolean().optional(),
  owner: z.string().max(64).nullish(),
  groupBuyId: z.string().max(64).nullish(),
  shippingFee: z.number().int().min(0).max(99999).nullish(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int(), unitPrice: z.number().int(), categoryId: z.string().nullish() })).max(300),
});
export async function sellToCustomerAction(input: z.infer<typeof sellSchema>) {
  return run((a) => tx((t) => sellToCustomer(t, a, sellSchema.parse(input)), { timeout: 30000 }));
}
export async function renameKindAction(kindKey: string, name: string) {
  return run((a) => tx((t) => ct.renameKind(t, a, z.string().max(80).parse(kindKey), z.string().max(50).parse(name))));
}
export async function moveSeriesKindAction(categoryId: string, input: { kindKey?: string | null; newKind?: string | null }) {
  return run((a) => tx((t) => ct.moveSeriesKind(t, a, z.string().parse(categoryId), z.object({ kindKey: z.string().max(80).nullish(), newKind: z.string().max(50).nullish() }).parse(input))));
}
export async function deleteCatalogCharacterAction(categoryId: string, productId: string) {
  return run((a) => tx((t) => ct.deleteCatalogCharacter(t, a, { categoryId: z.string().parse(categoryId), productId: z.string().parse(productId) })));
}
export async function deleteCatalogItemAction(categoryId: string, typeId: string) {
  return run((a) => tx((t) => ct.deleteCatalogItem(t, a, { categoryId: z.string().parse(categoryId), typeId: z.string().parse(typeId) })));
}
export async function deleteSeriesAction(categoryId: string) {
  return run((a) => tx((t) => ct.deleteSeries(t, a, z.string().parse(categoryId))));
}
export async function deleteKindAction(kindKey: string, input: { moveTo?: string | null; deleteSeries?: boolean }) {
  return run((a) => tx((t) => ct.deleteKind(t, a, z.string().max(80).parse(kindKey), z.object({ moveTo: z.string().max(80).nullish(), deleteSeries: z.boolean().optional() }).parse(input))));
}
const dir = z.enum(["up", "down", "top"]);
export async function moveKindAction(kindKey: string, d: "up" | "down" | "top") {
  return run((a) => tx((t) => ct.moveKind(t, a, z.string().max(80).parse(kindKey), dir.parse(d))).then(() => null));
}
export async function moveSeriesOrderAction(categoryId: string, d: "up" | "down" | "top") {
  return run((a) => tx((t) => ct.moveSeriesOrder(t, a, z.string().max(64).parse(categoryId), dir.parse(d))).then(() => null));
}

export async function setHideSharedAction(categoryId: string, hide: boolean) {
  return run((a) => tx((t) => ct.setHideShared(t, a, z.string().min(1).parse(categoryId), z.boolean().parse(hide))));
}
