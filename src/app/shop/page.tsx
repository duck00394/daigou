import Link from "next/link";
import { prisma } from "@/server/db";
import { currentCustomer } from "@/server/shop-auth";
import { getShopName, isOpen, shopCategories, shopProducts } from "@/server/services/shop";
import { taipeiDayLabel, taipeiParts } from "@/lib/taipei";
import { CartBar, Countdown, Pic } from "./cart";
import { groupTypes, Notice, SerifTitle, ShopHeader, Tag, TypeCard } from "./ui";

export default async function ShopHome({ searchParams }: { searchParams: Promise<{ err?: string; why?: string }> }) {
  const sp = await searchParams;
  const [name, customer, cats] = await Promise.all([getShopName(prisma), currentCustomer(), shopCategories(prisma)]);
  const now = new Date();
  const upcoming = cats.filter((c) => c.openAt && c.openAt > now).sort((a, b) => a.openAt!.getTime() - b.openAt!.getTime())[0];
  const groups = (await Promise.all(cats.slice(0, 6).map(async (c) => groupTypes(await shopProducts(prisma, c.categoryId)).map((g) => ({ g, c }))))).flat().slice(0, 8);

  return (
    <>
      <ShopHeader name={name} customer={customer} next="/shop" />
      {sp.err && (
        <div className="px-4 pt-4">
          <Notice>{sp.err === "line" ? "LINE 登入還沒設定好，請稍後再試或直接私訊我們。" : "LINE 登入沒有成功，請再試一次。"}{sp.why && <span className="ml-1 text-[12px] opacity-70">（代碼：{sp.why.replace(/[^a-z0-9_-]/gi, "").slice(0, 40)}）</span>}</Notice>
        </div>
      )}

      {upcoming && (
        <section className="px-4 pt-5">
          <div className={`relative overflow-hidden rounded-[24px] bg-white shadow-lift-7 ${upcoming.imageUrl ? "" : "h-[300px]"}`}>
            {upcoming.imageUrl ? <Pic src={upcoming.imageUrl} alt={upcoming.category.name} fit="natural" /> : <Pic src={null} alt={upcoming.category.name} seed={1} className="absolute inset-0 h-full w-full" label="" />}
            <div className={`${upcoming.imageUrl ? "relative" : "absolute inset-x-3.5 bottom-3.5 rounded-[18px] bg-white/95"} flex flex-col gap-2 p-4`}>
              <SerifTitle>{upcoming.category.name}　開賣倒數</SerifTitle>
              <div className="flex items-center gap-2">
                <Countdown at={upcoming.openAt!.toISOString()} />
                <Link href={`/shop/c/${upcoming.categoryId}`} className="ml-auto flex h-11 items-center rounded-full bg-shop-rose px-3.5 text-[14px] font-bold text-white">先看商品</Link>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3.5 px-4 pt-6">
        <div>
          <SerifTitle>系列專區</SerifTitle>
          <p className="mt-1 text-[13px] text-shop-mute">同一系列的商品都放在同一頁</p>
        </div>
        {cats.length === 0 && <p className="rounded-[18px] border border-shop-line bg-white p-5 text-center text-[14px] text-shop-mute">目前沒有開放訂購的系列，敬請期待！</p>}
        {cats.map((c, i) => {
          const open = isOpen(c, now);
          return (
            <Link key={c.categoryId} href={`/shop/c/${c.categoryId}`} className="flex overflow-hidden rounded-[20px] border border-shop-line bg-white shadow-lift-1">
              <Pic src={c.imageUrl} alt={c.category.name} seed={i + 2} className="min-h-[168px] w-[140px] shrink-0" label="系列圖片" />
              <div className="flex flex-1 flex-col gap-1 p-4">
                <div className="font-serif text-[20px] font-bold leading-snug">{c.category.name}</div>
                <div className="text-[13px] text-shop-mute">{c.count} 件商品</div>
                <div className="mt-1">{open ? <Tag tone="good">販售中</Tag> : <Tag>{taipeiDayLabel(c.openAt!)} {taipeiParts(c.openAt!).time} 開賣</Tag>}</div>
                <span className="mt-auto self-start rounded-full bg-shop-ink px-4 py-2 text-[13px] font-bold text-white">進入系列</span>
              </div>
            </Link>
          );
        })}
      </section>

      {groups.length > 0 && (
        <section className="flex flex-col gap-3.5 px-4 pt-7">
          <div>
            <SerifTitle>新品推薦</SerifTitle>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {groups.map(({ g, c }, i) => (
              <TypeCard key={`${c.categoryId}-${g.typeId}`} g={g} seed={i} href={`/shop/c/${c.categoryId}/t/${encodeURIComponent(g.typeId)}`} />
            ))}
          </div>
        </section>
      )}

      <footer className="px-4 pt-10 pb-4 text-center text-[12px] text-shop-mute">
        <div>
          <Link href="/shop/orders" className="underline">我的訂單，查詢訂單</Link>
          {customer && (
            <>
              　·　<a href="/shop/logout" className="underline">登出</a>
            </>
          )}
        </div>
        <div className="mt-2">
          <Link href="/shop/rules" className="underline">交易規則</Link>　·　<Link href="/shop/privacy" className="underline">隱私權政策</Link>
        </div>
        {!customer && <p className="mt-2">不用註冊，訪客也能下單；用 LINE 登入的話訂單會傳到 LINE 聊天室</p>}
      </footer>
      <CartBar />
    </>
  );
}
