// 排程服務（Upstash QStash）在付款期限到的時候呼叫：逾期沒在賣貨便下單的網站訂單自動取消並遞補候補
import { verifyQstash } from "@/server/push";
import { sweepShopPay } from "@/server/services/shop-pay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  if (!(await verifyQstash(req.headers.get("upstash-signature"), body))) return Response.json({ error: "簽章不正確" }, { status: 401 });
  try {
    const n = await sweepShopPay();
    return Response.json({ expired: n });
  } catch (e) {
    console.error("[pay expire]", e);
    return Response.json({ error: "系統錯誤" }, { status: 500 });
  }
}
