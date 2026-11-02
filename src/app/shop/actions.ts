"use server";
// 訂購頁的客人動作：一律先確認是用 LINE 登入的客人，只能動自己的資料
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { BizError, tx } from "@/server/db";
import { flushLineOutbox } from "@/server/line";
import { currentCustomer } from "@/server/shop-auth";
import * as shop from "@/server/services/shop";

export type ShopResult<T> = { ok: true; data: T } | { ok: false; error: string; login?: boolean };

async function shopRun<T>(fn: (buyerId: string) => Promise<T>): Promise<ShopResult<T>> {
  try {
    const c = await currentCustomer();
    if (!c) return { ok: false, error: "請先用 LINE 登入", login: true };
    const data = await fn(c.id);
    await flushLineOutbox().catch((e) => console.error("[line]", e));
    return { ok: true, data };
  } catch (e) {
    if (e instanceof BizError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: "資料格式不對，請重新整理再試" };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") return { ok: false, error: "現在下單的人很多，請再按一次" };
    console.error("[shop action]", e);
    return { ok: false, error: "系統忙碌中，訂單沒有送出，請稍後再試" };
  }
}

const lineSchema = z.object({ categoryId: z.string().max(64), productId: z.string().max(64), qty: z.number().int().min(1).max(99) });
const contactSchema = z.object({ name: z.string().max(60), phone: z.string().max(80), shipping: z.string().max(40), note: z.string().max(300).nullish() });

export async function placeOrderAction(lines: z.infer<typeof lineSchema>[], contact: z.infer<typeof contactSchema>, key: string) {
  return shopRun(async (buyerId) => {
    const r = await tx((t) => shop.placeShopOrder(t, buyerId, { lines: z.array(lineSchema).max(100).parse(lines), contact: contactSchema.parse(contact), key: z.string().max(100).parse(key) }), { timeout: 20_000 });
    revalidatePath("/shop", "layout");
    return r;
  });
}

export async function joinWaitAction(categoryId: string, productId: string, qty: number) {
  return shopRun(async (buyerId) => {
    const r = await tx((t) => shop.joinWait(t, buyerId, { categoryId: z.string().max(64).parse(categoryId), productId: z.string().max(64).parse(productId), qty: z.number().int().parse(qty) }));
    revalidatePath("/shop", "layout");
    return r;
  });
}

export async function cancelWaitAction(waitId: string) {
  return shopRun(async (buyerId) => {
    await tx((t) => shop.cancelWait(t, buyerId, z.string().max(64).parse(waitId)));
    revalidatePath("/shop/orders");
    return true;
  });
}
