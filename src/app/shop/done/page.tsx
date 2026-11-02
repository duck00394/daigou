import Link from "next/link";
import { oaChatUrl } from "@/server/line";
import { GoLine } from "./go-line";

export const metadata = { title: "訂單已送出" };

export default async function Done({ searchParams }: { searchParams: Promise<{ no?: string }> }) {
  const { no } = await searchParams;
  const chat = oaChatUrl();
  return (
    <div className="flex min-h-[80dvh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-shop-good-soft text-shop-good">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <div>
        <div className="text-[11px] font-bold tracking-[3px] text-shop-rose">THANK YOU</div>
        <h1 className="font-serif text-[26px] font-bold">訂單已成立</h1>
        {no && <p className="mt-1 text-[14px] text-shop-mute">訂單編號 {no}</p>}
      </div>
      <p className="text-[14px] leading-relaxed text-shop-ink-2">訂單明細已經傳到 LINE 聊天室，之後採購、到貨、出貨也會在那裡通知你。</p>
      {chat && <GoLine href={chat} />}
      <div className="flex gap-4 text-[14px]">
        <Link href="/shop/orders" className="text-shop-rose-2 underline">我的訂單</Link>
        <Link href="/shop" className="text-shop-rose-2 underline">繼續逛</Link>
      </div>
    </div>
  );
}
