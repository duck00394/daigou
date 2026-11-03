// 訂單憑證／貨況：有查看權杖（Email、LINE、查詢碼查到的連結）、或這支手機下過的單、或 LINE 登入的本人才看得到
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { oaChatUrl } from "@/server/line";
import { currentCustomer, myOrderIds } from "@/server/shop-auth";
import { getShopName } from "@/server/services/shop";
import { checkOrderToken, getShopInfo, sweepShopPay, threadsUrl } from "@/server/services/shop-pay";
import { orderView } from "@/server/services/shop-view";
import { taipeiDayLabel, taipeiParts } from "@/lib/taipei";
import { BackCircle, Eyebrow, SerifTitle } from "../../ui";
import { ContactButtons, Lines, PayBox, StatusTag, Steps } from "../parts";

export const metadata = { title: "訂單憑證" };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ id }, { t }] = await Promise.all([params, searchParams]);
  if (!/^[a-z0-9]{10,40}$/.test(id)) notFound();
  let ok = checkOrderToken(id, t);
  if (!ok) ok = (await myOrderIds()).includes(id);
  if (!ok) {
    const c = await currentCustomer();
    if (c) ok = !!(await prisma.order.findFirst({ where: { id, buyerId: c.id }, select: { id: true } }));
  }
  if (!ok) notFound();
  await sweepShopPay().catch(() => 0);
  const v = await orderView(prisma, id);
  if (!v) notFound();
  const [info, shopName] = await Promise.all([getShopInfo(prisma), getShopName(prisma)]);
  const row = (k: string, val: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-shop-mute">{k}</span>
      <span className="min-w-0 text-right">{val}</span>
    </div>
  );
  return (
    <>
      <header className="flex items-center gap-3 px-4 py-3">
        <BackCircle href="/shop/orders" label="我的訂單" />
        <div className="flex-1">
          <Eyebrow>ORDER</Eyebrow>
          <SerifTitle size={22}>訂單憑證</SerifTitle>
        </div>
      </header>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <div className="flex flex-col gap-3 rounded-[20px] border border-shop-line bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="num text-[16px] font-bold">{v.orderNo}</span>
            <StatusTag v={v} />
          </div>
          {v.cancelled && <p className="text-[13px] text-shop-ink-2">這筆訂單已取消{v.cancelReason ? `（${v.cancelReason}）` : ""}。</p>}
          <Steps v={v} />
          <PayBox v={v} bank={info.bankInfo} />
        </div>

        <div className="flex flex-col gap-3 rounded-[20px] border border-shop-line bg-white p-4">
          <Lines v={v} />
        </div>

        <div className="flex flex-col gap-1.5 rounded-[20px] border border-shop-line bg-white p-4 text-[14px]">
          {row("賣家", shopName)}
          {row("訂購人", v.buyerName)}
          {row("下單時間", `${taipeiDayLabel(v.orderedAt)} ${taipeiParts(v.orderedAt).time}`)}
          {row("付款方式", v.pay ? (v.pay.timing === "ORDER" ? "成立後用賣貨便下單" : "到貨後用賣貨便下單") : "另行通知")}
          {v.shipping && row("取貨方式", v.shipping)}
          {v.pay?.done && row("賣貨便", "已下單")}
          {v.shipments.map((s, i) => row(`出貨 ${i + 1}`, `${taipeiDayLabel(s.at)}${s.method ? `・${s.method}` : ""}${s.trackingNo ? `・單號 ${s.trackingNo}` : ""}`))}
          {v.intro && <p className="mt-1 whitespace-pre-line rounded-[12px] bg-shop-sand p-3 text-[13px] text-shop-ink-2">{v.intro}</p>}
        </div>

        <div className="flex flex-col gap-2 rounded-[20px] border border-shop-line bg-white p-4 text-[13px] leading-relaxed text-shop-ink-2">
          <div className="text-[14px] font-bold text-shop-ink">交易規則摘要</div>
          <p>現貨與預購的差異、排單、付款期限、取消與退款、採購失敗、到貨延遲與瑕疵處理，都寫在交易規則裡。</p>
          <div className="flex gap-4">
            <Link href="/shop/rules" className="font-bold text-shop-rose-2 underline">交易規則</Link>
            <Link href="/shop/privacy" className="font-bold text-shop-rose-2 underline">隱私權政策</Link>
          </div>
          {info.supportEmail && <p>客服 Email：<span className="select-all">{info.supportEmail}</span></p>}
          <ContactButtons line={oaChatUrl()} threads={threadsUrl(info.threads)} />
        </div>
        <p className="text-center text-[12px] text-shop-mute">請自行截圖保存這一頁。</p>
      </div>
    </>
  );
}
