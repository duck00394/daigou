// 首頁：只放「今天要做的事」——兩顆大按鈕、三個數字、一張待辦清單（按了直接到篩好的地方）、下一場搶購
import Link from "next/link";
import { Icon } from "@/components/icons";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getView, inView, viewBatchWhere } from "@/server/view";
import { dashboard } from "@/server/services/reports";
import { listQuickSales } from "@/server/services/quick-sale";
import { batchPaySummary, refundsOwed } from "@/server/services/batch-ops";
import { unsettledJoint } from "@/server/services/joint";
import { preorderProfit } from "@/server/services/preorder";
import { reconcileList } from "@/server/services/reconcile";
import { shortProducts } from "@/server/services/stock-left";
import { readyToShip } from "@/server/services/order-flow";
import { getOrdersEnabled } from "@/server/services/settings";
import { formatTwd } from "@/lib/money";
import { PushStatusChip } from "@/components/push-setup";
import { vapidPublicKey } from "@/server/push";
import { relativeDay, taipeiParts } from "@/lib/taipei";
import { BulkShip } from "./orders/bulk";
import { listShippingMethods } from "@/server/services/shipping-methods";

export const metadata = { title: "首頁" };

export default async function Home() {
  await requireUser();
  const vk = (await getView()).key;
  const monthStart = (() => {
    const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1, -8));
  })();
  const usesOrders = await getOrdersEnabled(prisma);
  const [d, sales, unpaidSales, live, refunds, rec, overdue, rush, transit, ready] = await Promise.all([
    dashboard(prisma, { owner: vk === "all" ? null : vk }),
    tx((t) => listQuickSales(t, { from: monthStart })),
    prisma.order.aggregate({ where: { source: "QUICK", confirmation: "CONFIRMED", balanceCache: { gt: 0 }, ...(vk === "all" ? {} : { items: { some: { ownerKey: { in: [vk, "joint", "none"] } } } }) }, _count: true }),
    prisma.purchaseBatch.findMany({ where: { status: { not: "CANCELLED" }, ...viewBatchWhere(vk) }, select: { id: true } }),
    tx((t) => refundsOwed(t)).then((l) => l.filter((r) => inView(vk, r))),
    tx((t) => reconcileList(t, { view: vk })),
    prisma.purchaseBatch.count({ where: { status: { in: ["ORDERED", "PARTIAL_RECEIVED"] }, expectedAt: { lt: new Date() }, ...viewBatchWhere(vk) } }),
    prisma.rushEvent.findFirst({ where: { status: "UPCOMING", startAt: { gte: new Date(Date.now() - 30 * 60000) } }, orderBy: { startAt: "asc" } }),
    // 代購寄出了、還沒登記收到（超過預計到貨日的另外算，不重複）
    prisma.purchaseBatch.count({ where: { status: { in: ["ORDERED", "PARTIAL_RECEIVED"] }, progress: "SHIPPED", OR: [{ expectedAt: null }, { expectedAt: { gte: new Date() } }], ...viewBatchWhere(vk) } }),
    tx((t) => readyToShip(t, { owner: vk === "all" ? null : vk })),
  ]);
  const pay = await tx((t) => batchPaySummary(t, live.map((b) => b.id)));
  const pre = await tx((t) => preorderProfit(t, { owner: vk === "all" ? null : vk }));
  // 客人訂的比庫存多：跟庫存頁「庫存」欄同一套算法
  const short = await tx((t) => shortProducts(t, vk === "all" ? null : vk));
  const liveIds = new Set(live.map((b) => b.id));
  const unsettled = (await tx((t) => unsettledJoint(t))).filter((x) => liveIds.has(x.id));
  const dueBatches = [...pay.values()].filter((p) => p.dueTwd > 0);
  const dueTotal = dueBatches.reduce((s, p) => s + p.dueTwd, 0);
  const refundTotal = refunds.reduce((s, r) => s + r.owed, 0);
  const m = vk === "all" ? sales.total : (() => { const x = sales.byOwner[vk] ?? { qty: 0, revenue: 0, cost: 0 }; return { profit: x.revenue - x.cost }; })();

  // 要處理的事：照做事的地方分三組；每一項點了直接到那份清單（「可以出貨」在這裡就能一次出）
  type Todo = { n: number; text: string; href: string; group: "buy" | "order" | "stock"; ship?: true };
  const todoAll: Todo[] = [
    { n: rec.todo.length, text: "團還沒對單", href: "/reconcile?open=todo", group: "buy" },
    { n: refunds.length, text: "團被砍單、代購還沒退錢", href: "/reconcile?open=refund", group: "buy" },
    { n: dueBatches.length, text: "團還沒付清", href: "/inventory?tab=batches&open=0&pay=due", group: "buy" },
    { n: unsettled.length, text: "團合資還沒結清", href: unsettled.length === 1 ? `/inventory/batches/${unsettled[0].id}` : "/inventory?tab=batches&settle=1", group: "buy" },
    { n: overdue, text: "團超過預計到貨日", href: "/inventory?tab=batches&late=1", group: "buy" },
    { n: transit, text: "團代購寄出了，到了記得登記收到", href: "/inventory?tab=batches&transit=1", group: "buy" },
    { n: ready.orderIds.length, text: "張訂單到貨了，可以出貨", href: "/orders?ready=1", group: "order", ship: true },
    { n: short.length, text: "項商品客人訂的比庫存多", href: "/inventory?tab=stock&v=1&only=short", group: "stock" },
    { n: pre.unassigned, text: "件客人預訂還沒分是跟誰訂的", href: "/inventory?tab=stock&v=1&only=unassigned", group: "stock" },
    // 有接單時「張訂單還沒收款」已經包含現貨出售的，不重複列
    ...(usesOrders ? [] : [{ n: unpaidSales._count, text: "筆賣出還沒收到錢", href: "/orders?due=1&source=QUICK", group: "order" as const }]),
    ...(usesOrders
      ? [
          { n: d.pendingConfirm, text: "張訂單待確認", href: "/orders?status=PENDING_CONFIRM", group: "order" as const },
          { n: d.unpaidOrders, text: "張訂單還沒收款", href: "/orders?due=1", group: "order" as const },
          { n: d.refundPending + d.refundUnscheduled, text: "筆退款要處理", href: "/payments?tab=refunds", group: "order" as const },
          { n: d.needProducts, text: "項商品客人訂了還沒買", href: "/inventory?tab=demand", group: "stock" as const },
        ]
      : []),
  ];
  const todo = todoAll.filter((x) => x.n > 0);
  // 先做的排前面：可以出貨 → 收錢 → 確認訂單 → 付代購 → 收貨 → 其他；只先秀最急的 3 件，其他收在「還有幾件不急的」
  const PRIORITY = ["張訂單到貨了，可以出貨", "張訂單還沒收款", "筆賣出還沒收到錢", "張訂單待確認", "團還沒付清", "團代購寄出了，到了記得登記收到", "團超過預計到貨日", "筆退款要處理", "團被砍單、代購還沒退錢", "團還沒對單", "團合資還沒結清", "項商品客人訂的比庫存多", "項商品客人訂了還沒買", "件客人預訂還沒分是跟誰訂的"];
  todo.sort((a, b) => PRIORITY.indexOf(a.text) - PRIORITY.indexOf(b.text));
  const TOP = 3;
  const methods = ready.orderIds.length ? (await listShippingMethods(prisma)).map((x) => x.name) : [];

  // 金額：一排共用一個外框（細線分格）；還欠的用杏色，賺的用綠色，紅色只留給賠錢
  const stat = (label: string, value: number, href: string, tone: "owe" | "good", testid: string) => (
    <Link href={href} className="block bg-card px-3.5 py-3 transition-colors duration-150 hover:bg-line-2">
      <div className="text-[13px] text-mute">{label}</div>
      <div className={`num mt-0.5 text-[19px] leading-7 font-semibold ${tone === "owe" ? (value ? "text-warn" : "text-ink") : value < 0 ? "text-bad" : value > 0 ? "text-good" : "text-ink"}`} data-testid={testid}>{formatTwd(value)}</div>
    </Link>
  );

  return (
    <div className="space-y-4">
      <h1 className="sr-only">首頁</h1>
      {/* 找客人、訂單、商品、採購團：在首頁直接打 */}
      <form action="/search" method="get" role="search" className="relative">
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-mute"><Icon name="search" /></span>
        <input type="search" name="q" aria-label="搜尋客人、訂單、商品" placeholder="找客人、訂單編號、商品、採購團" className="min-h-12 w-full rounded-xl border border-field bg-card pr-3 pl-10 text-[16px] text-ink placeholder:text-mute" />
      </form>
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap" data-tour="home-actions">
        <Link href="/purchase" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-ai px-5 text-[16px] font-semibold text-on-fill transition-colors duration-150 hover:bg-ai-2 md:min-h-11">＋ 新增採購</Link>
        <Link href="/sell" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-card px-5 text-[16px] font-semibold transition-colors duration-150 hover:bg-line-2 md:min-h-11">賣給客人</Link>
      </div>
      {/* 手機：要處理的事 → 錢 → 搶購；電腦：左邊要處理的事，右邊錢與搶購 */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:items-start">
        <section aria-label="要處理的事" className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <h2 className="mb-2 flex items-baseline justify-between gap-2 text-[15px] font-semibold">
            要處理的事
            {todo.length > TOP && <span className="text-[13px] font-normal text-mute">最急的 {TOP} 件</span>}
          </h2>
          {todo.length === 0 ? (
            <p className="rounded-xl border border-line bg-card px-4 py-4 text-center text-[14px] text-good" data-testid="home-todo-empty">都處理好了</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-card" data-testid="home-todo" data-tour="home-todo">
              {(() => {
                const row = (t: Todo) => (
                  <li key={t.href + t.text} className="flex items-center">
                    <Link href={t.href} className="flex min-h-13 min-w-0 flex-1 items-center gap-3 px-3.5 py-3 transition-colors duration-150 hover:bg-line-2">
                      <span className="num w-8 shrink-0 text-right text-[19px] font-semibold text-ink">{t.n}</span>
                      <span className="min-w-0 flex-1 text-[15px] text-ink-2">{t.text}</span>
                      {!t.ship && <span aria-hidden className="text-mute"><Icon name="chevronRight" /></span>}
                    </Link>
                    {/* 可以出貨：在首頁直接一次出（同一位客人併一包，先看一下再按確定） */}
                    {t.ship && <span className="shrink-0 pr-3"><BulkShip ids={ready.orderIds} methods={methods} label="出貨" primary /></span>}
                  </li>
                );
                const rest = todo.slice(TOP);
                return (
                  <>
                    <ul className="divide-y divide-line-2">{todo.slice(0, TOP).map(row)}</ul>
                    {rest.length > 0 && (
                      <details className="group border-t border-line-2" data-testid="home-todo-more">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center px-3.5 text-[14px] text-ai hover:bg-line-2 [&::-webkit-details-marker]:hidden">
                          <span className="group-open:hidden">還有 {rest.length} 件不急的</span>
                          <span className="hidden group-open:inline">收起</span>
                        </summary>
                        <ul className="divide-y divide-line-2 border-t border-line-2">{rest.map(row)}</ul>
                      </details>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </section>

        {/* 錢：最常看的兩個放大；代購要退、預訂預估可賺放下面一行小字（點了一樣到明細） */}
        <section aria-label="錢" className="lg:col-start-2 lg:row-start-1" data-tour="home-stats">
          <div className="stat-grid grid grid-cols-2">
            {stat("還要付代購", dueTotal, "/inventory?tab=batches&open=0&pay=due", "owe", "home-due")}
            {stat("本月賺", m.profit, "/sales", "good", "home-profit")}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px] text-mute">
            <Link href="/reconcile?open=refund" className="hover:text-ink">代購要退 <span className={`num font-medium ${refundTotal ? "text-warn" : "text-ink-2"}`} data-testid="home-refund">{formatTwd(refundTotal)}</span></Link>
            <Link href="/sales#preorder" className="hover:text-ink">預訂預估可賺 <span className={`num font-medium ${pre.profit < 0 ? "text-bad" : "text-good"}`} data-testid="home-preorder">{formatTwd(pre.profit)}</span></Link>
          </div>
        </section>

        <section className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card px-3.5 py-2.5 lg:col-start-2 lg:row-start-2" aria-label="搶購提醒" data-testid="home-rush">
          <Link href={rush ? `/rush/${rush.id}` : "/rush"} className="min-w-0 flex-1 truncate text-[14px]">
            {rush ? <>下一場搶購　{relativeDay(rush.startAt).split(" ")[0]} {taipeiParts(rush.startAt).time}　{rush.supplierName}</> : <span className="text-mute">接下來沒有搶購，按這裡新增</span>}
          </Link>
          <PushStatusChip vapidKey={vapidPublicKey()} />
        </section>
      </div>
    </div>
  );
}
