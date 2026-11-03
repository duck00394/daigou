import Link from "next/link";
import { prisma } from "@/server/db";
import { oaChatUrl } from "@/server/line";
import { checkOrderToken, getShopInfo, orderToken, threadsUrl } from "@/server/services/shop-pay";
import { orderView } from "@/server/services/shop-view";
import { Lines, PayBox, ScreenshotNote } from "../o/parts";
import { LookupCode } from "./code";

export const metadata = { title: "訂單已成立" };
export const dynamic = "force-dynamic";

export default async function Done({ searchParams }: { searchParams: Promise<{ o?: string }> }) {
  const { o = "" } = await searchParams;
  const pairs = o
    .split(",")
    .slice(0, 10)
    .map((p) => p.split("."))
    .filter(([id, t]) => id && checkOrderToken(id, t));
  const views = (await Promise.all(pairs.map(([id]) => orderView(prisma, id)))).filter((v): v is NonNullable<typeof v> => !!v);
  const info = await getShopInfo(prisma);
  const line = oaChatUrl();
  const threads = threadsUrl(info.threads);
  return (
    <div className="flex flex-col gap-4 px-4 pt-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-shop-good-soft text-shop-good">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-[3px] text-shop-rose">THANK YOU</div>
          <h1 className="font-serif text-[26px] font-bold">訂單已成立</h1>
        </div>
      </div>

      {views.length === 0 ? (
        <p className="rounded-[18px] border border-shop-line bg-white p-5 text-center text-[14px] text-shop-mute">訂單已經送出。可以到「我的訂單」查看。</p>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-[18px] border border-shop-line bg-white p-4 text-[14px]">
            {views.map((v) => (
              <div key={v.id} className="flex items-baseline justify-between gap-3">
                <span className="text-shop-mute">訂單編號{views.length > 1 ? `（${v.series}）` : ""}</span>
                <span className="num font-bold">{v.orderNo}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-shop-mute">查詢碼</span>
              <LookupCode ids={views.map((v) => v.id)} />
            </div>
          </div>

          <ScreenshotNote line={line} threads={threads} />

          {views.map((v) => (
            <div key={v.id} className="flex flex-col gap-3 rounded-[18px] border border-shop-line bg-white p-4">
              <Lines v={v} />
              <PayBox v={v} />
              <Link href={`/shop/o/${v.id}?t=${orderToken(v.id)}`} className="flex h-11 items-center justify-center rounded-full border border-[#d8c9bc] text-[14px] text-shop-ink-2">
                查看完整訂單憑證
              </Link>
            </div>
          ))}
        </>
      )}

      <div className="flex justify-center gap-5 pb-4 text-[14px]">
        <Link href="/shop/orders" className="text-shop-rose-2 underline">我的訂單</Link>
        <Link href="/shop" className="text-shop-rose-2 underline">繼續逛</Link>
      </div>
    </div>
  );
}
