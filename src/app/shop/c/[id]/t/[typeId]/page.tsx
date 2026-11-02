import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { currentCustomer } from "@/server/shop-auth";
import { isOpen, shopProducts, soldMap } from "@/server/services/shop";
import { taipeiDayLabel, taipeiParts } from "@/lib/taipei";
import { CartButton, Pic } from "../../../../cart";
import { BackCircle, Eyebrow, groupTypes, Tag } from "../../../../ui";
import { Picker } from "./picker";

export default async function TypePage({ params }: { params: Promise<{ id: string; typeId: string }> }) {
  const { id, typeId: raw } = await params;
  const typeId = decodeURIComponent(raw);
  const s = await prisma.shopCategory.findUnique({ where: { categoryId: id }, include: { category: true } });
  if (!s || !s.enabled || !s.category.active) notFound();
  const g = groupTypes(await shopProducts(prisma, id)).find((x) => x.typeId === typeId);
  if (!g) notFound();
  const customer = await currentCustomer();
  const mine = customer ? await soldMap(prisma, id, g.products.map((p) => p.productId), customer.id) : new Map<string, number>();
  const waits = customer ? await prisma.shopWait.findMany({ where: { buyerId: customer.id, categoryId: id, productId: { in: g.products.map((p) => p.productId) }, status: "WAITING" }, select: { productId: true } }) : [];
  const open = isOpen(s);
  const prices = [...new Set(g.products.map((p) => p.price).filter((p): p is number => p !== null))];
  const next = `/shop/c/${id}/t/${encodeURIComponent(typeId)}`;

  return (
    <>
      <div className="relative h-[340px]">
        <Pic src={g.image} alt={g.typeName} seed={0} className="absolute inset-0 h-full w-full" label="商品圖片" />
        <div className="absolute inset-x-4 top-3 flex justify-between">
          <BackCircle href={`/shop/c/${id}`} label={`回到${s.category.name}`} />
          <CartButton />
        </div>
      </div>
      <div className="relative -mt-9 flex flex-col gap-4 rounded-t-[28px] bg-shop-bg px-4 pt-[22px]">
        <div className="flex flex-col gap-1.5">
          <Eyebrow rose>{s.category.name}</Eyebrow>
          <h1 className="font-serif text-[26px] leading-snug font-bold">{g.typeName}</h1>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-[24px] font-bold text-shop-rose">{prices.length === 0 ? "價格待定" : prices.length === 1 ? `NT$ ${prices[0].toLocaleString("en-US")}` : `NT$ ${Math.min(...prices).toLocaleString("en-US")} 起`}</span>
            <span className="text-[13px] text-shop-mute">{g.products.length > 1 && prices.length === 1 ? "每款同價" : ""}{s.perPersonLimit ? `${g.products.length > 1 && prices.length === 1 ? "・" : ""}每款限購 ${s.perPersonLimit} 個` : ""}</span>
          </div>
          {!open && s.openAt && <div><Tag>{taipeiDayLabel(s.openAt)} {taipeiParts(s.openAt).time} 開賣・可以先放購物車</Tag></div>}
        </div>
        <Picker
          categoryId={id}
          catName={s.category.name}
          open={open}
          loggedIn={!!customer}
          loginHref={`/shop/login?next=${encodeURIComponent(next)}`}
          limit={s.perPersonLimit}
          rows={g.products.map((p, i) => ({
            productId: p.productId,
            name: p.name,
            label: p.character || p.typeName,
            image: p.imageUrl,
            price: p.price,
            left: p.left,
            waiting: p.waiting,
            mine: mine.get(p.productId) ?? 0,
            inWait: waits.some((w) => w.productId === p.productId),
            seed: i,
          }))}
        />
        {s.intro && (
          <div className="flex flex-col gap-2">
            <div className="text-[16px] font-bold">說明</div>
            <p className="text-[14px] leading-[1.8] whitespace-pre-line text-shop-ink-2">{s.intro}</p>
          </div>
        )}
      </div>
    </>
  );
}
