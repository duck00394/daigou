// LINE 登入回來：核對 state、跟 LINE 換登入資料、找到或建立這位客人，發訂購頁的登入 Cookie
import { NextResponse, type NextRequest } from "next/server";
import { tx } from "@/server/db";
import { exchangeCode } from "@/server/line";
import { nextCode } from "@/server/services/common";
import { upsertLineBuyer } from "@/server/services/shop";
import { OAUTH_COOKIE, SHOP_COOKIE, readState, secureCookie, signShop } from "@/server/shop-auth";

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
  const hit = await readState(sp.get("state"));
  const next = hit?.next && /^\/shop(\/|$|\?)/.test(hit.next) ? hit.next : "/shop";
  // 客人在 LINE 畫面按了取消
  if (sp.get("error")) {
    console.warn("[shop login] LINE 回傳錯誤", sp.get("error"), sp.get("error_description"));
    return back(req, next);
  }
  const code = sp.get("code");
  if (!code) return back(req, "/shop?err=login&why=nocode");
  if (!hit) return back(req, "/shop?err=login&why=state");
  try {
    const profile = await exchangeCode(code, hit.nonce);
    const buyerId = await tx((t) => upsertLineBuyer(t, profile, () => nextCode(t, "buyer")));
    // 用一般頁面（不是轉址）發登入 Cookie，再自動回到原本的頁面：有些內建瀏覽器不收轉址回應上的 Cookie
    const to = new URL(next, req.nextUrl.origin).toString();
    const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${to}"><title>登入成功</title></head><body style="font-family:sans-serif;text-align:center;padding:40px;color:#3b2f2a;background:#fbf6f0">登入成功，正在回到頁面…<br><a href="${to}">沒有自動跳轉請點這裡</a><script>location.replace(${JSON.stringify(to)})</script></body></html>`;
    const res = new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    res.cookies.set(SHOP_COOKIE, await signShop(buyerId), { httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/", maxAge: 60 * 86400 });
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("[shop login]", msg);
    const why = msg.includes("驗證") ? "verify" : msg.includes("登入失敗") ? "token" : "db";
    const m = /（(\d{3})）([a-z_]*)/i.exec(msg);
    return back(req, `/shop?err=login&why=${why}${m?.[1] ?? ""}${m?.[2] ? `-${m[2]}` : ""}`);
  }
}
