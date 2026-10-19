// 第一層檢查：沒有登入 Cookie 時直接導向登入頁。
// 這裡不驗證 Cookie 內容；所有頁面、Server Action 與 API 仍會在伺服器端完整驗證。
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/manifest.webmanifest", "/sw.js", "/api/rush/fire"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p)) return NextResponse.next();
  if (req.cookies.get("dg_session")?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "未登入" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|robots.txt).*)"],
};
