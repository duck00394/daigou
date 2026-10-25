import { prisma } from "@/server/db";
import { Term } from "@/components/help";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { seriesOptions } from "@/server/services/catalog-tree";
import { SellForm } from "./form";

export const metadata = { title: "賣給客人" };

export default async function SellPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [series, buyers, lastOrder, usedChannels] = await Promise.all([
    seriesOptions(prisma),
    prisma.buyer.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 300, select: { name: true, salesChannel: true } }),
    prisma.orderItem.findFirst({ where: { categoryId: { not: null } }, orderBy: { createdAt: "desc" }, select: { categoryId: true } }),
    prisma.order.groupBy({ by: ["salesChannel"], where: { salesChannel: { not: null } }, _count: true, orderBy: { _count: { salesChannel: "desc" } }, take: 20 }),
  ]);
  // 預訂還沒給的件數
  const open = await prisma.orderItem.findMany({ where: { order: { source: { not: "QUICK" }, confirmation: "CONFIRMED" } }, select: { qty: true, cancelledQtyCache: true, shippedQtyCache: true } });
  const waiting = open.reduce((s, i) => s + Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache), 0);
  const initial = sp.cat ?? (series.find((s) => s.id === lastOrder?.categoryId && s.active)?.id ?? "");
  return (
    <div className="space-y-4">
      <PageHeader title="賣給客人" sub="選系列，填每個角色的數量；超過現貨的自動記成預訂，到貨再給。" help={<><Term name="現貨" tone="good">手上有的直接賣掉，算進「賺多少」</Term><Term name="預訂" tone="info">沒貨的先記成客人預訂，到貨後在「出貨」給客人</Term><div className="mt-1">單價會帶這系列設好的售價；客人名字、平台記一次，下次自動帶。</div></>} />
      <SellForm series={series} buyers={buyers.map((b) => b.name).filter((n) => n !== "散客")} initialCategory={initial} waiting={waiting} channels={usedChannels.map((c) => c.salesChannel!).filter(Boolean)} buyerChannels={Object.fromEntries(buyers.filter((b) => b.salesChannel).map((b) => [b.name, b.salesChannel!]))} />
    </div>
  );
}
