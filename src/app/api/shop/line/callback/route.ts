// LINE 登入回來：核對 state、跟 LINE 換登入資料、找到或建立這位客人，發訂購頁的登入 Cookie
import { NextResponse, type NextRequest } from "next/server";
import { tx } from "@/server/db";
import { exchangeCode } from "@/server/line";
import { nextCode } from "@/server/services/common";
import { upsertLineBuyer } from "@/server/services/shop";
import { OAUTH_COOKIE, SHOP_COOKIE, secureCookie, signShop } from "@/server/shop-auth";

export const dynamic = "force-dynamic";

function back(req: NextRequest, path: string) {
  const u = req.nextUrl.clone();
  const [p, q] = path.split("?");
  u.pathname = p;
  u.search = q ? `?${q}` : "";
  return NextResponse.redirect(u);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  let saved: { state?: string; nonce?: string; next?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get(OAUTH_COOKIE)?.value ?? "{}");
  } catch {
    saved = {};
  }
  const next = saved.next && saved.next.startsWith("/shop") ? saved.next : "/shop";
  // 客人在 LINE 畫面按了取消
  if (sp.get("error")) return back(req, next);
  const code = sp.get("code");
  if (!code || !saved.state || !saved.nonce || sp.get("state") !== saved.state) return back(req, "/shop?err=login");
  try {
    const profile = await exchangeCode(code, saved.nonce);
    const buyerId = await tx((t) => upsertLineBuyer(t, profile, () => nextCode(t, "buyer")));
    const res = back(req, next);
    res.cookies.set(SHOP_COOKIE, await signShop(buyerId), { httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/", maxAge: 60 * 86400 });
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  } catch (e) {
    console.error("[shop login]", e);
    return back(req, "/shop?err=login");
  }
}
