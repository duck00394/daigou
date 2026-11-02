// 訂購頁的客人登入（LINE 登入後發的 Cookie）。跟後台的管理者登入完全分開：
// 這個 Cookie 只能看自己的訂單、下單，不能進後台。
import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/server/db";

export const SHOP_COOKIE = "dg_shop";
export const OAUTH_COOKIE = "dg_shop_oauth";
const DAYS = 60;

function secret() {
  const base = process.env.SHOP_SESSION_SECRET || `${process.env.LINE_LOGIN_CHANNEL_SECRET ?? ""}|${process.env.ADMIN_PASSWORD_HASH ?? ""}|shop`;
  return new Uint8Array(createHash("sha256").update(base).digest());
}

export const secureCookie = () => process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIE !== "1";

export async function signShop(buyerId: string) {
  return new SignJWT({ b: buyerId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${DAYS}d`).sign(secret());
}

export async function setShopCookie(buyerId: string) {
  const jar = await cookies();
  jar.set(SHOP_COOKIE, await signShop(buyerId), { httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/", maxAge: DAYS * 86400 });
}

export async function shopBuyerId(): Promise<string | null> {
  const v = (await cookies()).get(SHOP_COOKIE)?.value;
  if (!v || v.length > 1000) return null;
  try {
    const { payload } = await jwtVerify(v, secret(), { algorithms: ["HS256"] });
    return typeof payload.b === "string" ? payload.b : null;
  } catch {
    return null;
  }
}

export type ShopCustomer = { id: string; name: string; picture: string | null; lineUserId: string };

/** 目前登入的客人；沒登入或資料不見了回傳 null */
export async function currentCustomer(): Promise<ShopCustomer | null> {
  const id = await shopBuyerId();
  if (!id) return null;
  const b = await prisma.buyer.findUnique({ where: { id }, select: { id: true, name: true, linePicture: true, lineUserId: true, mergedIntoId: true, archivedAt: true } });
  if (!b || !b.lineUserId || b.archivedAt) return null;
  // 被合併到別的買家：改用留下來的那位（LINE 也搬過去了）
  if (b.mergedIntoId) {
    const m = await prisma.buyer.findUnique({ where: { id: b.mergedIntoId }, select: { id: true, name: true, linePicture: true, lineUserId: true } });
    return m?.lineUserId ? { id: m.id, name: m.name, picture: m.linePicture, lineUserId: m.lineUserId } : null;
  }
  return { id: b.id, name: b.name, picture: b.linePicture, lineUserId: b.lineUserId };
}

/** LINE 登入的 state：把 nonce 和登入後要回去的頁面簽章後放在 state 裡（10 分鐘內有效）。
 * 不靠 Cookie，所以在 LINE 內建瀏覽器、或登入途中跳到 LINE App 再回來也不會失敗。 */
export async function signState(nonce: string, next: string) {
  return new SignJWT({ n: nonce, x: next, k: "st" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(secret());
}

export async function readState(state: string | null): Promise<{ nonce: string; next: string } | null> {
  if (!state || state.length > 600) return null;
  try {
    const { payload } = await jwtVerify(state, secret(), { algorithms: ["HS256"] });
    if (payload.k !== "st" || typeof payload.n !== "string" || typeof payload.x !== "string") return null;
    return { nonce: payload.n, next: payload.x };
  } catch {
    return null;
  }
}
