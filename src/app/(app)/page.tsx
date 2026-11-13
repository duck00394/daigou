// 首頁：只放「今天要做的事」——兩顆大按鈕、三個數字、一張待辦清單（按了直接到篩好的地方）、下一場搶購
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
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
import { BulkShip, RowActions } from "./orders/bulk";
import { Badge } from "@/components/ui";
import { plainStatus } from "@/lib/order-plain";
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
  type Todo = { n: number; text: string; href: string; group: "buy" | "order" | "stock"; ship?: true; act?: string };
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
  // 每一件都寫出下一步要按什麼（按了到篩好的清單，在那裡一次做完）
  const ACT: Record<string, string> = {
    "團還沒對單": "去對單",
    "團被砍單、代購還沒退錢": "記退款",
    "團還沒付清": "去付款",
    "團合資還沒結清": "去結清",
    "團超過預計到貨日": "問進度",
    "團代購寄出了，到了記得登記收到": "登記收到",
    "項商品客人訂的比庫存多": "看缺多少",
    "件客人預訂還沒分是跟誰訂的": "去分",
    "筆賣出還沒收到錢": "去收款",
    "張訂單待確認": "去確認",
    "張訂單還沒收款": "去收款",
    "筆退款要處理": "去退款",
    "項商品客人訂了還沒買": "去買",
  };
  const todo = todoAll.filter((x) => x.n > 0).map((x) => ({ ...x, act: ACT[x.text] }));
  // 先做的排前面：可以出貨 → 收錢 → 確認訂單 → 付代購 → 收貨 → 其他；只先秀最急的 3 件，其他收在「還有幾件不急的」
  const PRIORITY = ["張訂單到貨了，可以出貨", "張訂單還沒收款", "筆賣出還沒收到錢", "張訂單待確認", "團還沒付清", "團代購寄出了，到了記得登記收到", "團超過預計到貨日", "筆退款要處理", "團被砍單、代購還沒退錢", "團還沒對單", "團合資還沒結清", "項商品客人訂的比庫存多", "項商品客人訂了還沒買", "件客人預訂還沒分是跟誰訂的"];
  todo.sort((a, b) => PRIORITY.indexOf(a.text) - PRIORITY.indexOf(b.text));
  const TOP = 3;
  // 要處理的訂單（電腦才顯示；手機版首頁不重複，待辦那幾列點了就到同一份清單）：可以出貨 → 待確認 → 還沒收齊錢，最多 5 張；每張的下一步按鈕就在旁邊
  const readySet = new Set(ready.orderIds);
  const mineOrder = vk === "all" ? {} : { items: { some: { ownerKey: { in: [vk, "joint", "none"] } } } };
  const actOrders = usesOrders
    ? await prisma.order.findMany({
        where: { AND: [mineOrder, { statusCache: { notIn: ["CANCELLED", "COMPLETED"] } }, { OR: [{ id: { in: ready.orderIds } }, { confirmation: "PENDING" }, { confirmation: "CONFIRMED", balanceCache: { gt: 0 } }] }] },
        orderBy: { orderedAt: "asc" },
        take: 60,
        select: { id: true, orderNo: true, confirmation: true, statusCache: true, shipStatusCache: true, balanceCache: true, buyer: { select: { name: true } }, items: { select: { productNameSnapshot: true, qty: true, cancelledQtyCache: true } } },
      })
    : [];
  const rank = (o: (typeof actOrders)[number]) => (readySet.has(o.id) ? 0 : o.confirmation === "PENDING" ? 1 : 2);
  const actTop = [...actOrders].sort((a, b) => rank(a) - rank(b)).slice(0, 5);
  const methods = ready.orderIds.length || actTop.length ? (await listShippingMethods(prisma)).map((x) => x.name) : [];

  // 本月重點：兩個最常看的數字各一行（手機不佔太高），另外兩個放下面一行小字；點了都到明細
  // 還欠的用杏色，賺的用綠色，紅色只留給賠錢
  const tone = (value: number, t: "owe" | "good") => (t === "owe" ? (value ? "text-warn" : "text-ink") : value < 0 ? "text-bad" : value > 0 ? "text-good" : "text-ink");
  const moneyRow = (label: string, value: number, href: string, t: "owe" | "good", testid: string) => (
    <li>
      <Link href={href} className="flex min-h-12 items-center gap-3 px-3.5 py-2 transition-colors duration-150 hover:bg-line-2">
        <span className="min-w-0 flex-1 text-[14px] text-ink-2">{label}</span>
        <span className={`num text-[18px] font-semibold ${tone(value, t)}`} data-testid={testid}>{formatTwd(value)}</span>
        <span aria-hidden className="text-mute"><Icon name="chevronRight" /></span>
      </Link>
    </li>
  );
  // 電腦右欄的快速操作（新增採購、賣給客人在最上面兩顆按鈕；手機這些都在底部和「更多」）
  const quick: { href: string; title: string; icon: IconName }[] = [
    { href: "/orders", title: "接單", icon: "list" },
    { href: "/inventory?tab=stock", title: "庫存", icon: "box" },
    { href: usesOrders ? "/payments" : "/reconcile", title: "帳務", icon: "coin" },
    { href: "/settings", title: "設定", icon: "gear" },
  ];
  // 兩顆最常用的：新增採購、賣給客人
  const mainActions = (cls: string) => (
    <div className={cls} data-tour="home-actions">
      <Link href="/purchase" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-ai px-5 text-[16px] font-semibold text-on-fill transition-colors duration-150 hover:bg-ai-2 lg:min-h-12">＋ 新增採購</Link>
      <Link href="/sell" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-card px-5 text-[16px] font-semibold transition-colors duration-150 hover:bg-line-2 lg:min-h-12">賣給客人</Link>
    </div>
  );
  // 待辦清單：最急的 3 件，其他收在「還有幾件不急的」
  const todoList = (items: Todo[], testid: string, moreId: string) =>
    items.length === 0 ? (
      <p className="rounded-xl border border-line bg-card px-4 py-4 text-center text-[14px] text-good" data-testid={`${testid}-empty`}>都處理好了</p>
    ) : (
      <div className="overflow-hidden rounded-xl border border-line bg-card" data-testid={testid} data-tour="home-todo">
        {(() => {
          const row = (t: Todo) => (
            <li key={t.href + t.text} className="flex items-center">
              <Link href={t.href} className="flex min-h-13 min-w-0 flex-1 items-center gap-3 px-3.5 py-3 transition-colors duration-150 hover:bg-line-2">
                <span className="num w-8 shrink-0 text-right text-[19px] font-semibold text-ink">{t.n}</span>
                <span className="min-w-0 flex-1 text-[15px] text-ink-2">{t.text}</span>
                {!t.ship && (t.act ? <span className="shrink-0 rounded-lg border border-ai px-2.5 py-1 text-[13.5px] font-medium text-ai" data-testid="todo-act">{t.act}</span> : <span aria-hidden className="text-mute"><Icon name="chevronRight" /></span>)}
              </Link>
              {/* 可以出貨：在首頁直接一次出（同一位客人併一包，先看一下再按確定） */}
              {t.ship && <span className="shrink-0 pr-3"><BulkShip ids={ready.orderIds} methods={methods} label="出貨" primary /></span>}
            </li>
          );
          const rest = items.slice(TOP);
          return (
            <>
              <ul className="divide-y divide-line-2">{items.slice(0, TOP).map(row)}</ul>
              {rest.length > 0 && (
                <details className="group border-t border-line-2" data-testid={moreId}>
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
    );
  const todoHead = (items: Todo[]) => (
    <h2 className="mb-2 flex items-baseline justify-between gap-2 text-[15px] font-semibold">
      要處理的事
      {items.length > TOP && <span className="text-[13px] font-normal text-mute">最急的 {TOP} 件</span>}
    </h2>
  );
  // 電腦：訂單那三種（可以出貨、還沒收款、待確認）放在右邊「要處理的訂單」上面當摘要，不在待辦再列一次
  const ORDER_TODO = ["張訂單到貨了，可以出貨", "張訂單還沒收款", "張訂單待確認"];
  const deskTodo = usesOrders ? todo.filter((t) => !ORDER_TODO.includes(t.text)) : todo;
  const chip = "inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-card px-3 text-[13.5px] text-ink-2 hover:bg-line-2";

  return (
    <div className="space-y-4">
      <h1 className="sr-only">首頁</h1>
      {/* 找客人、訂單、商品、採購團：在首頁直接打。電腦版旁邊就是兩顆最常用的按鈕 */}
      <div className="flex items-center gap-3">
        <form action="/search" method="get" role="search" className="relative min-w-0 flex-1">
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-mute"><Icon name="search" /></span>
          <input type="search" name="q" aria-label="搜尋客人、訂單、商品" placeholder="找客人、訂單編號、商品、採購團" className="min-h-12 w-full rounded-xl border border-field bg-card pr-3 pl-10 text-[16px] text-ink placeholder:text-mute" />
        </form>
        {mainActions("hidden shrink-0 gap-2 lg:flex")}
      </div>
      {/* 手機一欄：要處理的事 → 新增採購／賣給客人 → 本月重點 → 搶購
          電腦：左邊 要處理的事、要處理的訂單；右邊 本月重點、快速操作、搶購 */}
      <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-5 lg:space-y-0">
        <div className="space-y-4">
          <section aria-label="要處理的事" className="lg:hidden">
            {todoHead(todo)}
            {todoList(todo, "home-todo", "home-todo-more")}
          </section>
          {mainActions("grid grid-cols-2 gap-2 lg:hidden")}
          <section aria-label="要處理的事" className="hidden lg:block">
            {todoHead(deskTodo)}
            {todoList(deskTodo, "home-todo-desk", "home-todo-more-desk")}
          </section>
          {usesOrders && (actTop.length > 0 || ready.orderIds.length > 0) && (
            <section aria-label="要處理的訂單" className="hidden lg:block" data-testid="home-orders">
              <h2 className="mb-2 flex items-baseline justify-between gap-2 text-[15px] font-semibold">
                要處理的訂單
                <Link href="/orders" className="text-[13px] font-normal text-ai">看全部訂單</Link>
              </h2>
              {/* 摘要：幾張可以出貨（可以一次全部出）、幾張還沒收款、幾張待確認；下面是最急的幾張 */}
              <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="home-orders-sum">
                {ready.orderIds.length > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Link href="/orders?ready=1" className={chip}>可以出貨 <b className="num font-semibold text-good">{ready.orderIds.length}</b> 張</Link>
                    <BulkShip ids={ready.orderIds} methods={methods} label="全部出貨" primary />
                  </span>
                )}
                {d.unpaidOrders > 0 && <Link href="/orders?due=1" className={chip}>還沒收款 <b className="num font-semibold text-warn">{d.unpaidOrders}</b> 張</Link>}
                {d.pendingConfirm > 0 && <Link href="/orders?status=PENDING_CONFIRM" className={chip}>待確認 <b className="num font-semibold text-warn">{d.pendingConfirm}</b> 張</Link>}
              </div>
              <ul className="divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-card">
                {actTop.map((o) => {
                  const [st, tone] = plainStatus(o, readySet.has(o.id));
                  const items = o.items.filter((i) => i.qty > i.cancelledQtyCache);
                  return (
                    <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5" data-testid="home-order">
                      <Link href={`/orders/${o.id}`} className="min-w-0 flex-1 basis-48">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-[15px] font-medium">{o.buyer.name}</span>
                          {o.balanceCache > 0 && <span className="num shrink-0 text-[14px] font-semibold text-warn">{formatTwd(o.balanceCache)}</span>}
                        </span>
                        <span className="block truncate text-[12.5px] text-mute">{items.map((i) => `${i.productNameSnapshot}×${i.qty - i.cancelledQtyCache}`).join("、")}</span>
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone={tone}>{st}</Badge>
                        <RowActions id={o.id} pendingConfirm={o.confirmation === "PENDING"} ready={readySet.has(o.id)} due={o.confirmation === "CONFIRMED" && o.balanceCache > 0} methods={methods} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
        <div className="space-y-4">
          <section aria-label="本月重點" data-tour="home-stats">
            <h2 className="mb-2 text-[15px] font-semibold">本月重點</h2>
            <ul className="divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-card">
              {moneyRow("還要付代購", dueTotal, "/inventory?tab=batches&open=0&pay=due", "owe", "home-due")}
              {moneyRow("本月賺", m.profit, "/sales", "good", "home-profit")}
            </ul>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px] text-mute">
              <Link href="/reconcile?open=refund" className="inline-flex min-h-8 items-center gap-1 hover:text-ink">代購要退 <span className={`num font-medium ${refundTotal ? "text-warn" : "text-ink-2"}`} data-testid="home-refund">{formatTwd(refundTotal)}</span></Link>
              <Link href="/sales#preorder" className="inline-flex min-h-8 items-center gap-1 hover:text-ink">預訂預估可賺 <span className={`num font-medium ${pre.profit < 0 ? "text-bad" : "text-good"}`} data-testid="home-preorder">{formatTwd(pre.profit)}</span></Link>
            </div>
          </section>
          <section aria-label="快速操作" className="hidden lg:block">
            <h2 className="mb-2 text-[15px] font-semibold">快速操作</h2>
            <ul className="stat-grid grid grid-cols-2">
              {quick.map((q) => (
                <li key={q.href}>
                  <Link href={q.href} className="flex min-h-12 items-center gap-2 px-3.5 py-2.5 text-[15px] font-medium transition-colors duration-150 hover:bg-line-2">
                    <span aria-hidden className="text-ai"><Icon name={q.icon} /></span>{q.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card px-3.5 py-2.5" aria-label="搶購提醒" data-testid="home-rush">
            <Link href={rush ? `/rush/${rush.id}` : "/rush"} className="min-w-0 flex-1 truncate text-[14px]">
              {rush ? <>下一場搶購　{relativeDay(rush.startAt).split(" ")[0]} {taipeiParts(rush.startAt).time}　{rush.supplierName}</> : <span className="text-mute">接下來沒有搶購，按這裡新增</span>}
            </Link>
            <PushStatusChip vapidKey={vapidPublicKey()} />
          </section>
        </div>
      </div>
    </div>
  );
}
