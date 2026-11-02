import { NextResponse, type NextRequest } from "next/server";
import { SHOP_COOKIE } from "@/server/shop-auth";

export async function GET(req: NextRequest) {
  const u = req.nextUrl.clone();
  u.pathname = "/shop";
  u.search = "";
  const res = NextResponse.redirect(u);
  res.cookies.delete(SHOP_COOKIE);
  return res;
}
