import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { listQuickSales } from "@/server/services/quick-sale";
import { getView } from "@/server/view";
import { OwnerBadge } from "@/components/owner-badge";
import { ownerTone } from "@/lib/owner-colors";
import { listOperators } from "@/server/services/operators";
import { JOINT, NONE } from "@/server/services/ownership";
import { PageHeader, Section, Stat, Twd, Empty, LinkButton } from "@/components/ui";
import { SellButton } from "@/components/quick-sale";
import { VoidSaleButton } from "./parts";
import { fmtDate, toDateInput } from "@/lib/labels";
import { formatTwd } from "@/lib/money";

export const metadata = { title: "出售紀錄" };

function monthRange(ym: string | undefined) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return { from: null, to: null };
  const [y, m] = ym.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1, -8)), to: new Date(Date.UTC(y, m, 1, -8)) };
}

export default async function Sales({ searchParams }: { searchParams: Promise<{ q?: string; ym?: string; voided?: string; new?: string; owner?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const thisMonth = toDateInput(new Date()).slice(0, 7);
  const ym = sp.ym === "all" ? undefined : (sp.ym ?? thisMonth);
  const { from, to } = monthRange(ym);
  const [data, buyers, operators] = await Promise.all([
    tx((t) => listQuickSales(t, { q: sp.q, from, toExclusive: to, includeVoided: sp.voided === "1" })),
    prisma.buyer.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 200, select: { name: true } }),
    tx((t) => listOperators(t, { includeInactive: true })),
  ]);
  const who = (k: string) => (k === JOINT ? "合資（還沒登記付款）" : k === NONE ? "未指定" : (operators.find((o) => o.id === k)?.name ?? "未指定"));
  const view = await getView();
  const owner = view.key === "all" ? "" : view.key; // 現在看誰的：他自己的＋合資的（錢算他那一份）
  const keys = owner ? [owner, JOINT, NONE] : [];
  const ids = operators.map((o) => o.id);
  const ownerEntries = Object.entries(data.byOwner).filter(([k, v]) => (!owner || keys.includes(k)) && (v.revenue !== 0 || (k !== JOINT && v.qty !== 0)));
  const rows = owner ? data.rows.filter((r) => r.owners.some((x) => keys.includes(x.key) && x.qty > 0)) : data.rows;
  const mine = owner ? (data.byOwner[owner] ?? { qty: 0, revenue: 0, cost: 0 }) : null;
  const total = mine ? { count: rows.filter((r) => !r.voided).length, qty: mine.qty, revenue: mine.revenue, cost: mine.cost, profit: mine.revenue - mine.cost, tentative: data.total.tentative } : data.total;
  const chip = (on: boolean) => `shrink-0 rounded-full border px-3 py-1.5 text-sm ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`;
  const href = (o: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const v = { q: sp.q, ym: sp.ym, voided: sp.voided, ...o };
    for (const [k, x] of Object.entries(v)) if (x) u.set(k, x);
    return `/sales${u.size ? `?${u}` : ""}`;
  };
  return (
    <div className="space-y-4">
      <datalist id="buyer-names">{buyers.map((b) => <option key={b.name} value={b.name} />)}</datalist>
      <PageHeader title="賺多少" actions={<><LinkButton href="/api/export/sales">匯出</LinkButton><SellButton label="＋ 出售現貨" primary autoOpen={sp.new === "1"} /></>} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="賣了幾筆／幾件" value={`${total.count} / ${total.qty}`} />
        <Stat label="收入" value={<Twd v={total.revenue} />} />
        <Stat label="賣掉的東西成本" value={<Twd v={total.cost} />} note={total.tentative ? "有價格還沒確定" : undefined} />
        <Stat label="賺多少" value={<Twd v={total.profit} />} tone={total.profit < 0 ? "bad" : undefined} />
      </div>
      {ownerEntries.length > 0 && (
        <Section title="誰賺多少">
          <ul className="grid gap-2 sm:grid-cols-3">
            {ownerEntries.map(([k, v]) => (
              <li key={k} className={`rounded-xl border border-line-2 bg-[#fafbfc] p-3 text-sm ${ownerTone(k, ids).stripe}`} data-testid={`sale-owner-${k}`}>
                <div className="font-semibold"><OwnerBadge k={k} name={who(k)} ids={ids} /></div>
                <div>收入 <span className="num font-medium">{formatTwd(v.revenue)}</span>・成本 <span className="num">{formatTwd(v.cost)}</span></div>
                <div className={v.revenue - v.cost < 0 ? "text-bad" : "text-good"}>毛利 <span className="num font-semibold">{formatTwd(v.revenue - v.cost)}</span></div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-mute">依賣掉的那件是誰的計算；合資團的錢依各自實際付給代購的金額比例分。</p>
        </Section>
      )}
      <Section pad={false}>
        <form method="get" className="flex flex-wrap gap-2 border-b border-line-2 px-4 py-3">
          <input type="search" name="q" defaultValue={sp.q} placeholder="搜尋商品、買家、備註" className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-2" />
          {sp.ym && <input type="hidden" name="ym" value={sp.ym} />}
          {sp.voided && <input type="hidden" name="voided" value={sp.voided} />}
          <button className="rounded-lg border border-ai bg-ai px-3 py-2 text-sm text-white">搜尋</button>
        </form>
        <div className="flex gap-1.5 overflow-x-auto border-b border-line-2 px-4 py-2.5">
          <Link href={href({ ym: undefined })} className={chip(ym === thisMonth)}>本月</Link>
          <Link href={href({ ym: "all" })} className={chip(!ym)}>全部</Link>
          <Link href={href({ voided: sp.voided === "1" ? undefined : "1" })} className={chip(sp.voided === "1")}>顯示已作廢</Link>
        </div>
        {rows.length === 0 ? (
          <Empty action={<SellButton label="＋ 出售現貨" primary />}>{ym ? "這個月還沒有出售紀錄。" : "還沒有出售紀錄。"}</Empty>
        ) : (
          <ul className="divide-y divide-line-2">
            {rows.map((r) => (
              <li key={r.id} className={`px-4 py-3 ${r.voided ? "opacity-60" : ""}`} data-testid="sale-row">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {r.productId ? <Link href={`/products/${r.productId}`} className="hover:underline">{r.productName}</Link> : r.productName}
                      <span className="ml-1 text-ink-2">× {r.voided ? r.originalQty : r.qty}</span>
                      {r.voided && <span className="ml-2 rounded bg-line-2 px-1.5 text-[12px] text-mute">已作廢</span>}
                    </div>
                    <div className="text-[13px] text-mute">
                      {fmtDate(r.soldAt)}｜{r.buyer.name}｜每件 {formatTwd(r.unitPrice)}
                      {!r.voided && r.owners.filter((x) => x.qty > 0).map((x) => <span key={x.key} className="ml-1"><OwnerBadge k={x.key} name={x.key === JOINT ? "合資" : who(x.key)} ids={ids} /></span>)}
                      {!r.voided && (r.paid >= r.revenue ? "｜已收款" : `｜未收 ${formatTwd(r.revenue - r.paid)}`)}
                      {r.note ? `｜${r.note}` : ""}
                    </div>
                    {r.voided && r.cancelReason && <div className="text-[12px] text-mute">{r.cancelReason}</div>}
                  </div>
                  {!r.voided && (
                    <div className="text-right text-[13px]">
                      <div className="num text-[16px] font-semibold">{formatTwd(r.revenue)}</div>
                      <div className="num text-mute">成本 {formatTwd(r.cost)}{r.tentative ? "（價格還沒確定）" : ""}</div>
                      <div className={`num ${r.profit < 0 ? "text-bad" : "text-good"}`}>毛利 {formatTwd(r.profit)}</div>
                    </div>
                  )}
                </div>
                {!r.voided && r.productId && (
                  <div className="mt-2 flex gap-2">
                    <SellButton small label="更正" correct={{ orderId: r.id, productId: r.productId, productName: r.productName, qty: r.qty, unitPrice: r.unitPrice, buyerName: r.buyer.name === "散客" ? null : r.buyer.name, soldAt: toDateInput(r.soldAt), note: r.note }} />
                    <VoidSaleButton orderId={r.id} label={`${r.productName} × ${r.qty}`} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
