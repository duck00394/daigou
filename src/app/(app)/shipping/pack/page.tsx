import { notFound } from "next/navigation";
import { prisma, tx } from "@/server/db";
import { shipPlan } from "@/server/services/order-flow";
import { requireUser } from "@/server/auth";
import { PrintButton } from "./print";
import { fmtDate } from "@/lib/labels";

export const metadata = { title: "包貨核對清單" };

/** 依買家產生可列印的包貨核對清單（含收件資料，僅供包貨使用） */
export default async function PackList({ searchParams }: { searchParams: Promise<{ buyerId?: string }> }) {
  await requireUser();
  const { buyerId } = await searchParams;
  if (!buyerId) notFound();
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId } });
  if (!buyer) notFound();
  const items = await prisma.orderItem.findMany({
    where: { order: { buyerId, confirmation: "CONFIRMED" }, shipStatusCache: { notIn: ["SHIPPED", "DELIVERED", "CANCELLED"] } },
    include: { order: { select: { orderNo: true } } },
    orderBy: [{ order: { orderedAt: "asc" } }, { createdAt: "asc" }],
  });
  // 可出＝出貨排程算的（跟出貨頁「可出」同一個數字：已保留＋排給這一項的可用庫存）
  const plan = await tx((t) => shipPlan(t));
  const canShip = new Map(plan.items.map((x) => [x.id, x.shippable]));
  return (
    <div className="light-page mx-auto max-w-2xl bg-card p-6 text-ink">
      <div className="no-print mb-4 flex justify-end"><PrintButton /></div>
      <h1 className="text-xl font-semibold">包貨核對清單｜{buyer.name}</h1>
      <p className="text-sm text-mute">{buyer.code}｜列印時間 {fmtDate(new Date(), true)}</p>
      {(buyer.recipientName || buyer.address) && (
        <p className="mt-2 text-sm">收件：{[buyer.recipientName, buyer.recipientPhone, buyer.shippingMethod, buyer.address].filter(Boolean).join("｜")}</p>
      )}
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-left">
            <th className="py-1.5">核對</th>
            <th>商品</th>
            <th>訂單</th>
            <th className="text-right">可出</th>
            <th className="text-right">還差</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const pending = i.qty - i.cancelledQtyCache - i.shippedQtyCache;
            const can = Math.min(pending, canShip.get(i.id) ?? 0);
            return (
              <tr key={i.id} className="border-b border-line">
                <td className="py-2"><span className="inline-block h-4 w-4 border border-ink" aria-hidden /></td>
                <td>{i.productNameSnapshot}{i.specNote ? `（${i.specNote}）` : ""}</td>
                <td className="num">{i.order.orderNo}</td>
                <td className="num text-right font-semibold" data-k="can">{can}</td>
                <td className="num text-right" data-k="short">{pending - can}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {items.length === 0 && <p className="mt-4 text-sm text-mute">沒有待出貨商品。</p>}
    </div>
  );
}
