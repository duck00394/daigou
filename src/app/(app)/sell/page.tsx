import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { seriesOptions } from "@/server/services/catalog-tree";
import { SellForm } from "./form";

export const metadata = { title: "賣給客人" };

export default async function SellPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [series, buyers, lastOrder] = await Promise.all([
    seriesOptions(prisma),
    prisma.buyer.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 300, select: { name: true } }),
    prisma.orderItem.findFirst({ where: { categoryId: { not: null } }, orderBy: { createdAt: "desc" }, select: { categoryId: true } }),
  ]);
  // 預訂還沒給的件數
  const open = await prisma.orderItem.findMany({ where: { order: { source: { not: "QUICK" }, confirmation: "CONFIRMED" } }, select: { qty: true, cancelledQtyCache: true, shippedQtyCache: true } });
  const waiting = open.reduce((s, i) => s + Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache), 0);
  const initial = sp.cat ?? (series.find((s) => s.id === lastOrder?.categoryId && s.active)?.id ?? "");
  return (
    <div className="space-y-4">
      <PageHeader title="賣給客人" sub="選系列，填每個角色的數量；超過現貨的自動記成預訂，到貨再給。" />
      <SellForm series={series} buyers={buyers.map((b) => b.name).filter((n) => n !== "散客")} initialCategory={initial} waiting={waiting} />
    </div>
  );
}
