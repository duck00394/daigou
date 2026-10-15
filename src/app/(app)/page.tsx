import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { dashboard, stockValuation, unrealizedEstimate } from "@/server/services/reports";
import { inventorySummary } from "@/server/services/inventory";
import { listQuickSales } from "@/server/services/quick-sale";
import { Section, Stat, Twd, Empty, StatusBadge } from "@/components/ui";
import { batchStatus, fmtDate, fmtDay } from "@/lib/labels";

export const metadata = { title: "首頁" };

const QUICK = [
  { href: "/paste", label: "貼上加單", main: true },
  { href: "/inventory/batches/new", label: "新增採購團", main: true },
  { href: "/inventory?tab=batches", label: "登記收貨／採購團" },
  { href: "/orders/new", label: "新增訂單" },
  { href: "/payments", label: "待收款" },
  { href: "/shipping", label: "待出貨" },
  { href: "/inventory?tab=stock", label: "庫存與自留" },
  { href: "/sales?new=1", label: "出售現貨" },
];

export default async function Home() {
  await requireUser();
  const monthStart = (() => {
    const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1, -8));
  })();
  const [d, un, val, inv, sales, unpaidSales] = await Promise.all([
    dashboard(prisma),
    unrealizedEstimate(prisma),
    stockValuation(prisma),
    tx((t) => inventorySummary(t)),
    tx((t) => listQuickSales(t, { from: monthStart })),
    prisma.order.aggregate({ where: { source: "QUICK", confirmation: "CONFIRMED", balanceCache: { gt: 0 } }, _sum: { balanceCache: true }, _count: true }),
  ]);
  const [overdue, openBatches] = await Promise.all([
    prisma.purchaseBatch.count({ where: { status: { in: ["ORDERED", "PARTIAL_RECEIVED"] }, expectedAt: { lt: new Date() } } }),
    prisma.purchaseBatch.count({ where: { status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } } }),
  ]);
  const incoming = [...inv.values()].reduce((s, v) => s + v.incoming, 0);
  const today = new Date();
  const todo = [
    { n: d.pendingConfirm, text: "張訂單待確認", href: "/orders?status=PENDING_CONFIRM" },
    { n: d.unpaidOrders, text: "張訂單尚有待收款", href: "/payments" },
    { n: d.toShipBuyers, text: `位買家有已到貨待出貨商品（共 ${d.toShipQty} 件）`, href: "/shipping" },
    { n: d.refundPending, text: "筆退款待執行", href: "/payments?tab=refunds" },
    { n: d.refundUnscheduled, text: "張訂單溢收、尚未建立退款", href: "/payments?tab=refunds" },
    { n: d.needProducts, text: "項商品有待下單需求", href: "/inventory?tab=demand" },
    { n: overdue, text: "個採購團已超過預計到貨日", href: "/inventory?tab=batches" },
  ].filter((x) => x.n > 0);

  return (
    <div className="space-y-5">
      <h1 className="sr-only">首頁</h1>
      <nav aria-label="快捷入口" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {QUICK.map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className={`rounded-xl border px-3 py-3 text-[15px] font-medium ${q.main ? "border-ai bg-ai text-white hover:bg-ai-2" : "border-line bg-white hover:border-ai"}`}
          >
            {q.label}
          </Link>
        ))}
      </nav>

      <div>
        <h2 className="mb-2 text-[15px] font-semibold">我的庫存</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="可售" value={`${val.total.free} 件`} note={`成本 ${val.total.freeValue.toLocaleString()} 元${val.total.tentative ? "（含暫估）" : ""}`} href="/inventory?tab=stock" />
          <Stat label="自留收藏" value={`${val.total.kept} 件`} note={`成本 ${val.total.keptValue.toLocaleString()} 元`} href="/inventory?tab=stock" />
          <Stat label="待到貨" value={`${incoming} 件`} note={`${openBatches} 個採購團進行中`} href="/inventory?tab=batches" />
          <Stat label="已保留給買家" value={`${val.total.reserved} 件`} note="待出貨" href="/shipping" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="本月現貨出售" value={`${sales.total.qty} 件`} note={`收入 ${sales.total.revenue.toLocaleString()} 元`} href="/sales" />
          <Stat label="本月出售毛利" value={<Twd v={sales.total.profit} />} note={sales.total.tentative ? "成本含暫估" : "收入 − 商品成本"} href="/sales" tone={sales.total.profit < 0 ? "bad" : undefined} />
          {(unpaidSales._sum.balanceCache ?? 0) > 0 && <Stat label="出售未收款" value={<Twd v={unpaidSales._sum.balanceCache ?? 0} />} note={`${unpaidSales._count} 筆`} href="/payments" tone="warn" />}
          {val.total.unknownCostUnits > 0 && <Stat label="沒有成本的庫存" value={`${val.total.unknownCostUnits} 件`} note="手動入庫未填成本" href="/inventory?tab=stock" tone="warn" />}
        </div>
      </div>

      <Section title="今日待辦" pad={false}>
        {todo.length === 0 ? (
          <Empty>目前沒有待處理的事項。</Empty>
        ) : (
          <ul className="divide-y divide-line-2">
            {todo.map((t) => (
              <li key={t.href + t.text}>
                <Link href={t.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#fafbfd]">
                  <span className="num min-w-8 rounded-md bg-peach px-1.5 text-center font-semibold text-peach-ink">{t.n}</span>
                  <span className="text-[15px]">{t.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div>
        <h2 className="mb-2 text-[15px] font-semibold">本月（{d.ym}）</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="已實現營收" value={<Twd v={d.month.revenue} />} note="依出貨認列，含運費收入" href="/reports" />
          <Stat label="已實現利潤" value={<Twd v={d.month.realizedProfit} />} note={d.month.estimatedCostUnits > 0 ? `${d.month.estimatedCostUnits} 件以預估成本計` : "營收 − 銷貨成本 − 其他費用"} href="/reports" />
          <Stat label="本月收款" value={<Twd v={d.month.cashIn} />} note={`退款 ${d.month.cashOut.toLocaleString()} 元`} />
          <Stat label="本月新訂單金額" value={<Twd v={d.month.bookedSales} />} note="已確認訂單的應收" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="待收款" value={<Twd v={d.snap.balance} />} href="/payments" tone={d.snap.balance > 0 ? "warn" : undefined} />
        <Stat label="待退款" value={<Twd v={d.snap.refundDue} />} note={d.snap.refundPending > 0 ? `其中 ${d.snap.refundPending.toLocaleString()} 元處理中` : undefined} href="/payments?tab=refunds" tone={d.snap.refundDue > 0 ? "bad" : undefined} />
        <Stat label="待出貨件數" value={d.toShipQty} href="/shipping" />
        <Stat label="預估未實現利潤" value={<Twd v={un.profit} />} note={un.unknownCostUnits > 0 ? `${un.unknownCostUnits} 件沒有預估成本` : "未出貨部分，以預估成本計"} href="/reports" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="即將截止的代購團" pad={false} actions={<Link href="/groupbuys" className="text-sm text-ai">全部</Link>}>
          {d.closingGroupBuys.length === 0 ? (
            <Empty>7 天內沒有截止的代購團。</Empty>
          ) : (
            <ul className="divide-y divide-line-2 text-sm">
              {d.closingGroupBuys.map((g) => (
                <li key={g.id} className="flex justify-between gap-2 px-4 py-2">
                  <Link href={`/orders?groupBuyId=${g.id}`} className="truncate hover:underline">
                    {g.name}
                  </Link>
                  <span className="num shrink-0 text-mute">{fmtDate(g.closeAt, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="待到貨的採購團" pad={false} actions={<Link href="/inventory?tab=batches" className="text-sm text-ai">全部</Link>}>
          {d.incomingBatches.length === 0 ? (
            <Empty>沒有待到貨的批次。</Empty>
          ) : (
            <ul className="divide-y divide-line-2 text-sm">
              {d.incomingBatches.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <Link href={`/inventory/batches/${b.id}`} className="min-w-0 truncate hover:underline">
                    {b.code} {b.name}
                    {b.expectedAt && <span className={`ml-1 text-[12px] ${b.expectedAt < today ? "text-bad" : "text-mute"}`}>預計 {fmtDay(b.expectedAt)}{b.expectedAt < today ? "・已逾期" : ""}</span>}
                  </Link>
                  <StatusBadge map={batchStatus} value={b.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="近期預計到貨的商品" pad={false}>
          {d.upcomingProducts.length === 0 ? (
            <Empty>14 天內沒有預計到貨的商品。</Empty>
          ) : (
            <ul className="divide-y divide-line-2 text-sm">
              {d.upcomingProducts.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 px-4 py-2">
                  <Link href={`/products/${p.id}`} className="truncate hover:underline">
                    {p.name}
                  </Link>
                  <span className="num shrink-0 text-mute">{fmtDay(p.expectedArrivalDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
