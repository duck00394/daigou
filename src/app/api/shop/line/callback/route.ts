// LINE 登入回來：核對 state、跟 LINE 換登入資料、找到或建立這位客人，發訂購頁的登入 Cookie
import { NextResponse, type NextRequest } from "next/server";
import { tx } from "@/server/db";
import { exchangeCode } from "@/server/line";
import { nextCode } from "@/server/services/common";
import { upsertLineBuyer } from "@/server/services/shop";
import { OAUTH_COOKIE, SHOP_COOKIE, readPending, secureCookie, signShop } from "@/server/shop-auth";

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
  const pending = readPending(req.cookies.get(OAUTH_COOKIE)?.value);
  const hit = pending.find((p) => p.state === sp.get("state"));
  const next = hit?.next && hit.next.startsWith("/shop") ? hit.next : "/shop";
  // 客人在 LINE 畫面按了取消
  if (sp.get("error")) {
    console.warn("[shop login] LINE 回傳錯誤", sp.get("error"), sp.get("error_description"));
    return back(req, next);
  }
  const code = sp.get("code");
  if (!code) return back(req, "/shop?err=login&why=nocode");
  if (!pending.length) return back(req, "/shop?err=login&why=nocookie");
  if (!hit) return back(req, "/shop?err=login&why=state");
  try {
    const profile = await exchangeCode(code, hit.nonce);
    const buyerId = await tx((t) => upsertLineBuyer(t, profile, () => nextCode(t, "buyer")));
    const res = back(req, next);
    res.cookies.set(SHOP_COOKIE, await signShop(buyerId), { httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/", maxAge: 60 * 86400 });
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("[shop login]", msg);
    const why = msg.includes("驗證") ? "verify" : msg.includes("登入失敗") ? "token" : "db";
    const status = /（(\d{3})）/.exec(msg)?.[1] ?? "";
    return back(req, `/shop?err=login&why=${why}${status}`);
  }
}
