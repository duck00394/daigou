import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section, TableWrap, StatusBadge, Twd, Empty, LinkButton, Pager, TagChip, Badge } from "@/components/ui";
import { FilterBar, FSearch, FSelect, fDateCls, qs } from "@/components/filters";
import { BulkBar, BulkPay, BulkShip, RowActions, RowCheck, Selection } from "./bulk";
import { fmtDate, orderStatus, paymentStatus, shipStatus, orderSource } from "@/lib/labels";
import type { Prisma } from "@prisma/client";
import { getView } from "@/server/view";
import { AssignAll } from "../sales/assign";
import { listShippingMethods } from "@/server/services/shipping-methods";
import { readyToShip } from "@/server/services/order-flow";

export const metadata = { title: "訂單" };

type Tone = "neutral" | "info" | "good" | "warn" | "bad" | "muted";
/** 一張單只講一句話：取消／待確認／可以出貨／等貨中／已出貨／完成，再補一句錢還沒收齊（三個狀態欄的資料不變，只是合成一個白話說法） */
function plainStatus(o: { confirmation: string; statusCache: string; shipStatusCache: string; balanceCache: number }, ready: boolean): [string, Tone] {
  if (o.confirmation === "CANCELLED" || o.statusCache === "CANCELLED") return ["已取消", "muted"];
  if (o.confirmation === "PENDING") return ["待確認", "warn"];
  if (o.statusCache === "COMPLETED") return ["完成", "muted"];
  const owe = o.balanceCache > 0 ? "・還沒付清" : "";
  if (ready) return [`可以出貨${owe}`, "good"];
  if (o.shipStatusCache === "SHIPPED" || o.shipStatusCache === "DELIVERED") return [`${o.shipStatusCache === "DELIVERED" ? "已取貨" : "已出貨"}${owe}`, "neutral"];
  if (o.shipStatusCache === "PARTIAL") return [`出了一部分${owe}`, "neutral"];
  return [`等貨中${owe}`, "neutral"];
}
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
  // 首頁待辦直接帶過來的清單：到貨了可以出貨的、還沒收齊錢的（勾好可以一次出貨、一次收款）
  // 可以出貨的單：上面的快捷分頁要算數量、列表上要標「可出貨」，所以每次都算（跟首頁同一套）
  const readyAll = await tx((t) => readyToShip(t, { owner: vk }));
  const readySet = new Set(readyAll.orderIds);
  const ready = sp.ready === "1" ? readyAll : null;
  const where: Prisma.OrderWhereInput = {
    AND: [mineWhere, ...(ready ? [{ id: { in: ready.orderIds } }] : []), ...(sp.due === "1" ? [{ confirmation: "CONFIRMED" as const, balanceCache: { gt: 0 } }] : [])],
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
    // 已取消的平常不列（對帳、出貨看不到）；訂單狀態選「已取消」才看得到
    ...(sp.status ? { statusCache: sp.status as never } : { statusCache: { not: "CANCELLED" as const } }),
    ...(sp.payment ? { paymentStatusCache: sp.payment as never } : {}),
    ...(sp.ship ? { shipStatusCache: sp.ship as never } : {}),
    ...(sp.groupBuyId ? { groupBuyId: sp.groupBuyId } : {}),
    ...(sp.buyerId ? { buyerId: sp.buyerId } : {}),
    ...(sp.source ? { source: sp.source as never } : {}),
    ...(sp.categoryId ? { items: { some: { categoryId: sp.categoryId } } } : {}),
    ...(sp.from || sp.to ? { orderedAt: { ...(sp.from ? { gte: new Date(`${sp.from}T00:00:00+08:00`) } : {}), ...(sp.to ? { lt: new Date(new Date(`${sp.to}T00:00:00+08:00`).getTime() + 86400000) } : {}) } } : {}),
  };
  const orderBy: Prisma.OrderOrderByWithRelationInput =
    sp.sort === "old" ? { orderedAt: "asc" } : sp.sort === "balance" ? { balanceCache: "desc" } : sp.sort === "amount" ? { receivableCache: "desc" } : sp.sort === "amountAsc" ? { receivableCache: "asc" } : { orderedAt: "desc" };
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
  const shipMethods = (await listShippingMethods(prisma)).map((m) => m.name);
  const dueN = await prisma.order.count({ where: { AND: [mineWhere], confirmation: "CONFIRMED", balanceCache: { gt: 0 }, statusCache: { not: "CANCELLED" } } });
  const unassignedN = vk || onlyUnassigned ? await prisma.order.count({ where: unassignedWhere }) : 0;
  // 最常看的幾種一下就切（手機、電腦都在最上面）：要做事的放前面，數字是現在有幾張
  const quick: [string, string, boolean][] = [
    ["全部", "/orders", !sp.payment && !sp.status && !sp.ready && !sp.due],
    [`可以出貨 ${readyAll.orderIds.length}`, "/orders?ready=1", sp.ready === "1"],
    [`還沒收齊錢 ${dueN}`, "/orders?due=1", sp.due === "1" && !sp.ready],
    [`待確認 ${pendingN}`, "/orders?status=PENDING_CONFIRM", sp.status === "PENDING_CONFIRM" && !sp.payment],
  ];
  const base = `/orders${qs({ ...sp, page: undefined })}`;
  return (
    <div>
      <PageHeader
        title="訂單"
        actions={
          <>
            <LinkButton href="/paste">貼上加單</LinkButton>
            <LinkButton href="/orders/new" primary>新增訂單</LinkButton>
          </>
        }
      />
      {onlyUnassigned ? (
        <div className="mb-3 rounded-xl border border-tone-amber-300-2 bg-warn-soft px-3 py-2 text-[14px] text-warn" data-testid="orders-unassigned-list">
          只列還沒分是跟誰訂的 {unassignedN} 張（含待確認、已經給了的）。勾選後在下面選「分給誰」。已經給了的會照扣到誰的貨自動分。
          <Link href="/orders" className="ml-1 font-semibold text-ai underline">看全部訂單</Link>
        </div>
      ) : unassignedN > 0 ? (
        <div className="mb-3" data-testid="orders-unassigned">
          <AssignAll n={unassignedN} unit="張以前記的訂單" operators={view.ops} acting={vk ?? ""} counted={false} moreHref="/orders?unassigned=1" />
        </div>
      ) : null}
      {(ready || sp.due === "1") && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ai-soft bg-ai-soft px-3 py-2.5 text-[14px]" data-testid="orders-focus">
          <span>
            {ready ? <>到貨了可以出貨的訂單 <b>{ready.orderIds.length}</b> 張（{ready.qty} 件）：按「全部出貨」一次出，同一位客人會併成一包；只出幾張就勾選後按下面的「出貨」。</> : <>還沒收齊錢的訂單：按「這頁全部收款」每張的待收一次記好；只收幾張就勾選後按下面的「收款」。</>}
          </span>
          <span className="flex items-center gap-3">
            {ready ? <BulkShip ids={ready.orderIds} methods={shipMethods} label="全部出貨" primary /> : <BulkPay ids={orders.filter((o) => o.balanceCache > 0).map((o) => o.id)} label="這頁全部收款" primary />}
            <Link href="/orders" className="text-ai underline">看全部訂單</Link>
          </span>
        </div>
      )}
      <Section pad={false}>
        <nav aria-label="快捷篩選" className="flex gap-1.5 overflow-x-auto border-b border-line-2 px-4 py-2.5" data-testid="orders-quick">
          {quick.map(([l, h, on]) => (
            <Link key={h} href={h} aria-current={on ? "page" : undefined} className={`flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-[13.5px] transition-colors duration-150 ${on ? "border-ai bg-ai font-medium text-on-fill" : "border-line bg-card text-ink-2 hover:bg-line-2"}`}>{l}</Link>
          ))}
        </nav>
        <FilterBar action="/orders" collapsed>
          <FSearch data-search value={sp.q} placeholder="訂單編號、買家、商品" />
          <FSelect name="status" label="訂單狀態" value={sp.status} allLabel="全部（不含已取消）" options={Object.entries(orderStatus).map(([k, v]) => [k, v[0]])} />
          <FSelect name="payment" label="付款" value={sp.payment} options={Object.entries(paymentStatus).map(([k, v]) => [k, v[0]])} />
          <FSelect name="ship" label="出貨" value={sp.ship} options={Object.entries(shipStatus).map(([k, v]) => [k, v[0]])} />
          <FSelect name="groupBuyId" label="代購團" value={sp.groupBuyId} options={gbs.map((g) => [g.id, g.name])} />
          <FSelect name="categoryId" label="分類" value={sp.categoryId} options={cats.map((c) => [c.id, c.name])} />
          <FSelect name="source" label="來源" value={sp.source} options={Object.entries(orderSource)} />
          <label className="text-[12px] text-mute md:flex md:items-center md:gap-1.5 md:text-[13px]" data-active={sp.from ? "1" : undefined}>
            <span className="mb-0.5 block md:mb-0">起日</span>
            <input type="date" name="from" defaultValue={sp.from} className={fDateCls} />
          </label>
          <label className="text-[12px] text-mute md:flex md:items-center md:gap-1.5 md:text-[13px]" data-active={sp.to ? "1" : undefined}>
            <span className="mb-0.5 block md:mb-0">迄日</span>
            <input type="date" name="to" defaultValue={sp.to} className={fDateCls} />
          </label>
          <FSelect name="sort" label="排序" value={sp.sort} allLabel="訂購時間：新到舊" options={[["old", "訂購時間：舊到新"], ["amount", "金額：高到低"], ["amountAsc", "金額：低到高"], ["balance", "待收：多到少"]]} />
          {sp.buyerId && <input type="hidden" name="buyerId" value={sp.buyerId} />}
        </FilterBar>
        <Selection ids={orders.map((o) => o.id)}>
        <BulkBar groupBuys={gbs.filter((g) => g.status !== "CANCELLED").map((g) => ({ id: g.id, name: g.name }))} owners={onlyUnassigned ? view.ops : undefined} acting={vk ?? ""} pendingIds={orders.filter((o) => o.confirmation === "PENDING").map((o) => o.id)} methods={shipMethods} />
        {orders.length === 0 ? (
          <Empty action={<LinkButton href="/orders/new" primary>新增訂單</LinkButton>}>沒有符合條件的訂單。</Empty>
        ) : (
          <>
          {/* 手機：一筆一張卡片，不用往右拉 */}
          <ul className="space-y-2 px-3 py-2 md:hidden" data-testid="order-cards">
            {orders.map((o) => {
              const active = o.items.reduce((s, i) => s + i.qty - i.cancelledQtyCache, 0);
              return (
                <li key={o.id} className="flex gap-2.5 rounded-xl border border-line bg-card p-3" data-testid="order-card">
                  <span className="pt-0.5"><RowCheck id={o.id} label={`選取訂單 ${o.orderNo}`} /></span>
                  <div className="min-w-0 flex-1">
                  <Link href={`/orders/${o.id}`} className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15.5px] font-semibold">{o.buyer.name}</span>
                      <span className="shrink-0 text-[15px] font-semibold">
                        {o.balanceCache > 0 ? <Twd v={o.balanceCache} className="text-warn" /> : o.refundDueCache > 0 ? <span className="text-warn">應退 {o.refundDueCache.toLocaleString()}</span> : o.confirmation === "CANCELLED" ? <span className="text-mute">無</span> : <span className="text-[13px] text-good">已收齊</span>}
                      </span>
                    </div>
                    <div className="text-[12.5px] text-mute">
                      <span className="num">{o.orderNo}</span>，{fmtDate(o.orderedAt)}，{orderSource[o.source]}{o.groupBuy ? `，${o.groupBuy.name}` : ""}{o.parentOrderId ? "，追加單" : ""}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[13.5px] text-ink-2">{o.items.map((i) => `${i.productNameSnapshot}×${i.qty - i.cancelledQtyCache}`).join("、")}（共 {active} 件）</div>
                  </Link>
                  {/* 一個白話狀態＋下一步按鈕（按鈕在連結外面，按了不會跳頁） */}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {(() => { const [t, tone] = plainStatus(o, readySet.has(o.id)); return <Badge tone={tone}>{t}</Badge>; })()}
                    <RowActions id={o.id} pendingConfirm={o.confirmation === "PENDING"} ready={readySet.has(o.id)} due={o.confirmation === "CONFIRMED" && o.balanceCache > 0} methods={shipMethods} />
                  </div>
                  </div>
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
                <th>狀態</th>
                <th className="text-right">應收</th>
                <th className="text-right">待收</th>
                <th><span className="sr-only">下一步</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const active = o.items.reduce((s, i) => s + i.qty - i.cancelledQtyCache, 0);
                return (
                  <tr key={o.id}>
                    <td><RowCheck id={o.id} label={`選取訂單 ${o.orderNo}`} /></td>
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
                    <td className="whitespace-nowrap" title={`${orderStatus[o.statusCache]?.[0] ?? ""}・${paymentStatus[o.paymentStatusCache]?.[0] ?? ""}・${shipStatus[o.shipStatusCache]?.[0] ?? ""}`}>{(() => { const [t, tone] = plainStatus(o, readySet.has(o.id)); return <Badge tone={tone}>{t}</Badge>; })()}</td>
                    <td className="text-right"><Twd v={o.receivableCache} /></td>
                    <td className="text-right">{o.balanceCache > 0 ? <Twd v={o.balanceCache} className="font-medium text-warn" /> : o.refundDueCache > 0 ? <Badge tone="warn">應退 {o.refundDueCache}</Badge> : <span className="text-mute">0</span>}</td>
                    <td><RowActions id={o.id} pendingConfirm={o.confirmation === "PENDING"} ready={readySet.has(o.id)} due={o.confirmation === "CONFIRMED" && o.balanceCache > 0} methods={shipMethods} /></td>
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
      {/* 不常用的放頁尾 */}
      <div className="mt-3 flex justify-end">
        <LinkButton small href={`/api/export/orders${qs({ groupBuyId: sp.groupBuyId, buyerId: sp.buyerId, status: sp.status, payment: sp.payment })}`}>匯出 Excel</LinkButton>
      </div>
    </div>
  );
}
