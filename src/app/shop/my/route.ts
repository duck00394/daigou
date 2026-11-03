// 「寄給我所有訂單」信裡的連結：把這個 Email 的訂單記到這支手機，再打開「我的訂單」（連結 30 分鐘內有效）
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { rememberOrders } from "@/server/shop-auth";
import { readListToken } from "@/server/services/shop-pay";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const buyerId = readListToken(url.searchParams.get("t"));
  const back = new URL("/shop/orders", url.origin);
  if (!buyerId) {
    back.searchParams.set("expired", "1");
    return NextResponse.redirect(back);
  }
  const orders = await prisma.order.findMany({ where: { buyerId, source: "WEB" }, orderBy: { orderedAt: "desc" }, take: 40, select: { id: true } });
  await rememberOrders(orders.map((o) => o.id));
  return NextResponse.redirect(back);
}
