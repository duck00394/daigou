import Link from "next/link";
import { prisma } from "@/server/db";
import { currentCustomer } from "@/server/shop-auth";
import { getShopName, isOpen, shopCategories, shopProducts } from "@/server/services/shop";
import { taipeiDayLabel, taipeiParts } from "@/lib/taipei";
import { CartBar, Countdown, Pic } from "./cart";
import { Eyebrow, groupTypes, Notice, SerifTitle, ShopHeader, Tag, TypeCard } from "./ui";

export default async function ShopHome({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
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
          <Notice>{sp.err === "line" ? "LINE 登入還沒設定好，請稍後再試或直接私訊我們。" : "LINE 登入沒有成功，請再試一次。"}</Notice>
        </div>
      )}

      {upcoming && (
        <section className="px-4 pt-5">
          <div className="relative h-[300px] overflow-hidden rounded-[24px] shadow-[0_10px_30px_rgba(120,70,60,0.12)]">
            <Pic src={upcoming.imageUrl} alt={upcoming.category.name} seed={1} className="absolute inset-0 h-full w-full" label="" />
            <div className="absolute inset-x-3.5 bottom-3.5 flex flex-col gap-2 rounded-[18px] bg-white/95 p-4">
              <Eyebrow rose>COMING SOON</Eyebrow>
              <SerifTitle>{upcoming.category.name}　開賣倒數</SerifTitle>
              <div className="flex items-center gap-2">
                <Countdown at={upcoming.openAt!.toISOString()} />
                <Link href={`/shop/c/${upcoming.categoryId}`} className="ml-auto flex h-11 items-center rounded-full bg-shop-rose px-3.5 text-[14px] font-bold text-white">先看商品 ›</Link>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3.5 px-4 pt-6">
        <div>
          <Eyebrow>COLLECTIONS</Eyebrow>
          <SerifTitle>系列專區</SerifTitle>
          <p className="mt-1 text-[13px] text-shop-mute">同一系列的商品都放在同一頁</p>
        </div>
        {cats.length === 0 && <p className="rounded-[18px] border border-shop-line bg-white p-5 text-center text-[14px] text-shop-mute">目前沒有開放訂購的系列，敬請期待！</p>}
        {cats.map((c, i) => {
          const open = isOpen(c, now);
          return (
            <Link key={c.categoryId} href={`/shop/c/${c.categoryId}`} className="flex overflow-hidden rounded-[20px] border border-shop-line bg-white shadow-[0_6px_18px_rgba(120,70,60,0.08)]">
              <Pic src={c.imageUrl} alt={c.category.name} seed={i + 2} className="min-h-[168px] w-[140px] shrink-0" label="系列圖片" />
              <div className="flex flex-1 flex-col gap-1 p-4">
                <Eyebrow>COLLECTION</Eyebrow>
                <div className="font-serif text-[20px] font-bold leading-snug">{c.category.name}</div>
                <div className="text-[13px] text-shop-mute">{c.count} 件商品</div>
                <div className="mt-1">{open ? <Tag tone="good">販售中</Tag> : <Tag>{taipeiDayLabel(c.openAt!)} {taipeiParts(c.openAt!).time} 開賣</Tag>}</div>
                <span className="mt-auto self-start rounded-full bg-shop-ink px-4 py-2 text-[13px] font-bold text-white">進入系列 →</span>
              </div>
            </Link>
          );
        })}
      </section>

      {groups.length > 0 && (
        <section className="flex flex-col gap-3.5 px-4 pt-7">
          <div>
            <Eyebrow>NEW ARRIVALS</Eyebrow>
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
        {customer ? (
          <>
            <Link href="/shop/orders" className="underline">我的訂單</Link>　·　<a href="/shop/logout" className="underline">登出</a>
          </>
        ) : (
          "用 LINE 登入就能下單，訂單會傳到 LINE 聊天室"
        )}
      </footer>
      <CartBar />
    </>
  );
}
