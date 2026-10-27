import { prisma } from "@/server/db";
import { getView } from "@/server/view";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { seriesOptions } from "@/server/services/catalog-tree";
import { SellForm } from "./form";
import { listOperators } from "@/server/services/operators";
import { getMe } from "@/server/me";
import { tx } from "@/server/db";

export const metadata = { title: "賣給客人" };

export default async function SellPage({ searchParams }: { searchParams: Promise<{ cat?: string; pick?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [operators, me, view, groupBuys] = await Promise.all([
    tx((t) => listOperators(t)),
    getMe(),
    getView(),
    prisma.groupBuy.findMany({ where: { status: { in: ["DRAFT", "OPEN", "CLOSED"] } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, categoryId: true } }),
  ]);
  const acting = view.key !== "all" ? view.key : me;
  const [series, buyers, lastOrder, usedChannels] = await Promise.all([
    seriesOptions(prisma),
    prisma.buyer.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 300, select: { name: true, salesChannel: true } }),
    prisma.orderItem.findFirst({ where: { categoryId: { not: null } }, orderBy: { createdAt: "desc" }, select: { categoryId: true } }),
    prisma.order.groupBy({ by: ["salesChannel"], where: { salesChannel: { not: null } }, _count: true, orderBy: { _count: { salesChannel: "desc" } }, take: 20 }),
  ]);
  // 預訂還沒給的件數
  const open = await prisma.orderItem.findMany({ where: { order: { source: { not: "QUICK" }, confirmation: "CONFIRMED" } }, select: { qty: true, cancelledQtyCache: true, shippedQtyCache: true } });
  const waiting = open.reduce((s, i) => s + Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache), 0);
  // 從系列頁「勾好直接賣」帶過來的：pick=商品id:件數,商品id:件數
  const initialQty = Object.fromEntries((sp.pick ?? "").split(",").map((x) => x.split(":")).filter(([id, q]) => id && /^\d{1,3}$/.test(q ?? "") && Number(q) > 0).slice(0, 200).map(([id, q]) => [id, q]));
  const initial = sp.cat ?? (series.find((s) => s.id === lastOrder?.categoryId && s.active)?.id ?? "");
  return (
    <div className="space-y-4">
      <PageHeader title="賣給客人" sub="選誰賣的、選系列，填每個角色的數量；超過他現貨的自動記成預訂，到貨再給。" />
      <SellForm series={series} buyers={buyers.map((b) => b.name).filter((n) => n !== "散客")} initialCategory={initial} waiting={waiting} channels={usedChannels.map((c) => c.salesChannel!).filter(Boolean)} buyerChannels={Object.fromEntries(buyers.filter((b) => b.salesChannel).map((b) => [b.name, b.salesChannel!]))} operators={operators.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }))} me={me} acting={acting} groupBuys={groupBuys} initialQty={initialQty} />
    </div>
  );
}
