// 用 LINE 登入訂購頁：state 是簽章過的（含 nonce、登入後回哪頁），防止被偽造的登入回來；再導到 LINE 的登入畫面
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, loginConfigured } from "@/server/line";
import { signState } from "@/server/shop-auth";

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
  const nonce = randomBytes(16).toString("base64url");
  return NextResponse.redirect(authorizeUrl(await signState(nonce, next), nonce));
}
