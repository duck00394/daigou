import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { inventoryFor } from "@/server/services/mine";
import { PageHeader, Section, TableWrap, Empty, LinkButton, TagChip, Badge } from "@/components/ui";
import { formatTwd } from "@/lib/money";
import { BuyerShipCard, ShipOwnerButton, ShipmentEdit, type ShipItem } from "./parts";
import { listOperators } from "@/server/services/operators";
import { shipOwnerLabels } from "@/server/services/ship-owner";
import { getView } from "@/server/view";
import { shipPlan } from "@/server/services/order-flow";

type Ops = { id: string; name: string }[];
/** 「JING 1・合資 1」 */
const ownersText = (m: Map<string, number> | undefined, ops: Ops) =>
  [...(m ?? new Map<string, number>()).entries()].filter(([, q]) => q > 0).map(([k, q]) => `${k === "joint" ? "合資" : k === "none" ? "未指定" : (ops.find((o) => o.id === k)?.name ?? "未指定")} ${q}`).join("、");
import { fmtDate } from "@/lib/labels";

export const metadata = { title: "出貨" };

export default async function Shipping({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? "todo";
  // 看某個人：只列跟他訂的，別人的不顯示
  const view = await getView();
  const vk = view.key === "all" ? null : view.key;
  return (
    <div className="space-y-4">
      <PageHeader
        title="出貨"
        sub="把到貨的預訂交給客人"
      />
      <nav className="flex flex-wrap gap-1" aria-label="分頁">
        {[["todo", "待出貨（依買家）"], ["order", "待出貨（依訂單）"], ["done", "出貨紀錄"]].map(([k, l]) => (
          <Link key={k} href={`/shipping?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`flex min-h-9 items-center rounded-full border px-3.5 text-[13.5px] transition-colors duration-150 ${tab === k ? "border-ai bg-ai font-medium text-on-fill" : "border-line bg-card text-ink-2 hover:bg-line-2"}`}>{l}</Link>
        ))}
      </nav>
      {tab === "done" ? <DoneTab vk={vk} /> : <TodoTab byOrder={tab === "order"} sp={sp} vk={vk} />}
      {/* 不常用的放頁尾 */}
      <div className="flex flex-wrap justify-end gap-2">
        <LinkButton small href="/api/export/to-ship">匯出待出貨清單</LinkButton>
        <LinkButton small href="/api/export/shipments">匯出出貨紀錄</LinkButton>
      </div>
    </div>
  );
}

async function TodoTab({ byOrder, sp, vk }: { byOrder: boolean; sp: Record<string, string | undefined>; vk: string | null }) {
  const gbs = await prisma.groupBuy.findMany({ orderBy: { createdAt: "desc" } });
  const items = await prisma.orderItem.findMany({
    where: {
      ...(vk ? { ownerKey: { in: [vk, "joint", "none"] } } : {}),
      order: { confirmation: "CONFIRMED", ...(sp.groupBuyId ? { groupBuyId: sp.groupBuyId } : {}) },
      shipStatusCache: { notIn: ["SHIPPED", "DELIVERED", "CANCELLED"] },
    },
    include: { order: { include: { buyer: { include: { tags: { where: { removedAt: null, tag: { active: true } }, include: { tag: true } } } }, groupBuy: { select: { name: true } } } } },
    orderBy: [{ order: { orderedAt: "asc" } }, { createdAt: "asc" }],
  });
  // 可出幾件：跟首頁、訂單列表、採購團提醒同一套出貨排程（已保留＋跟誰訂的那個人的可用庫存，先下單的先分）
  const plan = await tx((t) => shipPlan(t));
  const canShip = new Map(plan.items.map((x) => [x.id, x.shippable]));
  const readyOrders = new Set(plan.readyOrderIds);
  if (sp.ready) items.splice(0, items.length, ...items.filter((i) => (canShip.get(i.id) ?? 0) > 0));
  const inv = await tx((t) => inventoryFor(t, [...new Set(items.map((i) => i.productId))], vk));
  const ops = await tx((t) => listOperators(t, { includeInactive: true }));
  const activeOps = ops.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }));
  const resBy = await tx((t) => shipOwnerLabels(t, { orderItemIds: items.filter((i) => i.reservedQtyCache > 0).map((i) => i.id) }));
  const toView = (i: (typeof items)[number]): ShipItem => ({
    id: i.id,
    orderNo: i.order.orderNo,
    orderId: i.orderId,
    name: i.productNameSnapshot,
    spec: i.specNote,
    pending: i.qty - i.cancelledQtyCache - i.shippedQtyCache,
    reserved: i.reservedQtyCache,
    packFlag: i.packFlag,
    reservedBy: ownersText(resBy.get(i.id), ops),
    ownerKey: i.ownerKey,
    shippable: Math.min(canShip.get(i.id) ?? 0, i.qty - i.cancelledQtyCache - i.shippedQtyCache),
    wholeOrder: readyOrders.has(i.orderId),
  });
  const groups = new Map<string, { key: string; title: string; sub: string; buyer: (typeof items)[number]["order"]["buyer"]; items: typeof items }>();
  for (const i of items) {
    const key = byOrder ? i.orderId : i.order.buyerId;
    const g = groups.get(key) ?? { key, title: byOrder ? `${i.order.orderNo}｜${i.order.buyer.name}` : i.order.buyer.name, sub: byOrder ? (i.order.groupBuy?.name ?? "") : (i.order.buyer.shippingMethod ?? ""), buyer: i.order.buyer, items: [] };
    g.items.push(i);
    groups.set(key, g);
  }
  const canOf = (g: { items: typeof items }) => g.items.reduce((s, i) => s + (canShip.get(i.id) ?? 0), 0);
  const list = [...groups.values()].sort((a, b) => canOf(b) - canOf(a));
  // 分兩段：現在就可以出的在上面；一件都還沒到的收在「還在等貨」
  const readyGroups = list.filter((g) => canOf(g) > 0);
  const waitGroups = list.filter((g) => canOf(g) === 0);
  const readyQty = readyGroups.reduce((a, g) => a + canOf(g), 0);
  const wholeN = new Set(list.flatMap((g) => g.items.filter((i) => readyOrders.has(i.orderId)).map((i) => i.orderId))).size;
  // 每位客人（或每張單）一眼看出：全部可出／部分可出／還沒到，和錢收齊了沒（出貨不會因為沒付錢擋住，只是提醒）
  const stateOf = (g: (typeof list)[number]) => {
    const pending = g.items.reduce((a, i) => a + i.qty - i.cancelledQtyCache - i.shippedQtyCache, 0);
    const can = Math.min(canOf(g), pending);
    const owe = [...new Map(g.items.map((i) => [i.orderId, i.order.balanceCache])).values()].reduce((a, b) => a + b, 0);
    return { pending, can, owe };
  };
  const card = (g: (typeof list)[number]) => (
    <Section
      key={g.key}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Link href={byOrder ? `/orders/${g.key}` : `/buyers/${g.buyer.id}`} className="hover:underline">{g.title}</Link>
          {g.buyer.tags.map((t) => <TagChip key={t.id} name={t.tag.name} color={t.tag.color} />)}
        </span>
      }
      actions={(() => {
        const st = stateOf(g);
        return (
          <span className="flex flex-wrap items-center justify-end gap-1.5 text-[13px] text-mute" data-testid="ship-state">
            {g.sub && <span>{g.sub}</span>}
            {st.can >= st.pending ? <Badge tone="good">全部可出 {st.can} 件</Badge> : st.can > 0 ? <Badge tone="info">部分可出 {st.can}／{st.pending} 件</Badge> : <Badge tone="muted">還沒到 {st.pending} 件</Badge>}
            {st.owe > 0 && <Badge tone="warn">還沒付清 {formatTwd(st.owe)}</Badge>}
          </span>
        );
      })()}
    >
      <BuyerShipCard
        buyerId={g.buyer.id}
        buyerName={g.buyer.name}
        defaultMethod={g.buyer.shippingMethod}
        items={g.items.map(toView)}
        available={Object.fromEntries(g.items.map((i) => [i.id, Math.max(0, inv.get(i.productId)?.available ?? 0)]))}
        operators={activeOps}
      />
    </Section>
  );
  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value={byOrder ? "order" : "todo"} />
        <label className="text-[12px] text-mute">代購團
          <select name="groupBuyId" defaultValue={sp.groupBuyId ?? ""} className="mt-0.5 block rounded-lg border border-field bg-card px-2 py-2 text-[15px]">
            <option value="">全部</option>
            {gbs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 py-2 text-sm"><input type="checkbox" name="ready" value="1" defaultChecked={!!sp.ready} className="h-4 w-4" />只看已有到貨可出的</label>
        <button className="rounded-lg border border-ai bg-ai px-3 py-2 text-sm text-on-fill">套用</button>
      </form>
      {list.length === 0 ? (
        <Section><Empty action={<LinkButton href="/sell">賣給客人</LinkButton>}>沒有要給客人的東西。客人預訂的商品到貨後，會出現在這裡。</Empty></Section>
      ) : (
        <>
          {/* 一眼看出：可以出的幾位、幾件（其中整張可出幾張）、還在等貨的幾位 */}
          <div className="stat-grid grid grid-cols-2 sm:grid-cols-4" data-testid="ship-summary">
            <div className="bg-card px-3.5 py-2.5"><div className="text-[12.5px] text-mute">可以出貨的客人</div><div className="num text-[18px] font-semibold text-good">{readyGroups.length} 位</div></div>
            <div className="bg-card px-3.5 py-2.5"><div className="text-[12.5px] text-mute">可以出幾件</div><div className="num text-[18px] font-semibold">{readyQty} 件</div></div>
            <div className="bg-card px-3.5 py-2.5"><div className="text-[12.5px] text-mute">整張可出</div><div className="num text-[18px] font-semibold">{wholeN} 張</div></div>
            <div className="bg-card px-3.5 py-2.5"><div className="text-[12.5px] text-mute">還在等貨</div><div className={`num text-[18px] font-semibold ${waitGroups.length ? "text-warn" : ""}`}>{waitGroups.length} 位</div></div>
          </div>
          {readyGroups.length > 0 && <div className="space-y-3">{readyGroups.map(card)}</div>}
          {waitGroups.length > 0 && (
            // 還不能出的（一件都還沒到）收在下面：先看名字和缺什麼，要硬出再點開
            <details className="group rounded-xl border border-line bg-card" data-testid="ship-waiting">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="text-[15px] font-semibold">還在等貨（{waitGroups.length} 位）</span>
                  <span className="mt-0.5 block truncate text-[13px] text-mute">{waitGroups.map((g) => `${g.buyer.name} ${g.items.reduce((a, i) => a + i.qty - i.cancelledQtyCache - i.shippedQtyCache, 0)} 件`).join("、")}</span>
                </span>
                <span className="shrink-0 text-[13px] text-ai group-open:hidden">點開</span>
                <span className="hidden shrink-0 text-[13px] text-ai group-open:inline">收起</span>
              </summary>
              <div className="space-y-3 border-t border-line-2 p-3">{waitGroups.map(card)}</div>
            </details>
          )}
        </>
      )}
    </>
  );
}

async function DoneTab({ vk }: { vk: string | null }) {
  const ships = await prisma.shipment.findMany({ where: vk ? { items: { some: { orderItem: { ownerKey: { in: [vk, "joint", "none"] } } } } } : {}, orderBy: { shippedAt: "desc" }, take: 100, include: { buyer: true, items: { include: { orderItem: { include: { order: { select: { id: true, orderNo: true, confirmation: true } } } } } } } });
  const ops = await tx((t) => listOperators(t, { includeInactive: true }));
  const activeOps = ops.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }));
  const by = await tx((t) => shipOwnerLabels(t, { shipmentItemIds: ships.flatMap((s) => s.items.map((i) => i.id)) }));
  const canSwitch = (s: (typeof ships)[number]) => s.items.some((i) => i.qty > 0) && s.items.every((i) => i.qty > 0 && i.orderItem.order.confirmation === "CONFIRMED");
  return (
    <Section pad={false}>
      {ships.length === 0 ? <Empty>還沒有出貨紀錄。</Empty> : (
        <TableWrap>
          <thead><tr><th>出貨單</th><th>買家</th><th>配送</th><th>物流單號</th><th>內容</th><th>狀態</th><th></th></tr></thead>
          <tbody>
            {ships.map((s) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap"><span className="num font-medium">{s.shipmentNo}</span><div className="num text-[12px] text-mute">{fmtDate(s.shippedAt, true)}</div></td>
                <td><Link href={`/buyers/${s.buyerId}`} className="hover:underline">{s.buyer.name}</Link></td>
                <td>{s.method ?? "無"}</td>
                <td className="num">{s.trackingNo ?? "無"}</td>
                <td className="max-w-sm text-[13px]">
                  {s.items.map((i) => {
                    const who = i.qty > 0 ? ownersText(by.get(i.id), ops) : "";
                    return <div key={i.id} data-testid="ship-line">{i.orderItem.productNameSnapshot}×{i.qty}（{i.orderItem.order.orderNo}）{who && <span className="text-mute" data-testid="ship-owner">，{who}</span>}</div>;
                  })}
                </td>
                <td>{s.status === "DELIVERED" ? "已送達" : "已出貨"}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <ShipmentEdit id={s.id} method={s.method} tracking={s.trackingNo} delivered={s.status === "DELIVERED"} />
                    {canSwitch(s) && <ShipOwnerButton id={s.id} now={[...new Set(s.items.map((i) => ownersText(by.get(i.id), ops)).filter(Boolean))].join("；")} operators={activeOps} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Section>
  );
}
