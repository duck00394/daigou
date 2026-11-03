"use server";
// 訂購頁的客人動作：LINE 登入的客人只能動自己的資料；訪客只能下單、用查詢碼或 Email 連結查自己的訂單
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { BizError, prisma, tx } from "@/server/db";
import { flushLineOutbox } from "@/server/line";
import { flushMailOutbox } from "@/server/mail";
import { currentCustomer, rememberOrders, shopRateLimited } from "@/server/shop-auth";
import { nextCode } from "@/server/services/common";
import * as shop from "@/server/services/shop";
import * as pay from "@/server/services/shop-pay";

export type ShopResult<T> = { ok: true; data: T } | { ok: false; error: string; login?: boolean };

async function shopRun<T>(fn: (buyerId: string) => Promise<T>): Promise<ShopResult<T>> {
  try {
    const c = await currentCustomer();
    if (!c) return { ok: false, error: "請先用 LINE 登入", login: true };
    const data = await fn(c.id);
    await flushAll();
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

async function flushAll() {
  await Promise.allSettled([flushLineOutbox().catch((e) => console.error("[line]", e)), flushMailOutbox().catch((e) => console.error("[mail]", e))]);
}

function fail(e: unknown): { ok: false; error: string } {
  {
    if (e instanceof BizError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: "資料格式不對，請重新整理再試" };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") return { ok: false, error: "現在下單的人很多，請再按一次" };
    console.error("[shop action]", e);
    return { ok: false, error: "系統忙碌中，訂單沒有送出，請稍後再試" };
  }
}

const lineSchema = z.object({ categoryId: z.string().max(64), productId: z.string().max(64), qty: z.number().int().min(1).max(99) });
const contactSchema = z.object({ name: z.string().max(60), phone: z.string().max(80), shipping: z.string().max(40), note: z.string().max(300).nullish(), social: z.string().max(80).nullish() });

/** 送出訂單：有 LINE 登入就用 LINE 的身分；沒登入就是訪客（要填 Email） */
export async function placeOrderAction(lines: z.infer<typeof lineSchema>[], contact: z.infer<typeof contactSchema>, key: string, opts: { guestEmail?: string | null; agree: boolean }) {
  try {
    if (opts?.agree !== true) return { ok: false as const, error: "請先勾選已閱讀交易規則與隱私權政策" };
    const c = await currentCustomer();
    const input = { lines: z.array(lineSchema).max(100).parse(lines), contact: contactSchema.parse(contact), key: z.string().max(100).parse(key) };
    let r: shop.PlacedOrders;
    if (c) {
      r = await tx((t) => shop.placeShopOrder(t, c.id, input), { timeout: 20_000 });
    } else {
      const email = z.string().max(254).parse(opts.guestEmail ?? "");
      if (!email.trim()) return { ok: false as const, error: "請填 Email（收訂單通知和查詢碼用）" };
      r = await tx(async (t) => shop.placeShopOrder(t, await pay.guestBuyer(t, email, input.contact.name, () => nextCode(t, "buyer")), input), { timeout: 20_000 });
    }
    await rememberOrders(r.orders.map((o) => o.orderId));
    await flushAll();
    revalidatePath("/shop", "layout");
    return { ok: true as const, data: { orders: r.orders, code: r.code, tokens: r.orders.map((o) => pay.orderToken(o.orderId)) } };
  } catch (e) {
    return fail(e);
  }
}

/** 訂單編號＋查詢碼查訂單（猜錯太多次會暫停 15 分鐘） */
export async function lookupAction(orderNo: string, code: string) {
  try {
    const rl = await shopRateLimited("lookup", 10, 15);
    if (rl.limited) return { ok: false as const, error: "查詢失敗太多次，請 15 分鐘後再試" };
    const id = await pay.lookupOrder(prisma, z.string().max(40).parse(orderNo), z.string().max(20).parse(code));
    await rl.record(!!id);
    if (!id) return { ok: false as const, error: "訂單編號或查詢碼不對，請再檢查一次" };
    await rememberOrders([id]);
    return { ok: true as const, data: { orderId: id, token: pay.orderToken(id) } };
  } catch (e) {
    return fail(e);
  }
}

/** 寄給我所有訂單：一律回同一句話，不透露這個 Email 有沒有訂單 */
export async function mailMyOrdersAction(email: string) {
  try {
    const rl = await shopRateLimited("mail", 5, 60);
    if (rl.limited) return { ok: false as const, error: "要求太多次了，請 1 小時後再試" };
    await rl.record(false);
    await tx((t) => pay.mailMyOrders(t, z.string().max(254).parse(email)));
    await flushAll();
    return { ok: true as const, data: true };
  } catch (e) {
    return fail(e);
  }
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

/** 客人回傳匯款末五碼：要有這筆的查看權杖，或是這支手機下的單、或 LINE 登入的本人 */
export async function reportDepositAction(orderId: string, token: string | null, ref: string) {
  try {
    const id = z.string().max(64).parse(orderId);
    let ok = pay.checkOrderToken(id, token);
    if (!ok) {
      const { myOrderIds } = await import("@/server/shop-auth");
      ok = (await myOrderIds()).includes(id);
    }
    if (!ok) {
      const c = await currentCustomer();
      ok = !!c && !!(await prisma.order.findFirst({ where: { id, buyerId: c.id }, select: { id: true } }));
    }
    if (!ok) return { ok: false as const, error: "找不到這筆訂單，請用訂單編號＋查詢碼重新查詢" };
    await tx((t) => pay.reportDeposit(t, id, z.string().max(20).parse(ref)));
    await flushAll();
    revalidatePath("/shop", "layout");
    return { ok: true as const, data: true };
  } catch (e) {
    return fail(e);
  }
}
