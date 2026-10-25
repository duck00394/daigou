// 首頁：只放「今天要做的事」——兩顆大按鈕、三個數字、一張待辦清單（按了直接到篩好的地方）、下一場搶購
import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getView, inView, viewBatchWhere } from "@/server/view";
import { dashboard } from "@/server/services/reports";
import { listQuickSales } from "@/server/services/quick-sale";
import { batchPaySummary, refundsOwed } from "@/server/services/batch-ops";
import { unsettledJoint } from "@/server/services/joint";
import { preorderProfit } from "@/server/services/preorder";
import { reconcileList } from "@/server/services/reconcile";
import { getOrdersEnabled } from "@/server/services/settings";
import { formatTwd } from "@/lib/money";
import { PushStatusChip } from "@/components/push-setup";
import { vapidPublicKey } from "@/server/push";
import { relativeDay, taipeiParts } from "@/lib/taipei";

export const metadata = { title: "首頁" };

export default async function Home() {
  await requireUser();
  const vk = (await getView()).key;
  const monthStart = (() => {
    const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1, -8));
  })();
  const usesOrders = await getOrdersEnabled(prisma);
  const [d, sales, unpaidSales, live, refunds, rec, overdue, rush] = await Promise.all([
    dashboard(prisma),
    tx((t) => listQuickSales(t, { from: monthStart })),
    prisma.order.aggregate({ where: { source: "QUICK", confirmation: "CONFIRMED", balanceCache: { gt: 0 } }, _count: true }),
    prisma.purchaseBatch.findMany({ where: { status: { not: "CANCELLED" }, ...viewBatchWhere(vk) }, select: { id: true } }),
    tx((t) => refundsOwed(t)).then((l) => l.filter((r) => inView(vk, r))),
    tx((t) => reconcileList(t, { view: vk })),
    prisma.purchaseBatch.count({ where: { status: { in: ["ORDERED", "PARTIAL_RECEIVED"] }, expectedAt: { lt: new Date() }, ...viewBatchWhere(vk) } }),
    prisma.rushEvent.findFirst({ where: { status: "UPCOMING", startAt: { gte: new Date(Date.now() - 30 * 60000) } }, orderBy: { startAt: "asc" } }),
  ]);
  const pay = await tx((t) => batchPaySummary(t, live.map((b) => b.id)));
  const pre = await tx((t) => preorderProfit(t));
  const liveIds = new Set(live.map((b) => b.id));
  const unsettled = (await tx((t) => unsettledJoint(t))).filter((x) => liveIds.has(x.id));
  const dueBatches = [...pay.values()].filter((p) => p.dueTwd > 0);
  const dueTotal = dueBatches.reduce((s, p) => s + p.dueTwd, 0);
  const refundTotal = refunds.reduce((s, r) => s + r.owed, 0);
  const m = vk === "all" ? sales.total : (() => { const x = sales.byOwner[vk] ?? { qty: 0, revenue: 0, cost: 0 }; return { profit: x.revenue - x.cost }; })();

  const todo = [
    { n: rec.todo.length, text: "團還沒對單", href: "/reconcile?open=todo" },
    { n: refunds.length, text: "團被砍單、代購還沒退錢", href: "/reconcile?open=refund" },
    { n: dueBatches.length, text: "團還沒付清", href: "/inventory?tab=batches&open=0&pay=due" },
    { n: unsettled.length, text: "團合資還沒結清", href: unsettled.length === 1 ? `/inventory/batches/${unsettled[0].id}` : "/inventory?tab=batches&settle=1" },
    { n: overdue, text: "團超過預計到貨日", href: "/inventory?tab=batches&late=1" },
    { n: d.toShipQty, text: "件客人預訂到貨了，還沒給", href: "/shipping" },
    { n: unpaidSales._count, text: "筆賣出還沒收到錢", href: "/sales" },
    ...(usesOrders
      ? [
          { n: d.pendingConfirm, text: "張訂單待確認", href: "/orders?status=PENDING_CONFIRM" },
          { n: d.unpaidOrders, text: "張訂單還沒收款", href: "/payments" },
          { n: d.refundPending + d.refundUnscheduled, text: "筆退款要處理", href: "/payments?tab=refunds" },
          { n: d.needProducts, text: "項商品客人訂了還沒買", href: "/inventory?tab=demand" },
        ]
      : []),
  ].filter((x) => x.n > 0);

  const stat = (label: string, value: number, href: string, tone: "bad" | "good" | "plain", testid: string) => (
    <Link href={href} className="block rounded-xl border border-line bg-card px-2.5 py-2 hover:border-ai">
      <div className="text-[12px] text-mute">{label}</div>
      <div className={`num text-[18px] font-semibold ${tone === "bad" && value ? "text-bad" : tone === "good" ? (value < 0 ? "text-bad" : "text-good") : ""}`} data-testid={testid}>{formatTwd(value)}</div>
    </Link>
  );

  return (
    <div className="space-y-4">
      <h1 className="sr-only">首頁</h1>
      <div className="grid grid-cols-2 gap-2" data-tour="home-actions">
        <Link href="/purchase" className="rounded-xl bg-ai px-3 py-3.5 text-center text-[17px] font-semibold text-white hover:bg-ai-2">＋ 新增採購</Link>
        <Link href="/sell" className="rounded-xl border border-line bg-white px-3 py-3.5 text-center text-[17px] font-semibold hover:border-ai">賣給客人</Link>
      </div>
      <div className="grid grid-cols-2 gap-2" data-tour="home-stats">
        {stat("還要付代購", dueTotal, "/inventory?tab=batches&open=0&pay=due", "bad", "home-due")}
        {stat("代購要退", refundTotal, "/reconcile?open=refund", "bad", "home-refund")}
        {stat("本月賺", m.profit, "/sales", "good", "home-profit")}
        {stat("預訂預估可賺", pre.profit, "/sales#preorder", "good", "home-preorder")}
      </div>

      <section aria-label="要處理的事">
        <h2 className="mb-1.5 text-[14px] font-semibold text-ink-2">要處理的事</h2>
        {todo.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-4 py-4 text-center text-[14px] text-good" data-testid="home-todo-empty">都處理好了</p>
        ) : (
          <ul className="divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-card" data-testid="home-todo" data-tour="home-todo">
            {todo.map((t) => (
              <li key={t.href + t.text}>
                <Link href={t.href} className="flex items-center gap-3 px-3 py-3 hover:bg-[#fafbfd]">
                  <span className="num min-w-8 rounded-md bg-peach px-1.5 text-center font-semibold text-peach-ink">{t.n}</span>
                  <span className="flex-1 text-[15px]">{t.text}</span>
                  <span aria-hidden className="text-mute">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2.5" aria-label="搶購提醒" data-testid="home-rush">
        <Link href={rush ? `/rush/${rush.id}` : "/rush"} className="min-w-0 flex-1 truncate text-[14px]">
          {rush ? <>下一場搶購　{relativeDay(rush.startAt).split(" ")[0]} {taipeiParts(rush.startAt).time}　{rush.supplierName}</> : <span className="text-mute">接下來沒有搶購，按這裡新增</span>}
        </Link>
        <PushStatusChip vapidKey={vapidPublicKey()} />
      </section>
    </div>
  );
}
