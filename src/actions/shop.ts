"use server";
// 後台：訂購頁的設定（系列開放訂購、開放數量、經營者綁 LINE）
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { tx, BizError } from "@/server/db";
import * as shop from "@/server/services/shop";
import { taipeiToUtc } from "@/lib/taipei";

const catSchema = z.object({
  enabled: z.boolean(),
  openDate: z.string().max(10),
  openTime: z.string().max(5),
  perPersonLimit: z.number().int().nullable(),
  ownerId: z.string().max(64).nullable(),
  imageUrl: z.string().max(1000).nullable(),
  intro: z.string().max(1000).nullable(),
});

export async function saveShopCategoryAction(categoryId: string, raw: z.infer<typeof catSchema>) {
  return run(async (a) => {
    const v = catSchema.parse(raw);
    let openAt: Date | null = null;
    if (v.openDate || v.openTime) {
      openAt = taipeiToUtc(v.openDate, v.openTime || "00:00");
      if (!openAt) throw new BizError("開賣時間格式不對");
    }
    await tx((t) => shop.saveShopCategory(t, a, categoryId, { enabled: v.enabled, openAt, perPersonLimit: v.perPersonLimit, ownerId: v.ownerId, imageUrl: v.imageUrl, intro: v.intro }));
    revalidatePath(`/shop-admin/${categoryId}`);
    revalidatePath("/shop");
    return true;
  });
}

const quotaSchema = z.array(z.object({ productId: z.string().max(64), quota: z.number().int().nullable(), price: z.number().int().nullable().optional() })).max(500);

export async function saveQuotasAction(categoryId: string, raw: z.infer<typeof quotaSchema>) {
  return run(async (a) => {
    const rows = quotaSchema.parse(raw);
    const r = await tx((t) => shop.saveQuotas(t, a, categoryId, rows), { timeout: 60_000 });
    revalidatePath(`/shop-admin/${categoryId}`);
    return r;
  });
}

export async function bindOperatorLineAction(operatorId: string, buyerId: string | null) {
  return run(async (a) => {
    await tx((t) => shop.bindOperatorLine(t, a, z.string().max(64).parse(operatorId), buyerId ? z.string().max(64).parse(buyerId) : null));
    revalidatePath("/shop-admin");
    return true;
  });
}

export async function setShopNameAction(name: string) {
  return run(async (a) => {
    await tx((t) => shop.setShopName(t, a, z.string().max(40).parse(name)));
    revalidatePath("/shop", "layout");
    return true;
  });
}

/** 品項全體照（貼網址）；空白＝拿掉 */
export async function setTypeImageAction(categoryId: string, productTypeId: string, url: string | null) {
  return run(async (a) => {
    const v = await tx((t) => shop.setTypeImage(t, a, z.string().max(64).parse(categoryId), z.string().max(64).parse(productTypeId), url === null ? null : z.string().max(1000).parse(url)));
    revalidatePath(`/shop-admin/${categoryId}`);
    revalidatePath("/shop", "layout");
    return v;
  });
}
