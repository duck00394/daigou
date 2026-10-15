"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import * as cat from "@/server/services/catalog";
import { parseDay, parseDateTimeInput } from "@/lib/labels";

const intOrNull = z.union([z.number().int(), z.null()]).optional();
const productSchema = z.object({
  name: z.string().max(200),
  imageUrl: z.string().max(1000).nullish(),
  series: z.string().max(100).nullish(),
  spec: z.string().max(200).nullish(),
  productTypeId: z.string().nullish(),
  status: z.enum(["IN_STOCK", "PREORDER", "SOLD_OUT", "PAUSED", "OUT_OF_PRINT", "DISCONTINUED"]),
  officialPriceJpy: intOrNull,
  salePriceTwd: intOrNull,
  estCostTwd: intOrNull,
  weightGrams: intOrNull,
  sourceName: z.string().max(100).nullish(),
  sourceUrl: z.string().max(1000).nullish(),
  releaseDate: z.string().nullish(),
  expectedArrivalDate: z.string().nullish(),
  actualArrivalDate: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
  characterIds: z.array(z.string()).max(50),
  categoryIds: z.array(z.string()).max(100),
  aliases: z.array(z.string().max(100)).max(50).optional(),
});
export type ProductForm = z.infer<typeof productSchema>;

function toInput(f: ProductForm) {
  return { ...f, releaseDate: parseDay(f.releaseDate), expectedArrivalDate: parseDay(f.expectedArrivalDate), actualArrivalDate: parseDay(f.actualArrivalDate) };
}

export async function saveProductAction(id: string | null, form: ProductForm) {
  return run(async (a) => {
    const f = productSchema.parse(form);
    if (id) {
      await tx((t) => cat.updateProduct(t, a, id, toInput(f)));
      return { id };
    }
    const p = await tx((t) => cat.createProduct(t, a, toInput(f)));
    return { id: p.id };
  });
}

export async function archiveProductAction(id: string, archived: boolean) {
  return run((a) => tx((t) => cat.setArchived(t, a, id, archived)));
}

export async function addProductAliasAction(productId: string, alias: string) {
  return run((a) => tx((t) => cat.addProductAlias(t, a, productId, z.string().max(100).parse(alias))));
}
export async function removeProductAliasAction(aliasId: string) {
  return run((a) => tx((t) => cat.removeProductAlias(t, a, aliasId)));
}

export async function saveCharacterAction(input: { id?: string; name: string; active?: boolean }) {
  return run((a) => tx((t) => cat.upsertCharacter(t, a, input)));
}
export async function saveProductTypeAction(input: { id?: string; name: string; active?: boolean }) {
  return run((a) => tx((t) => cat.upsertProductType(t, a, input)));
}

const categorySchema = z.object({
  name: z.string().max(100),
  type: z.enum(["FESTIVAL", "REGION", "SERIES", "ICHIBAN", "STORE_LIMITED", "GENERAL", "CUSTOM"]),
  customType: z.string().max(50).nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
  active: z.boolean(),
});
export async function saveCategoryAction(id: string | null, form: z.infer<typeof categorySchema>) {
  return run(async (a) => {
    const f = categorySchema.parse(form);
    const row = await tx((t) => cat.saveCategory(t, a, id, { ...f, startDate: parseDay(f.startDate), endDate: parseDay(f.endDate) }));
    return { id: row.id };
  });
}
export async function setCategoryActiveAction(id: string, active: boolean) {
  return run((a) => tx((t) => cat.setCategoryActive(t, a, id, active)));
}
export async function addProductsToCategoryAction(categoryId: string, productIds: string[]) {
  return run((a) => tx((t) => cat.addProductsToCategory(t, a, categoryId, productIds)));
}

const gbSchema = z.object({
  name: z.string().max(100),
  categoryId: z.string().nullish(),
  status: z.enum(["DRAFT", "OPEN", "CLOSED", "COMPLETED", "CANCELLED"]),
  openAt: z.string().nullish(),
  closeAt: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
});
export async function saveGroupBuyAction(id: string | null, form: z.infer<typeof gbSchema>) {
  return run(async (a) => {
    const f = gbSchema.parse(form);
    const row = await tx((t) => cat.saveGroupBuy(t, a, id, { ...f, openAt: parseDateTimeInput(f.openAt), closeAt: parseDateTimeInput(f.closeAt) }));
    return { id: row.id };
  });
}
