import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section, TableWrap, Twd, Empty, Stat, StatusBadge, LinkButton, Badge } from "@/components/ui";
import { BuyerFormView, BuyerAliases, TagManager, IncidentForm, MergeButton } from "../forms";
import { fmtDate, incidentKind, orderStatus, paymentStatus, shipStatus, procurementStatus, refundStatus } from "@/lib/labels";

const TABS = [
  ["overview", "總覽"],
  ["orders", "訂單"],
  ["items", "商品與出貨"],
  ["money", "付款與退款"],
  ["history", "取消、追加與紀錄"],
  ["profile", "基本資料"],
] as const;

export default async function BuyerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireUser();
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const b = await prisma.buyer.findUnique({
    where: { id },
    include: {
      aliases: { orderBy: { createdAt: "asc" } },
      tags: { include: { tag: true }, orderBy: { createdAt: "desc" } },
      mergedInto: { select: { id: true, name: true } },
      mergedFrom: { select: { id: true, name: true, code: true } },
      incidents: { orderBy: { occurredAt: "desc" } },
    },
  });
  if (!b) notFound();
  const [orders, items, payments, refunds, cancellations, tagsAll, events] = await Promise.all([
    prisma.order.findMany({ where: { buyerId: id }, orderBy: { orderedAt: "desc" }, include: { groupBuy: { select: { name: true } }, items: { select: { productNameSnapshot: true, qty: true, cancelledQtyCache: true } } } }),
    prisma.orderItem.findMany({ where: { order: { buyerId: id } }, orderBy: { createdAt: "desc" }, include: { order: { select: { id: true, orderNo: true, orderedAt: true, confirmation: true } } } }),
    prisma.payment.findMany({ where: { order: { buyerId: id } }, orderBy: { paidAt: "desc" }, include: { order: { select: { id: true, orderNo: true } } } }),
    prisma.refund.findMany({ where: { order: { buyerId: id } }, orderBy: { requestedAt: "desc" }, include: { order: { select: { id: true, orderNo: true } } } }),
    prisma.orderCancellation.findMany({ where: { orderItem: { order: { buyerId: id } } }, orderBy: { cancelledAt: "desc" }, include: { orderItem: { include: { order: { select: { id: true, orderNo: true } } } }, refunds: true } }),
    prisma.tag.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.orderItemEvent.findMany({ where: { orderItem: { order: { buyerId: id } }, type: { in: ["APPENDED", "QTY_CHANGED", "PRICE_CHANGED", "DISCOUNT_CHANGED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 100, include: { orderItem: { select: { productNameSnapshot: true, order: { select: { id: true, orderNo: true } } } } } }),
  ]);

  const confirmed = orders.filter((o) => o.confirmation === "CONFIRMED");
  const cancelledOrders = orders.filter((o) => o.statusCache === "CANCELLED");
  const activeItems = items.filter((i) => i.order.confirmation === "CONFIRMED" && i.qty - i.cancelledQtyCache > 0);
  const pendingShip = activeItems.reduce((s, i) => s + Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache), 0);
  const shipped = activeItems.reduce((s, i) => s + i.shippedQtyCache, 0);
  const balance = confirmed.reduce((s, o) => s + o.balanceCache, 0);
  const refundDue = orders.reduce((s, o) => s + o.refundDueCache, 0);
  const receivable = confirmed.reduce((s, o) => s + o.receivableCache, 0);

  const timeline = [
    ...orders.map((o) => ({ at: o.orderedAt, text: `建立訂單 ${o.orderNo}（${o.items.map((i) => `${i.productNameSnapshot}×${i.qty}`).join("、")}）`, href: `/orders/${o.id}` })),
    ...payments.map((p) => ({ at: p.paidAt, text: `${p.voidedAt ? "（已作廢）" : ""}收款 NT$${p.amount.toLocaleString()}｜${p.order.orderNo}`, href: `/orders/${p.order.id}` })),
    ...refunds.map((r) => ({ at: r.completedAt ?? r.requestedAt, text: `退款 NT$${r.amount.toLocaleString()}（${refundStatus[r.status][0]}）｜${r.order.orderNo}`, href: `/orders/${r.order.id}` })),
    ...cancellations.map((c) => ({ at: c.cancelledAt, text: `取消 ${c.orderItem.productNameSnapshot} ${c.qty} 件｜${c.orderItem.order.orderNo}${c.reason ? `｜${c.reason}` : ""}`, href: `/orders/${c.orderItem.order.id}` })),
    ...b.incidents.map((x) => ({ at: x.occurredAt, text: `${incidentKind[x.kind]}${x.description ? `：${x.description}` : ""}`, href: null as string | null })),
  ].sort((a, c) => c.at.getTime() - a.at.getTime());

  const tagRows = b.tags.map((t) => ({ id: t.id, name: t.tag.name + (t.tag.active ? "" : "（標籤已停用）"), color: t.tag.color, reason: t.reason, createdAt: t.createdAt.toISOString(), removedAt: t.removedAt?.toISOString() ?? null }));
  const activeTagIds = new Set(b.tags.filter((t) => !t.removedAt).map((t) => t.tagId));

  return (
    <div className="space-y-4">
      <PageHeader
        title={b.name}
        back={{ href: "/buyers", label: "買家" }}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {b.code}
            {b.lineName && <span>｜LINE：{b.lineName}</span>}
            {b.tags.filter((t) => !t.removedAt).map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[12px] text-ink">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: t.tag.color }} />
                {t.tag.name}
              </span>
            ))}
            {b.mergedInto && <Badge tone="warn">已合併到 {b.mergedInto.name}</Badge>}
          </span>
        }
        actions={
          !b.mergedIntoId && (
            <>
              <LinkButton href={`/orders/new?buyerId=${b.id}`} primary>新增訂單</LinkButton>
              <MergeButton sourceId={b.id} sourceName={b.name} />
            </>
          )
        }
      />
      {b.mergedInto && (
        <p className="rounded-lg bg-warn-soft px-4 py-2 text-sm">
          這位買家已合併，請到 <Link href={`/buyers/${b.mergedInto.id}`} className="text-ai underline">{b.mergedInto.name}</Link> 查看完整紀錄。
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="有效訂單" value={confirmed.filter((o) => o.statusCache !== "CANCELLED").length} />
        <Stat label="已取消訂單" value={cancelledOrders.length} />
        <Stat label="累計應收" value={<Twd v={receivable} />} />
        <Stat label="待收款" value={<Twd v={balance} />} tone={balance > 0 ? "warn" : undefined} />
        <Stat label="待出貨件數" value={pendingShip} />
        <Stat label="已出貨件數" value={shipped} />
      </div>
      {refundDue > 0 && <p className="rounded-lg bg-bad-soft px-4 py-2 text-sm text-bad">需退還這位買家 NT${refundDue.toLocaleString()}。</p>}

      <nav aria-label="買家資料分頁" className="no-print -mx-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/buyers/${id}?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-ink text-white" : "bg-white text-ink-2 hover:bg-line-2"}`}>
            {l}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <div className="space-y-4">
            <Section title="標籤（內部提醒）">
              <TagManager buyerId={id} tags={tagRows} available={tagsAll.filter((t) => !activeTagIds.has(t.id))} />
            </Section>
            <Section title="內部備註">
              <p className="text-sm whitespace-pre-wrap">{b.notes ?? <span className="text-mute">沒有備註。</span>}</p>
            </Section>
            <Section title="別名">
              <BuyerAliases buyerId={id} aliases={b.aliases} />
            </Section>
          </div>
          <Section title="交易履歷" pad={false}>
            {timeline.length === 0 ? (
              <Empty>還沒有交易紀錄。</Empty>
            ) : (
              <ol className="max-h-[36rem] divide-y divide-line-2 overflow-y-auto text-sm">
                {timeline.map((t, i) => (
                  <li key={i} className="flex gap-3 px-4 py-2">
                    <span className="num w-24 shrink-0 text-mute">{fmtDate(t.at)}</span>
                    {t.href ? <Link href={t.href} className="hover:underline">{t.text}</Link> : <span>{t.text}</span>}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      )}

      {tab === "orders" && (
        <Section title={`所有訂單（${orders.length}）`} pad={false} actions={<LinkButton small href={`/api/export/orders?buyerId=${id}`}>匯出</LinkButton>}>
          {orders.length === 0 ? (
            <Empty>沒有訂單。</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>訂單</th>
                  <th>代購團</th>
                  <th>狀態</th>
                  <th>付款</th>
                  <th>出貨</th>
                  <th className="text-right">應收</th>
                  <th className="text-right">待收</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.id}`} className="num text-ai hover:underline">{o.orderNo}</Link>
                      <div className="text-[12px] text-mute">{fmtDate(o.orderedAt)}</div>
                    </td>
                    <td>{o.groupBuy?.name ?? "—"}</td>
                    <td><StatusBadge map={orderStatus} value={o.statusCache} /></td>
                    <td><StatusBadge map={paymentStatus} value={o.paymentStatusCache} /></td>
                    <td><StatusBadge map={shipStatus} value={o.shipStatusCache} /></td>
                    <td className="text-right"><Twd v={o.receivableCache} /></td>
                    <td className="text-right"><Twd v={o.balanceCache} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Section>
      )}

      {tab === "items" && (
        <div className="space-y-4">
          {(
            [
              ["待出貨商品", activeItems.filter((i) => i.shippedQtyCache === 0)],
              ["部分出貨商品", activeItems.filter((i) => i.shippedQtyCache > 0 && i.shippedQtyCache < i.qty - i.cancelledQtyCache)],
              ["已出貨商品", activeItems.filter((i) => i.shippedQtyCache >= i.qty - i.cancelledQtyCache)],
            ] as const
          ).map(([title, list]) => (
            <Section key={title} title={`${title}（${list.length}）`} pad={false}>
              {list.length === 0 ? (
                <Empty>沒有資料。</Empty>
              ) : (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>商品</th>
                      <th>訂單</th>
                      <th className="text-right">有效</th>
                      <th className="text-right">已到貨保留</th>
                      <th className="text-right">已出貨</th>
                      <th className="text-right">未出貨</th>
                      <th>到貨</th>
                      <th>出貨</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((i) => (
                      <tr key={i.id}>
                        <td>{i.productNameSnapshot}{i.specNote ? <span className="text-[12px] text-mute">｜{i.specNote}</span> : null}</td>
                        <td><Link href={`/orders/${i.order.id}`} className="num text-ai hover:underline">{i.order.orderNo}</Link></td>
                        <td className="num text-right">{i.qty - i.cancelledQtyCache}</td>
                        <td className="num text-right">{i.reservedQtyCache}</td>
                        <td className="num text-right">{i.shippedQtyCache}</td>
                        <td className="num text-right font-medium">{i.qty - i.cancelledQtyCache - i.shippedQtyCache}</td>
                        <td><StatusBadge map={procurementStatus} value={i.procurementStatusCache} /></td>
                        <td><StatusBadge map={shipStatus} value={i.shipStatusCache} /></td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </Section>
          ))}
        </div>
      )}

      {tab === "money" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="付款紀錄" pad={false}>
            {payments.length === 0 ? <Empty>沒有付款紀錄。</Empty> : (
              <TableWrap>
                <thead><tr><th>時間</th><th>訂單</th><th className="text-right">金額</th><th>方式</th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className={p.voidedAt ? "text-mute line-through" : ""}>
                      <td className="num">{fmtDate(p.paidAt, true)}</td>
                      <td><Link href={`/orders/${p.order.id}`} className="num text-ai hover:underline">{p.order.orderNo}</Link></td>
                      <td className="text-right"><Twd v={p.amount} /></td>
                      <td>{p.method}{p.reference ? `｜${p.reference}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Section>
          <Section title="退款紀錄" pad={false}>
            {refunds.length === 0 ? <Empty>沒有退款紀錄。</Empty> : (
              <TableWrap>
                <thead><tr><th>時間</th><th>訂單</th><th className="text-right">金額</th><th>狀態</th><th>原因</th></tr></thead>
                <tbody>
                  {refunds.map((r) => (
                    <tr key={r.id}>
                      <td className="num">{fmtDate(r.completedAt ?? r.requestedAt)}</td>
                      <td><Link href={`/orders/${r.order.id}`} className="num text-ai hover:underline">{r.order.orderNo}</Link></td>
                      <td className="text-right"><Twd v={r.amount} /></td>
                      <td><StatusBadge map={refundStatus} value={r.status} /></td>
                      <td>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Section>
          <Section title="待付款訂單" pad={false} className="lg:col-span-2">
            {confirmed.filter((o) => o.balanceCache > 0).length === 0 ? <Empty>沒有未結清的訂單。</Empty> : (
              <ul className="divide-y divide-line-2 text-sm">
                {confirmed.filter((o) => o.balanceCache > 0).map((o) => (
                  <li key={o.id} className="flex justify-between px-4 py-2">
                    <Link href={`/orders/${o.id}`} className="num text-ai hover:underline">{o.orderNo}</Link>
                    <span>待收 <Twd v={o.balanceCache} className="font-medium text-bad" /></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-4">
          <Section title="取消紀錄" pad={false}>
            {cancellations.length === 0 ? <Empty>沒有取消紀錄。</Empty> : (
              <TableWrap>
                <thead><tr><th>日期</th><th>訂單</th><th>商品</th><th className="text-right">數量</th><th>原因</th><th>退款處理</th></tr></thead>
                <tbody>
                  {cancellations.map((c) => {
                    const order = orders.find((o) => o.id === c.orderItem.order.id);
                    return (
                      <tr key={c.id}>
                        <td className="num">{fmtDate(c.cancelledAt)}</td>
                        <td><Link href={`/orders/${c.orderItem.order.id}`} className="num text-ai hover:underline">{c.orderItem.order.orderNo}</Link></td>
                        <td>{c.orderItem.productNameSnapshot}</td>
                        <td className="num text-right">{c.qty}</td>
                        <td>{c.reason ?? "—"}</td>
                        <td>
                          {c.refunds.length > 0
                            ? c.refunds.map((r) => `${refundStatus[r.status][0]} NT$${r.amount}`).join("、")
                            : order && order.refundDueCache > 0
                              ? <Badge tone="bad">訂單應退 NT${order.refundDueCache}</Badge>
                              : <span className="text-mute">不需退款或已併入訂單退款</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </Section>
          <Section title="追加及修改紀錄" pad={false}>
            {events.length === 0 ? <Empty>沒有追加或修改。</Empty> : (
              <ul className="divide-y divide-line-2 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3 px-4 py-2">
                    <span className="num w-32 shrink-0 text-mute">{fmtDate(e.createdAt, true)}</span>
                    <span>
                      <Link href={`/orders/${e.orderItem.order.id}`} className="num text-ai hover:underline">{e.orderItem.order.orderNo}</Link>｜{e.orderItem.productNameSnapshot}｜
                      {{ APPENDED: "追加", QTY_CHANGED: "增加數量", PRICE_CHANGED: "修改單價", DISCOUNT_CHANGED: "修改折扣", CANCELLED: "取消" }[e.type] ?? e.type}
                      {e.qtyDelta ? `（${e.qtyDelta > 0 ? "+" : ""}${e.qtyDelta}）` : ""}
                      {e.fromValue || e.toValue ? ` ${e.fromValue ?? ""} → ${e.toValue ?? ""}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="客觀交易紀錄" pad={false} actions={<IncidentForm buyerId={id} />}>
            {b.incidents.length === 0 ? <Empty>沒有紀錄。</Empty> : (
              <ul className="divide-y divide-line-2 text-sm">
                {b.incidents.map((x) => (
                  <li key={x.id} className="flex gap-3 px-4 py-2">
                    <span className="num w-24 shrink-0 text-mute">{fmtDate(x.occurredAt)}</span>
                    <span><b>{incidentKind[x.kind]}</b>{x.description ? `：${x.description}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {b.mergedFrom.length > 0 && (
            <Section title="合併進來的買家">
              <ul className="text-sm">{b.mergedFrom.map((m) => <li key={m.id}><Link href={`/buyers/${m.id}`} className="text-ai hover:underline">{m.name}（{m.code}）</Link></li>)}</ul>
            </Section>
          )}
        </div>
      )}

      {tab === "profile" && (
        <Section title="基本資料">
          <BuyerFormView id={id} initial={{ name: b.name, lineName: b.lineName, contact: b.contact, recipientName: b.recipientName, recipientPhone: b.recipientPhone, address: b.address, shippingMethod: b.shippingMethod, notes: b.notes }} />
        </Section>
      )}
    </div>
  );
}
