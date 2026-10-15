import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { receivablesSnapshot } from "@/server/services/reports";
import { PageHeader, Section, TableWrap, Twd, Empty, Stat, StatusBadge, LinkButton } from "@/components/ui";
import { FilterBar, FSearch, FSelect } from "@/components/filters";
import { CollectForBuyer } from "./parts";
import { RefundRowActions } from "../orders/[id]/parts";
import { fmtDate, paymentStatus, refundStatus } from "@/lib/labels";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "收款與退款" };

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? "due";
  const snap = await receivablesSnapshot(prisma);
  const gbs = await prisma.groupBuy.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-4">
      <PageHeader title="收款與退款" sub="已收、已退款、待收、待退款分開計算；待退款在實際退出前不算已退款。" actions={<LinkButton href="/api/export/payments">匯出收退款紀錄</LinkButton>} />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Stat label="應收合計" value={<Twd v={snap.receivable} />} note="已確認訂單" />
        <Stat label="淨收款（已收 − 已退）" value={<Twd v={snap.netReceived} />} />
        <Stat label="待收款" value={<Twd v={snap.balance} />} tone={snap.balance > 0 ? "warn" : undefined} />
        <Stat label="應退款" value={<Twd v={snap.refundDue} />} tone={snap.refundDue > 0 ? "bad" : undefined} />
        <Stat label="退款處理中" value={<Twd v={snap.refundPending} />} />
      </div>
      <nav className="flex gap-1" aria-label="分頁">
        {[["due", "待收款"], ["refunds", "退款"], ["records", "收款紀錄"]].map(([k, l]) => (
          <Link key={k} href={`/payments?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-ink text-white" : "bg-white text-ink-2 hover:bg-line-2"}`}>{l}</Link>
        ))}
      </nav>
      {tab === "due" && <DueTab sp={sp} gbs={gbs} />}
      {tab === "refunds" && <RefundTab />}
      {tab === "records" && <RecordsTab sp={sp} />}
    </div>
  );
}

