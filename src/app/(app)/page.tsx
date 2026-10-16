import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { dashboard, stockValuation, unrealizedEstimate } from "@/server/services/reports";
import { inventorySummary } from "@/server/services/inventory";
import { listQuickSales } from "@/server/services/quick-sale";
import { Section, Stat, Twd, Empty, StatusBadge, Badge } from "@/components/ui";
import { batchStage, batchStageLabel, batchStatus, fmtDate, fmtDay } from "@/lib/labels";
import { batchPaySummary, dueByOwner } from "@/server/services/batch-ops";
import { OwnerDue } from "@/components/owner-due";
import { listOperators } from "@/server/services/operators";
import { getOrdersEnabled } from "@/server/services/settings";
import { formatTwd } from "@/lib/money";

export const metadata = { title: "首頁" };

// 首頁快捷：最常做的四件事，第一次用也看得懂
const QUICK = [
  { href: "/purchase", label: "＋ 新增採購", hint: "買了什麼、哪一團", main: true },
  { href: "/sales?new=1", label: "出售現貨", hint: "賣掉手上的東西", main: true },
  { href: "/inventory?tab=batches", label: "收到貨了", hint: "到哪一團登記" },
  { href: "/inventory?tab=stock", label: "庫存・自留", hint: "手上有什麼、成本" },
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
  // 還要付代購：所有沒取消的團，總額 − 已付
  const live = await prisma.purchaseBatch.findMany({
    where: { status: { not: "CANCELLED" } },
    select: { id: true, code: true, name: true, status: true, progress: true, ownership: true, orderedBy: { select: { name: true } } },
  });
  const pay = await tx((t) => batchPaySummary(t, live.map((b) => b.id)));
  const dueList = live
    .map((b) => ({ ...b, due: pay.get(b.id)?.dueTwd ?? 0 }))
    .filter((b) => b.due > 0)
    .sort((a, b) => b.due - a.due);
  const dueTotal = dueList.reduce((s, b) => s + b.due, 0);
  // 有在用「接單」（訂單／買家）才顯示訂單相關數字
  const usesOrders = await getOrdersEnabled(prisma);
  const [ops, due] = await Promise.all([tx((t) => listOperators(t)), tx((t) => dueByOwner(t))]);
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
            className={`rounded-xl border px-3.5 py-3 ${q.main ? "border-ai bg-ai text-white hover:bg-ai-2" : "border-line bg-white hover:border-ai"}`}
          >
            <span className="block text-[16px] font-semibold">{q.label}</span>
            <span className={`block text-[12px] ${q.main ? "text-white/80" : "text-mute"}`}>{q.hint}</span>
          </Link>
        ))}
      </nav>

      <OwnerDue due={due} operators={ops.map((o) => ({ id: o.id, name: o.name }))} hrefFor={(k) => `/inventory?tab=batches&open=0${k === "none" ? "" : `&owner=${k}`}`} />

      <div>
        <h2 className="mb-2 text-[15px] font-semibold">錢與庫存</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="還要付代購" value={<span data-testid="home-due" className={dueTotal ? "text-bad" : ""}>{formatTwd(dueTotal)}</span>} note={dueTotal ? `${dueList.length} 團還沒付清` : "都付清了"} href="#due" tone={dueTotal ? "bad" : undefined} />
          <Stat label="手上庫存成本" value={<Twd v={val.total.freeValue + val.total.keptValue} />} note={`可賣 ${val.total.free} 件・自留 ${val.total.kept} 件${val.total.tentative ? "（有價格還沒確定）" : ""}`} href="/inventory?tab=stock" />
          <Stat label="本月賣出賺" value={<Twd v={sales.total.profit} />} note={`賣 ${sales.total.qty} 件・收入 ${sales.total.revenue.toLocaleString()} 元`} href="/sales" tone={sales.total.profit < 0 ? "bad" : undefined} />
          <Stat label="還沒到的貨" value={`${incoming} 件`} note={`${openBatches} 團還在路上`} href="/inventory?tab=batches" />
          {(unpaidSales._sum.balanceCache ?? 0) > 0 && <Stat label="賣出還沒收到錢" value={<Twd v={unpaidSales._sum.balanceCache ?? 0} />} note={`${unpaidSales._count} 筆`} href="/sales" tone="warn" />}
          {val.total.unknownCostUnits > 0 && <Stat label="沒填成本的庫存" value={`${val.total.unknownCostUnits} 件`} note="手動入庫未填成本" href="/inventory?tab=stock" tone="warn" />}
          {usesOrders && val.total.reserved > 0 && <Stat label="留給買家" value={`${val.total.reserved} 件`} note="待出貨" href="/shipping" />}
        </div>
      </div>

      {dueList.length > 0 && (
        <Section title="還要付的團" pad={false}>
          <ul id="due" className="divide-y divide-line-2" aria-label="還要付的團">
            {dueList.slice(0, 8).map((b) => {
              const [label, tone] = batchStageLabel[batchStage(b)];
              return (
                <li key={b.id}>
                  <Link href={`/inventory/batches/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#fafbfd]">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{b.name}</span>
                      <span className="text-[12px] text-mute">{b.ownership === "JOINT" ? "合資" : b.orderedBy ? `${b.orderedBy.name}的` : "未指定"}・<Badge tone={tone}>{label}</Badge></span>
                    </span>
                    <span className="num shrink-0 font-semibold text-bad">{formatTwd(b.due)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {dueList.length > 8 && <p className="px-4 py-2 text-[13px] text-mute">還有 {dueList.length - 8} 團，到「活動總表」看全部。</p>}
        </Section>
      )}

      {todo.length > 0 && (
      <Section title="今日待辦" pad={false}>
        {(
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
      )}

      {usesOrders && (
        <>
      <div>
        <h2 className="mb-2 text-[15px] font-semibold">本月（{d.ym}）</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="收入（已賣出）" value={<Twd v={d.month.revenue} />} note="依出貨認列，含運費收入" href="/reports" />
          <Stat label="賺多少（已賣出）" value={<Twd v={d.month.realizedProfit} />} note={d.month.estimatedCostUnits > 0 ? `${d.month.estimatedCostUnits} 件以預估成本計` : "營收 − 銷貨成本 − 其他費用"} href="/reports" />
          <Stat label="本月收款" value={<Twd v={d.month.cashIn} />} note={`退款 ${d.month.cashOut.toLocaleString()} 元`} />
          <Stat label="本月新訂單金額" value={<Twd v={d.month.bookedSales} />} note="已確認訂單的應收" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="待收款" value={<Twd v={d.snap.balance} />} href="/payments" tone={d.snap.balance > 0 ? "warn" : undefined} />
        <Stat label="待退款" value={<Twd v={d.snap.refundDue} />} note={d.snap.refundPending > 0 ? `其中 ${d.snap.refundPending.toLocaleString()} 元處理中` : undefined} href="/payments?tab=refunds" tone={d.snap.refundDue > 0 ? "bad" : undefined} />
        <Stat label="待出貨件數" value={d.toShipQty} href="/shipping" />
        <Stat label="還沒賣的預估會賺" value={<Twd v={un.profit} />} note={un.unknownCostUnits > 0 ? `${un.unknownCostUnits} 件沒有預估成本` : "未出貨部分，以預估成本計"} href="/reports" />
      </div>

        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {usesOrders && <Section title="即將截止的開團" pad={false} actions={<Link href="/groupbuys" className="text-sm text-ai">全部</Link>}>
          {d.closingGroupBuys.length === 0 ? (
            <Empty>7 天內沒有截止的開團。</Empty>
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
        </Section>}
        {d.incomingBatches.length > 0 && (
        <Section title="還沒到的團" pad={false} actions={<Link href="/inventory?tab=batches" className="text-sm text-ai">全部</Link>}>
          {d.incomingBatches.length === 0 ? (
            <Empty>全部都到了。</Empty>
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
        )}
        {d.upcomingProducts.length > 0 && (
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
        )}
      </div>
    </div>
  );
}
