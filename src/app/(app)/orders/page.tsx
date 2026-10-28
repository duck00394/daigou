import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section, TableWrap, StatusBadge, Twd, Empty, LinkButton, Pager, TagChip, Badge } from "@/components/ui";
import { FilterBar, FSearch, FSelect, qs } from "@/components/filters";
import { BulkBar, RowCheck, Selection } from "./bulk";
import { fmtDate, orderStatus, paymentStatus, shipStatus, orderSource } from "@/lib/labels";
import type { Prisma } from "@prisma/client";
import { getView } from "@/server/view";
import { AssignAll } from "../sales/assign";

export const metadata = { title: "訂單" };
const SIZE = 50;

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  // 看某個人：只列跟他訂的訂單，別人的不顯示（以前記的還沒分的另外提醒）
  const view = await getView();
  const vk = view.key === "all" ? null : view.key;
  // 還沒分是跟誰訂的（以前記的）：只列這些，勾選後分給某人
  const unassignedWhere: Prisma.OrderWhereInput = { confirmation: { not: "CANCELLED" }, items: { some: {}, none: { ownerKey: { not: null } } } };
  const onlyUnassigned = sp.unassigned === "1";
  const mineWhere: Prisma.OrderWhereInput = onlyUnassigned ? unassignedWhere : vk ? { items: { some: { ownerKey: { in: [vk, "joint", "none"] } } } } : {};
  const where: Prisma.OrderWhereInput = {
    AND: [mineWhere],
    ...(sp.q
      ? {
          OR: [
            { orderNo: { contains: sp.q, mode: "insensitive" } },
            { externalRef: { contains: sp.q, mode: "insensitive" } },
            { buyer: { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { lineName: { contains: sp.q, mode: "insensitive" } }, { aliases: { some: { alias: { contains: sp.q, mode: "insensitive" } } } }] } },
            { items: { some: { productNameSnapshot: { contains: sp.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
    ...(sp.status ? { statusCache: sp.status as never } : {}),
    ...(sp.payment ? { paymentStatusCache: sp.payment as never } : {}),
    ...(sp.ship ? { shipStatusCache: sp.ship as never } : {}),
    ...(sp.groupBuyId ? { groupBuyId: sp.groupBuyId } : {}),
    ...(sp.buyerId ? { buyerId: sp.buyerId } : {}),
    ...(sp.source ? { source: sp.source as never } : {}),
    ...(sp.categoryId ? { items: { some: { categoryId: sp.categoryId } } } : {}),
    ...(sp.from || sp.to ? { orderedAt: { ...(sp.from ? { gte: new Date(`${sp.from}T00:00:00+08:00`) } : {}), ...(sp.to ? { lt: new Date(new Date(`${sp.to}T00:00:00+08:00`).getTime() + 86400000) } : {}) } } : {}),
  };
  const orderBy: Prisma.OrderOrderByWithRelationInput =
    sp.sort === "old" ? { orderedAt: "asc" } : sp.sort === "balance" ? { balanceCache: "desc" } : sp.sort === "amount" ? { receivableCache: "desc" } : { orderedAt: "desc" };
  const [orders, total, gbs, cats, unpaidN, pendingN] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy,
      skip: (page - 1) * SIZE,
      take: SIZE,
      include: {
        buyer: { select: { id: true, name: true, code: true, tags: { where: { removedAt: null, tag: { active: true } }, include: { tag: true } } } },
        groupBuy: { select: { name: true } },
        items: { select: { productNameSnapshot: true, qty: true, cancelledQtyCache: true } },
      },
    }),
    prisma.order.count({ where }),
    prisma.groupBuy.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.order.count({ where: { AND: [mineWhere], paymentStatusCache: "UNPAID", confirmation: { not: "CANCELLED" } } }),
    prisma.order.count({ where: { AND: [mineWhere], statusCache: "PENDING_CONFIRM" } }),
  ]);
  const unassignedN = vk || onlyUnassigned ? await prisma.order.count({ where: unassignedWhere }) : 0;
  // 手機：搜尋框下面的快捷篩選
  const quick: [string, string, boolean][] = [
    ["全部", "/orders", !sp.payment && !sp.status],
    [`未付款 ${unpaidN}`, "/orders?payment=UNPAID", sp.payment === "UNPAID" && !sp.status],
    [`待確認 ${pendingN}`, "/orders?status=PENDING_CONFIRM", sp.status === "PENDING_CONFIRM" && !sp.payment],
  ];
  const base = `/orders${qs({ ...sp, page: undefined })}`;
  return (
    <div>
      <PageHeader
        title="訂單"
        actions={
          <>
            <LinkButton href={`/api/export/orders${qs({ groupBuyId: sp.groupBuyId, buyerId: sp.buyerId, status: sp.status, payment: sp.payment })}`}>匯出 Excel</LinkButton>
            <LinkButton href="/paste">貼上加單</LinkButton>
            <LinkButton href="/orders/new" primary>新增訂單</LinkButton>
          </>
        }
      />
      {onlyUnassigned ? (
        <div className="mb-3 rounded-xl border border-[#f0dfa8] bg-warn-soft px-3 py-2 text-[14px] text-warn" data-testid="orders-unassigned-list">
          只列還沒分是跟誰訂的 {unassignedN} 張（含待確認、已經給了的）。勾選後在下面選「分給誰」。已經給了的會照扣到誰的貨自動分。
          <Link href="/orders" className="ml-1 font-semibold text-ai underline">看全部訂單 ›</Link>
        </div>
      ) : unassignedN > 0 ? (
        <div className="mb-3" data-testid="orders-unassigned">
          <AssignAll n={unassignedN} unit="張以前記的訂單" operators={view.ops} acting={vk ?? ""} counted={false} moreHref="/orders?unassigned=1" />
        </div>
      ) : null}
      <Section pad={false}>
        <FilterBar action="/orders">
          <FSearch data-search value={sp.q} placeholder="訂單編號、買家、商品" />
          <FSelect name="status" label="訂單狀態" value={sp.status} options={Object.entries(orderStatus).map(([k, v]) => [k, v[0]])} />
          <FSelect name="payment" label="付款" value={sp.payment} options={Object.entries(paymentStatus).map(([k, v]) => [k, v[0]])} />
          <FSelect name="ship" label="出貨" value={sp.ship} options={Object.entries(shipStatus).map(([k, v]) => [k, v[0]])} />
          <FSelect name="groupBuyId" label="代購團" value={sp.groupBuyId} options={gbs.map((g) => [g.id, g.name])} />
          <FSelect name="categoryId" label="分類" value={sp.categoryId} options={cats.map((c) => [c.id, c.name])} />
          <FSelect name="source" label="來源" value={sp.source} options={Object.entries(orderSource)} />
          <label className="text-[12px] text-mute">
            <span className="mb-0.5 block">起日</span>
            <input type="date" name="from" defaultValue={sp.from} className="rounded-lg border border-line px-2 py-2" />
          </label>
          <label className="text-[12px] text-mute">
            <span className="mb-0.5 block">迄日</span>
            <input type="date" name="to" defaultValue={sp.to} className="rounded-lg border border-line px-2 py-2" />
          </label>
          <FSelect name="sort" label="排序" value={sp.sort} options={[["old", "日期舊→新"], ["balance", "待收多→少"], ["amount", "金額大→小"]]} />
          {sp.buyerId && <input type="hidden" name="buyerId" value={sp.buyerId} />}
        </FilterBar>
        <div className="flex gap-1.5 overflow-x-auto px-4 pt-2 md:hidden" data-testid="orders-quick">
          {quick.map(([l, h, on]) => (
            <Link key={h} href={h} className={`shrink-0 rounded-full border px-3 py-1 text-[13px] ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`}>{l}</Link>
          ))}
        </div>
        <Selection ids={orders.map((o) => o.id)}>
        <BulkBar groupBuys={gbs.filter((g) => g.status !== "CANCELLED").map((g) => ({ id: g.id, name: g.name }))} owners={onlyUnassigned ? view.ops : undefined} acting={vk ?? ""} />
        {orders.length === 0 ? (
          <Empty action={<LinkButton href="/orders/new" primary>新增訂單</LinkButton>}>沒有符合條件的訂單。</Empty>
        ) : (
          <>
          {/* 手機：一筆一張卡片，不用往右拉 */}
          <ul className="space-y-2 px-3 py-2 md:hidden" data-testid="order-cards">
            {orders.map((o) => {
              const active = o.items.reduce((s, i) => s + i.qty - i.cancelledQtyCache, 0);
              return (
                <li key={o.id} className="flex gap-2.5 rounded-xl border border-line bg-white p-3" data-testid="order-card">
                  <span className="pt-0.5"><RowCheck id={o.id} /></span>
                  <Link href={`/orders/${o.id}`} className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15.5px] font-semibold">{o.buyer.name}</span>
                      <span className="shrink-0 text-[15px] font-semibold">
                        {o.balanceCache > 0 ? <Twd v={o.balanceCache} className="text-bad" /> : o.refundDueCache > 0 ? <span className="text-bad">應退 {o.refundDueCache.toLocaleString()}</span> : o.confirmation === "CANCELLED" ? <span className="text-mute">—</span> : <span className="text-[13px] text-good">已收齊</span>}
                      </span>
                    </div>
                    <div className="text-[12.5px] text-mute">
                      <span className="num">{o.orderNo}</span>・{fmtDate(o.orderedAt)}・{orderSource[o.source]}{o.groupBuy ? `・${o.groupBuy.name}` : ""}{o.parentOrderId ? "・追加單" : ""}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[13.5px] text-ink-2">{o.items.map((i) => `${i.productNameSnapshot}×${i.qty - i.cancelledQtyCache}`).join("、")}（共 {active} 件）</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <StatusBadge map={orderStatus} value={o.statusCache} />
                      <StatusBadge map={paymentStatus} value={o.paymentStatusCache} />
                      <StatusBadge map={shipStatus} value={o.shipStatusCache} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
          <TableWrap maxH="70vh">
            <thead>
              <tr>
                <th className="w-8"><span className="sr-only">選取</span></th>
                <th>訂單</th>
                <th>買家</th>
                <th>商品</th>
                <th>訂單狀態</th>
                <th>付款</th>
                <th>出貨</th>
                <th className="text-right">應收</th>
                <th className="text-right">待收</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const active = o.items.reduce((s, i) => s + i.qty - i.cancelledQtyCache, 0);
                return (
                  <tr key={o.id}>
                    <td><RowCheck id={o.id} /></td>
                    <td className="whitespace-nowrap">
                      <Link href={`/orders/${o.id}`} className="num font-medium text-ai hover:underline">{o.orderNo}</Link>
                      <div className="text-[12px] text-mute">
                        {fmtDate(o.orderedAt)}｜{orderSource[o.source]}
                        {o.parentOrderId ? "｜追加單" : ""}
                      </div>
                      {o.groupBuy && <div className="text-[12px] text-mute">{o.groupBuy.name}</div>}
                    </td>
                    <td className="min-w-[8rem]">
                      <Link href={`/buyers/${o.buyer.id}`} className="hover:underline">{o.buyer.name}</Link>
                      {o.buyer.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {o.buyer.tags.map((t) => <TagChip key={t.id} name={t.tag.name} color={t.tag.color} />)}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[18rem] text-[13px]">
                      <span className="line-clamp-2">{o.items.map((i) => `${i.productNameSnapshot}×${i.qty - i.cancelledQtyCache}`).join("、")}</span>
                      <span className="text-mute">共 {active} 件</span>
                    </td>
                    <td><StatusBadge map={orderStatus} value={o.statusCache} /></td>
                    <td><StatusBadge map={paymentStatus} value={o.paymentStatusCache} /></td>
                    <td><StatusBadge map={shipStatus} value={o.shipStatusCache} /></td>
                    <td className="text-right"><Twd v={o.receivableCache} /></td>
                    <td className="text-right">{o.balanceCache > 0 ? <Twd v={o.balanceCache} className="font-medium text-bad" /> : o.refundDueCache > 0 ? <Badge tone="bad">應退 {o.refundDueCache}</Badge> : <span className="text-mute">0</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          </div>
          </>
        )}
        </Selection>
        <Pager page={page} total={total} size={SIZE} base={base} />
      </Section>
    </div>
  );
}
