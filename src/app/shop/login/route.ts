// 用 LINE 登入訂購頁：記下 state／nonce（防止被偽造的登入回來），再導到 LINE 的登入畫面
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, loginConfigured } from "@/server/line";
import { OAUTH_COOKIE, readPending, secureCookie } from "@/server/shop-auth";

export const dynamic = "force-dynamic";

const safeNext = (n: string | null) => (n && /^\/shop(\/[^\s]*)?$/.test(n) && !n.startsWith("//") ? n : "/shop");

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  if (!loginConfigured()) {
    const u = req.nextUrl.clone();
    u.pathname = "/shop";
    u.search = "?err=line";
    return NextResponse.redirect(u);
  }
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(state, nonce));
  const prev = readPending(req.cookies.get(OAUTH_COOKIE)?.value).slice(-2);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify([...prev, { state, nonce, next }]), { httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
