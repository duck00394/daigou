import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { isOpen, shopProducts } from "@/server/services/shop";
import { taipeiDayLabel, taipeiParts } from "@/lib/taipei";
import { CartBar, CartButton, Countdown, Pic } from "../../cart";
import { BackCircle, groupTypes, SerifTitle, Tag, TypeCard } from "../../ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.category.findUnique({ where: { id }, select: { name: true } });
  return { title: c?.name ?? "系列" };
}

export default async function SeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await prisma.shopCategory.findUnique({ where: { categoryId: id }, include: { category: true } });
  if (!s || !s.enabled || !s.category.active) notFound();
  const groups = groupTypes(await shopProducts(prisma, id));
  const open = isOpen(s);

  return (
    <>
      <div className={`relative ${s.imageUrl ? "pt-[68px]" : "h-[300px]"}`}>
        {s.imageUrl ? <Pic src={s.imageUrl} alt={s.category.name} fit="natural" /> : <Pic src={null} alt={s.category.name} seed={1} className="absolute inset-0 h-full w-full" label="" />}
        <div className="absolute inset-x-4 top-3 flex justify-between">
          <BackCircle href="/shop" label="回到全部系列" />
          <CartButton />
        </div>
      </div>
      <div className={`relative mx-4 ${s.imageUrl ? "mt-3" : "-mt-16"} flex flex-col gap-2.5 rounded-[22px] bg-white p-[18px] shadow-lift-8`}>
        <SerifTitle size={26}>{s.category.name}</SerifTitle>
        <div className="flex flex-wrap gap-1.5">
          {open ? <Tag tone="good">販售中</Tag> : <Tag>{taipeiDayLabel(s.openAt!)} {taipeiParts(s.openAt!).time} 開賣</Tag>}
          {s.perPersonLimit && <Tag tone="plain">每款限購 {s.perPersonLimit} 個</Tag>}
        </div>
        {s.intro && <p className="text-[13px] leading-relaxed whitespace-pre-line text-shop-ink-2">{s.intro}</p>}
        {!open && s.openAt && (
          <div className="flex items-center gap-2 border-t border-dashed border-tone-orange-200 pt-3">
            <span className="text-[13px] text-shop-mute">距離開賣</span>
            <Countdown at={s.openAt.toISOString()} compact />
          </div>
        )}
      </div>

      <div className="flex items-end justify-between px-4 pt-6">
        <div>
          <SerifTitle size={22}>選擇品項</SerifTitle>
        </div>
        <span className="text-[13px] text-shop-mute">{groups.length} 個品項</span>
      </div>
      {groups.length === 0 ? (
        <p className="m-4 rounded-[18px] border border-shop-line bg-white p-5 text-center text-[14px] text-shop-mute">商品準備中，請稍後再來看看</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-4 pt-3.5">
          {groups.map((g, i) => (
            <TypeCard key={g.typeId} g={g} seed={i} href={`/shop/c/${id}/t/${encodeURIComponent(g.typeId)}`} />
          ))}
        </div>
      )}
      <p className="px-4 pt-4 text-[12px] leading-relaxed text-shop-mute">{open ? "名額依送出訂單的先後順序，放在購物車不會保留。" : "開賣前可以先放購物車，時間到才能送出。名額依送出訂單的先後順序。"}</p>
      <CartBar />
    </>
  );
}
