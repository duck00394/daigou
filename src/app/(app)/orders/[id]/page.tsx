import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { loadOrderCalc } from "@/server/services/recompute";
import { inventorySummary } from "@/server/services/inventory";
import { PageHeader, Section, TableWrap, StatusBadge, Twd, Badge, TagChip, KV, LinkButton, Empty } from "@/components/ui";
import { CancelOrderButton, ConfirmOrderButton, EditMetaButton, ItemActions, FlagSelect, ReserveButtons, PaymentForm, VoidPaymentButton, RefundForm, RefundRowActions } from "./parts";
import { fmtDate, orderStatus, paymentStatus, procurementStatus, shipStatus, orderSource, refundStatus, flagLabel } from "@/lib/labels";

const EVENT: Record<string, string> = {
  CREATED: "建立",
  APPENDED: "追加",
  QTY_CHANGED: "增加數量",
  PRICE_CHANGED: "修改單價",
  DISCOUNT_CHANGED: "修改折扣",
  PURCHASE_FLAG: "採購狀態",
  PACK_FLAG: "備貨狀態",
  CANCELLED: "取消",
  RESERVED: "保留庫存",
  UNRESERVED: "取消保留",
  SHIPPED: "出貨",
  CATEGORY_CHANGED: "修改歸屬分類",
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      buyer: { include: { tags: { where: { removedAt: null }, include: { tag: true } } } },
      groupBuy: true,
      parentOrder: { select: { id: true, orderNo: true } },
      appendOrders: { select: { id: true, orderNo: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          category: true,
          product: { include: { categories: { include: { category: true } } } },
          events: { orderBy: { createdAt: "asc" } },
          cancellations: { orderBy: { cancelledAt: "asc" } },
          shipmentItems: { include: { shipment: true } },
        },
      },
      payments: { orderBy: { paidAt: "asc" } },
      refunds: { orderBy: { requestedAt: "asc" } },
    },
  });
  if (!order) notFound();
  const [{ result: r }, inv, groupBuys, audits] = await Promise.all([
    tx((t) => loadOrderCalc(t, id)),
    tx((t) => inventorySummary(t, order.items.map((i) => i.productId))),
    prisma.groupBuy.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.auditLog.findMany({ where: { entity: "Order", entityId: id }, orderBy: { createdAt: "asc" } }),
  ]);
  const cancelled = order.confirmation === "CANCELLED";
  const shipments = new Map<string, { no: string; at: Date; method: string | null; tracking: string | null; status: string; lines: string[] }>();
  for (const it of order.items)
    for (const si of it.shipmentItems) {
      const s = shipments.get(si.shipmentId) ?? { no: si.shipment.shipmentNo, at: si.shipment.shippedAt, method: si.shipment.method, tracking: si.shipment.trackingNo, status: si.shipment.status, lines: [] };
      s.lines.push(`${it.productNameSnapshot} × ${si.qty}`);
      shipments.set(si.shipmentId, s);
    }
  const history = [
    ...order.items.flatMap((it) => it.events.map((e) => ({ at: e.createdAt, text: `${it.productNameSnapshot}：${EVENT[e.type] ?? e.type}${e.qtyDelta ? `（${e.qtyDelta > 0 ? "+" : ""}${e.qtyDelta}）` : ""}${e.fromValue || e.toValue ? ` ${flagLabel(e.fromValue)} → ${flagLabel(e.toValue)}` : ""}${e.note ? `｜${e.note}` : ""}` }))),
    ...audits.filter((a) => a.action === "order.update").map((a) => ({ at: a.createdAt, text: `修改訂單：${Object.keys((a.data ?? {}) as object).join("、")}` })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="space-y-4">
      <PageHeader
        title={`訂單 ${order.orderNo}`}
        back={{ href: "/orders", label: "訂單" }}
        sub={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge map={orderStatus} value={order.statusCache} />
            <StatusBadge map={paymentStatus} value={order.paymentStatusCache} />
            <StatusBadge map={shipStatus} value={order.shipStatusCache} />
            <span>｜{orderSource[order.source]}｜{fmtDate(order.orderedAt, true)}</span>
          </span>
        }
        actions={
          !cancelled && (
            <>
              {order.confirmation === "PENDING" && <ConfirmOrderButton orderId={id} />}
              <LinkButton href={`/orders/new?buyerId=${order.buyerId}`}>追加商品</LinkButton>
              <CancelOrderButton orderId={id} orderNo={order.orderNo} />
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
        <Section title="買家與訂單資料">
          <KV
            items={[
              [
                "買家",
                <span key="b" className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/buyers/${order.buyer.id}`} className="font-medium text-ai hover:underline">
                    {order.buyer.name}
                  </Link>
                  <span className="text-[12px] text-mute">{order.buyer.code}</span>
                  {order.buyer.tags.map((t) => (
                    <TagChip key={t.id} name={t.tag.name} color={t.tag.color} />
                  ))}
                </span>,
              ],
              ["代購團", order.groupBuy?.name ?? "—"],
              ["來源訂單編號", order.externalRef],
              ["原訂單", order.parentOrder ? <Link key="p" className="text-ai hover:underline" href={`/orders/${order.parentOrder.id}`}>{order.parentOrder.orderNo}</Link> : null],
              ["追加訂單", order.appendOrders.length ? order.appendOrders.map((o) => <Link key={o.id} className="mr-2 text-ai hover:underline" href={`/orders/${o.id}`}>{o.orderNo}</Link>) : null],
              ["取消", cancelled ? `${fmtDate(order.cancelledAt, true)}${order.cancelReason ? `｜${order.cancelReason}` : ""}` : null],
              ["備註", order.notes],
            ]}
          />
          {!cancelled && (
            <div className="mt-3">
              <EditMetaButton orderId={id} shippingFee={order.shippingFee} orderDiscount={order.orderDiscount} notes={order.notes} groupBuyId={order.groupBuyId} groupBuys={groupBuys.map((g) => ({ id: g.id, name: g.name }))} />
            </div>
          )}
        </Section>
        <Section title="金額">
          <dl className="space-y-1 text-sm">
            {[
              ["商品淨額", r.goodsNet],
              ["整單折扣", -r.orderDiscountEffective],
              ["運費", r.shippingFeeEffective],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between">
                <dt className="text-mute">{k}</dt>
                <dd><Twd v={v as number} /></dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-line-2 pt-1.5 font-semibold">
              <dt>應收</dt>
              <dd><Twd v={r.receivable} /></dd>
            </div>
            <div className="flex justify-between"><dt className="text-mute">已收</dt><dd><Twd v={r.paid} /></dd></div>
            <div className="flex justify-between"><dt className="text-mute">已退款</dt><dd><Twd v={r.refunded} /></dd></div>
            {r.refundPending > 0 && <div className="flex justify-between"><dt className="text-mute">退款處理中</dt><dd><Twd v={r.refundPending} /></dd></div>}
            <div className="flex justify-between border-t border-line-2 pt-1.5 font-semibold">
              <dt>待收</dt>
              <dd><Twd v={r.balance} className={r.balance > 0 ? "text-bad" : ""} /></dd>
            </div>
            {r.refundDue > 0 && (
              <div className="flex justify-between font-semibold text-bad">
                <dt>應退給買家</dt>
                <dd><Twd v={r.refundDue} /></dd>
              </div>
            )}
          </dl>
          {r.refundUnscheduled > 0 && <p className="mt-2 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">已收超過應收 {r.refundUnscheduled.toLocaleString()} 元，尚未建立退款紀錄。</p>}
        </Section>
      </div>

      <Section title="商品明細" pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>商品</th>
              <th className="text-right">訂購</th>
              <th className="text-right">取消</th>
              <th className="text-right">有效</th>
              <th className="text-right">單價</th>
              <th className="text-right">小計</th>
              <th>採購／到貨</th>
              <th>備貨／出貨</th>
              <th className="text-right">已保留</th>
              <th className="text-right">已出貨</th>
              <th className="text-right">待出貨</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it, idx) => {
              const ri = r.items[idx];
              const reserved = it.reservedQtyCache;
              const shipped = it.shippedQtyCache;
              const need = Math.max(0, ri.activeQty - shipped - reserved);
              const available = inv.get(it.productId)?.available ?? 0;
              return (
                <tr key={it.id} className={ri.activeQty === 0 ? "opacity-60" : ""}>
                  <td className="min-w-[12rem]">
                    <Link href={`/products/${it.productId}`} className="font-medium hover:underline">{it.productNameSnapshot}</Link>
                    {it.addedLater && <span className="ml-1"><Badge tone="info">追加</Badge></span>}
                    <div className="text-[12px] text-mute">
                      {it.specNote ? `${it.specNote}｜` : ""}歸屬：{it.category?.name ?? "未歸類"}
                      {it.lineDiscount ? `｜折扣 ${it.lineDiscount}` : ""}
                    </div>
                    {it.cancellations.length > 0 && (
                      <div className="text-[12px] text-bad">
                        {it.cancellations.map((c) => `${fmtDate(c.cancelledAt)} 取消 ${c.qty} 件${c.reason ? `（${c.reason}）` : ""}`).join("；")}
                      </div>
                    )}
                  </td>
                  <td className="num text-right">{it.qty}</td>
                  <td className="num text-right">{it.cancelledQtyCache || ""}</td>
                  <td className="num text-right font-medium">{ri.activeQty}</td>
                  <td className="text-right"><Twd v={it.unitPrice} /></td>
                  <td className="text-right"><Twd v={ri.lineNet} /></td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge map={procurementStatus} value={ri.procurementStatus} />
                      {ri.activeQty > 0 && ri.procurementStatus !== "ARRIVED" && !cancelled && <FlagSelect itemId={it.id} kind="purchase" value={it.purchaseFlag} disabled={false} />}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge map={shipStatus} value={ri.shipStatus} />
                      {ri.pendingShipQty > 0 && !cancelled && <FlagSelect itemId={it.id} kind="pack" value={it.packFlag} disabled={false} />}
                    </div>
                  </td>
                  <td className="num text-right">{reserved}</td>
                  <td className="num text-right">{shipped}</td>
                  <td className="num text-right font-medium">{ri.pendingShipQty}</td>
                  <td>
                    {!cancelled && (
                      <div className="flex flex-col gap-1">
                        <ItemActions
                          disabled={false}
                          item={{ id: it.id, name: it.productNameSnapshot, qty: it.qty, cancelled: it.cancelledQtyCache, shipped, reserved, unitPrice: it.unitPrice, lineDiscount: it.lineDiscount, categoryId: it.categoryId, specNote: it.specNote }}
                          categories={it.product.categories.map((c) => c.category)}
                        />
                        <ReserveButtons itemId={it.id} need={need} reserved={reserved} available={available} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="收款紀錄" pad={false}>
          {order.payments.length === 0 ? (
            <Empty>尚未收款。</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>時間</th>
                  <th className="text-right">金額</th>
                  <th>方式</th>
                  <th>識別／備註</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {order.payments.map((p) => (
                  <tr key={p.id} className={p.voidedAt ? "text-mute line-through" : ""}>
                    <td className="num whitespace-nowrap">{fmtDate(p.paidAt, true)}</td>
                    <td className="text-right"><Twd v={p.amount} /></td>
                    <td>{p.method}</td>
                    <td className="text-[13px]">{[p.reference, p.note, p.voidedAt ? `已作廢：${p.voidReason}` : null].filter(Boolean).join("｜")}</td>
                    <td>{!p.voidedAt && <VoidPaymentButton id={p.id} amount={p.amount} />}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          {!cancelled && (
            <div className="border-t border-line-2 p-4">
              <PaymentForm orderId={id} balance={r.balance} />
            </div>
          )}
        </Section>
        <Section title="退款紀錄" pad={false} actions={<RefundForm orderId={id} suggested={r.refundUnscheduled} max={r.paid - r.refunded - r.refundPending} />}>
          {order.refunds.length === 0 ? (
            <Empty>沒有退款紀錄。</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>建立</th>
                  <th className="text-right">金額</th>
                  <th>狀態</th>
                  <th>原因</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {order.refunds.map((x) => (
                  <tr key={x.id}>
                    <td className="num whitespace-nowrap">
                      {fmtDate(x.requestedAt)}
                      {x.completedAt && <div className="text-[12px] text-mute">完成 {fmtDate(x.completedAt)}</div>}
                    </td>
                    <td className="text-right"><Twd v={x.amount} /></td>
                    <td><StatusBadge map={refundStatus} value={x.status} /></td>
                    <td className="text-[13px]">{[x.reason, x.method, x.note].filter(Boolean).join("｜")}</td>
                    <td><RefundRowActions id={x.id} status={x.status} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="出貨紀錄" pad={false}>
          {shipments.size === 0 ? (
            <Empty>尚未出貨。</Empty>
          ) : (
            <ul className="divide-y divide-line-2 text-sm">
              {[...shipments.entries()].map(([sid, s]) => (
                <li key={sid} className="px-4 py-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="num font-medium">{s.no}</span>
                    <span className="num text-mute">{fmtDate(s.at, true)}</span>
                  </div>
                  <div className="text-[13px] text-ink-2">
                    {s.method ?? "未填配送方式"}
                    {s.tracking ? `｜單號 ${s.tracking}` : ""}｜{s.status === "DELIVERED" ? "已送達" : "已出貨"}
                  </div>
                  <div className="text-[13px]">{s.lines.join("、")}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="修改與追加紀錄" pad={false}>
          <ul className="max-h-80 divide-y divide-line-2 overflow-y-auto text-[13px]">
            {history.map((h, i) => (
              <li key={i} className="flex gap-3 px-4 py-1.5">
                <span className="num shrink-0 text-mute">{fmtDate(h.at, true)}</span>
                <span>{h.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {order.rawInput && (
        <Section title="原始輸入資料">
          <pre className="max-h-60 overflow-auto rounded-lg bg-line-2 p-3 text-[13px] whitespace-pre-wrap">{order.rawInput}</pre>
        </Section>
      )}
    </div>
  );
}