async function DueTab({ sp, gbs }: { sp: Record<string, string | undefined>; gbs: { id: string; name: string }[] }) {
  const where: Prisma.OrderWhereInput = {
    confirmation: "CONFIRMED",
    balanceCache: { gt: 0 },
    ...(sp.groupBuyId ? { groupBuyId: sp.groupBuyId } : {}),
    ...(sp.payment ? { paymentStatusCache: sp.payment as never } : {}),
    ...(sp.q ? { buyer: { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { lineName: { contains: sp.q, mode: "insensitive" } }] } } : {}),
  };
  const orders = await prisma.order.findMany({ where, orderBy: { orderedAt: "asc" }, include: { buyer: { select: { id: true, name: true, code: true } }, groupBuy: { select: { name: true } } } });
  const byBuyer = new Map<string, { buyer: { id: string; name: string; code: string }; orders: typeof orders; due: number }>();
  for (const o of orders) {
    const g = byBuyer.get(o.buyerId) ?? { buyer: o.buyer, orders: [], due: 0 };
    g.orders.push(o);
    g.due += o.balanceCache;
    byBuyer.set(o.buyerId, g);
  }
  return (
    <Section pad={false}>
      <FilterBar action="/payments">
        <input type="hidden" name="tab" value="due" />
        <FSearch data-search value={sp.q} placeholder="買家名稱" />
        <FSelect name="groupBuyId" label="代購團" value={sp.groupBuyId} options={gbs.map((g) => [g.id, g.name])} />
        <FSelect name="payment" label="付款狀態" value={sp.payment} options={[["UNPAID", "未付款"], ["PARTIAL", "部分付款"], ["PARTIALLY_REFUNDED", "部分退款"]]} />
      </FilterBar>
      {byBuyer.size === 0 ? (
        <Empty>沒有待收款的訂單。</Empty>
      ) : (
        <ul className="divide-y divide-line-2">
          {[...byBuyer.values()].sort((a, b) => b.due - a.due).map((g) => (
            <li key={g.buyer.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/buyers/${g.buyer.id}?tab=money`} className="font-medium text-ai hover:underline">{g.buyer.name}</Link>
                <span className="flex items-center gap-3">
                  <span className="text-sm">待收 <Twd v={g.due} className="font-semibold text-bad" /></span>
                  <CollectForBuyer buyerId={g.buyer.id} buyerName={g.buyer.name} due={g.due} />
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-[13px]">
                {g.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/orders/${o.id}`} className="num text-ai hover:underline">{o.orderNo}</Link>
                    <span className="text-mute">{fmtDate(o.orderedAt)}{o.groupBuy ? `｜${o.groupBuy.name}` : ""}</span>
                    <StatusBadge map={paymentStatus} value={o.paymentStatusCache} />
                    <span>應收 <Twd v={o.receivableCache} />，已收 <Twd v={o.paidCache - o.refundedCache} />，待收 <Twd v={o.balanceCache} /></span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

async function RefundTab() {
  const [pending, unscheduled] = await Promise.all([
    prisma.refund.findMany({ where: { status: "PENDING" }, orderBy: { requestedAt: "asc" }, include: { order: { include: { buyer: true } } } }),
    prisma.order.findMany({ where: { refundDueCache: { gt: 0 } }, include: { buyer: true }, orderBy: { updatedAt: "desc" } }),
  ]);
  const needRecord = unscheduled.filter((o) => o.refundDueCache > o.refundPendingCache);
  return (
    <div className="space-y-4">
      <Section title={`退款處理中（${pending.length}）`} pad={false}>
        {pending.length === 0 ? <Empty>沒有待執行的退款。</Empty> : (
          <TableWrap>
            <thead><tr><th>建立日期</th><th>訂單</th><th>買家</th><th className="text-right">金額</th><th>原因</th><th></th></tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td className="num">{fmtDate(r.requestedAt)}</td>
                  <td><Link href={`/orders/${r.orderId}`} className="num text-ai hover:underline">{r.order.orderNo}</Link></td>
                  <td>{r.order.buyer.name}</td>
                  <td className="text-right"><Twd v={r.amount} /></td>
                  <td>{r.reason}</td>
                  <td><RefundRowActions id={r.id} status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
      <Section title={`溢收、尚未建立退款（${needRecord.length}）`} pad={false}>
        {needRecord.length === 0 ? <Empty>沒有需要建立退款的訂單。</Empty> : (
          <ul className="divide-y divide-line-2 text-sm">
            {needRecord.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span><Link href={`/orders/${o.id}`} className="num text-ai hover:underline">{o.orderNo}</Link>｜{o.buyer.name}</span>
                <span>需退 <Twd v={o.refundDueCache - o.refundPendingCache} className="font-medium text-bad" />（到訂單頁建立退款）</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="text-[12px] text-mute">已退款的紀錄（{refundStatus.COMPLETED[0]}）可在「收款紀錄」或匯出檔查看。</p>
    </div>
  );
}

async function RecordsTab({ sp }: { sp: Record<string, string | undefined> }) {
  const from = sp.from ? new Date(`${sp.from}T00:00:00+08:00`) : new Date(Date.now() - 30 * 86400000);
  const to = sp.to ? new Date(new Date(`${sp.to}T00:00:00+08:00`).getTime() + 86400000) : new Date(Date.now() + 86400000);
  const [pays, refs] = await Promise.all([
    prisma.payment.findMany({ where: { paidAt: { gte: from, lt: to } }, orderBy: { paidAt: "desc" }, include: { order: { include: { buyer: true } } } }),
    prisma.refund.findMany({ where: { status: "COMPLETED", completedAt: { gte: from, lt: to } }, orderBy: { completedAt: "desc" }, include: { order: { include: { buyer: true } } } }),
  ]);
  const rows = [
    ...pays.map((p) => ({ id: p.id, at: p.paidAt, kind: "收款", orderId: p.orderId, orderNo: p.order.orderNo, buyer: p.order.buyer.name, amount: p.amount, info: [p.method, p.reference, p.note].filter(Boolean).join("｜"), voided: !!p.voidedAt })),
    ...refs.map((r) => ({ id: r.id, at: r.completedAt!, kind: "退款", orderId: r.orderId, orderNo: r.order.orderNo, buyer: r.order.buyer.name, amount: -r.amount, info: [r.method, r.reason].filter(Boolean).join("｜"), voided: false })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const net = rows.filter((r) => !r.voided).reduce((s, r) => s + r.amount, 0);
  return (
    <Section pad={false} title={`期間淨收款：NT$${net.toLocaleString()}`}>
      <form method="get" className="flex flex-wrap items-end gap-2 border-b border-line-2 px-4 py-3">
        <input type="hidden" name="tab" value="records" />
        <label className="text-[12px] text-mute">起日<input type="date" name="from" defaultValue={sp.from} className="mt-0.5 block rounded-lg border border-line px-2 py-2" /></label>
        <label className="text-[12px] text-mute">迄日<input type="date" name="to" defaultValue={sp.to} className="mt-0.5 block rounded-lg border border-line px-2 py-2" /></label>
        <button className="rounded-lg border border-ai bg-ai px-3 py-2 text-sm text-white">套用</button>
        <span className="text-[12px] text-mute">預設顯示最近 30 天</span>
      </form>
      {rows.length === 0 ? <Empty>期間內沒有紀錄。</Empty> : (
        <TableWrap>
          <thead><tr><th>時間</th><th>類型</th><th>訂單</th><th>買家</th><th className="text-right">金額</th><th>說明</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.voided ? "text-mute line-through" : ""}>
                <td className="num whitespace-nowrap">{fmtDate(r.at, true)}</td>
                <td>{r.kind}{r.voided ? "（作廢）" : ""}</td>
                <td><Link href={`/orders/${r.orderId}`} className="num text-ai hover:underline">{r.orderNo}</Link></td>
                <td>{r.buyer}</td>
                <td className="text-right"><Twd v={r.amount} className={r.amount < 0 ? "text-bad" : ""} /></td>
                <td className="text-[13px]">{r.info}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Section>
  );
}
