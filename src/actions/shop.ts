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
  payUrl: z.string().max(1000).nullable(),
  payTiming: z.enum(["ORDER", "ARRIVAL"]),
  payHours: z.number().int(),
});

export async function saveShopCategoryAction(categoryId: string, raw: z.infer<typeof catSchema>) {
  return run(async (a) => {
    const v = catSchema.parse(raw);
    let openAt: Date | null = null;
    if (v.openDate || v.openTime) {
      openAt = taipeiToUtc(v.openDate, v.openTime || "00:00");
      if (!openAt) throw new BizError("開賣時間格式不對");
    }
    await tx((t) => shop.saveShopCategory(t, a, categoryId, { enabled: v.enabled, openAt, perPersonLimit: v.perPersonLimit, ownerId: v.ownerId, imageUrl: v.imageUrl, intro: v.intro, payUrl: v.payUrl, payTiming: v.payTiming, payHours: v.payHours }));
    revalidatePath(`/shop-admin/${categoryId}`);
    revalidatePath("/shop");
    return true;
  });
}

const quotaSchema = z.array(z.object({ productId: z.string().max(64), quota: z.number().int().nullable(), price: z.number().int().nullable().optional(), bundleNeed: z.number().int().nullable().optional(), bundleAmount: z.number().int().nullable().optional() })).max(500);

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

export async function setContactFieldAction(mode: string, label: string) {
  return run(async (a) => {
    await tx((t) => shop.setContactField(t, a, { mode: z.enum(["phone", "text", "none"]).parse(mode), label: z.string().max(40).parse(label) }));
    revalidatePath("/shop", "layout");
    revalidatePath("/shop-admin");
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

/** 後台訂單頁：傳賣貨便連結給客人（LINE），馬上送出並回報結果 */
export async function sendSaleLinkAction(orderId: string, url: string, note: string | null) {
  return run(async (a) => {
    const r = await tx((t) => shop.sendSaleLink(t, a, z.string().max(64).parse(orderId), { url: z.string().max(1000).parse(url), note: note === null ? null : z.string().max(400).parse(note) }));
    const { flushLineOutbox } = await import("@/server/line");
    const { prisma } = await import("@/server/db");
    await flushLineOutbox();
    const row = await prisma.lineOutbox.findUnique({ where: { id: r.outboxId } });
    if (!row?.sentAt) throw new BizError(`LINE 沒有送出去${row?.error ? `：${row.error.slice(0, 80)}` : "，請稍後再試"}`);
    return { buyer: r.buyer };
  });
}

// ───────────── 訂購頁付款（賣貨便） ─────────────

const idSchema = z.string().max(64);

export async function setShopInfoAction(threads: string, supportEmail: string) {
  return run(async (a) => {
    const { setShopInfo } = await import("@/server/services/shop-pay");
    const r = await tx((t) => setShopInfo(t, a, { threads: z.string().max(100).parse(threads), supportEmail: z.string().max(254).parse(supportEmail) }));
    revalidatePath("/shop", "layout");
    revalidatePath("/shop-admin");
    return r;
  });
}

async function payOp<T>(fn: (t: Parameters<Parameters<typeof tx>[0]>[0], a: { userId: string | null }) => Promise<T>) {
  return run(async (a) => {
    const r = await tx((t) => fn(t, a), { timeout: 30_000 });
    revalidatePath("/shop-pay");
    return r;
  });
}

export async function markMyshipAction(orderId: string, ref: string | null) {
  const { markMyship } = await import("@/server/services/shop-pay");
  return payOp((t, a) => markMyship(t, a, idSchema.parse(orderId), ref === null ? null : z.string().max(80).parse(ref)));
}

export async function undoMyshipAction(orderId: string) {
  const { undoMyship } = await import("@/server/services/shop-pay");
  return payOp((t, a) => undoMyship(t, a, idSchema.parse(orderId)));
}

export async function resendPayAction(orderId: string) {
  const { resendPay } = await import("@/server/services/shop-pay");
  return payOp((t, a) => resendPay(t, a, idSchema.parse(orderId)));
}

export async function extendPayAction(orderId: string, hours: number) {
  const { extendPay } = await import("@/server/services/shop-pay");
  return payOp((t, a) => extendPay(t, a, idSchema.parse(orderId), z.number().int().parse(hours)));
}

export async function startArrivalPayAction(orderIds: string[]) {
  const { startArrivalPay } = await import("@/server/services/shop-pay");
  return payOp((t, a) => startArrivalPay(t, a, z.array(idSchema).max(300).parse(orderIds)));
}

export async function cancelOverdueAction(orderId: string) {
  const { cancelOrder } = await import("@/server/services/orders");
  return payOp((t, a) => cancelOrder(t, a, { orderId: idSchema.parse(orderId), reason: "超過時間沒有用賣貨便下單" }));
}
