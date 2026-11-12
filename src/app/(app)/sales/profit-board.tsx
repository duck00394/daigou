// 賺多少（照系列算）：已出貨的＋客人預訂的（預估）；每個系列、每張單各賺多少
import Link from "next/link";
import { formatTwd } from "@/lib/money";
import { fmtDate, orderSource } from "@/lib/labels";
import { profitOf, type orderProfits, type Part } from "@/server/services/profit";
import { SeriesFilter } from "./series-filter";
import type { SeriesOpt } from "@/components/series-picker";

type P = Awaited<ReturnType<typeof orderProfits>>;

const money = (v: number, tone = false) => <span className={`num ${tone ? (v < 0 ? "text-bad" : "text-good") : ""}`}>{formatTwd(v)}</span>;
const earn = (p: Part) => {
  const v = profitOf(p);
  return <span className={v < 0 ? "text-bad" : "text-good"}>{v < 0 ? "賠" : "賺"} <span className="num">{Math.abs(v).toLocaleString()}</span></span>;
};

export function ProfitBoard({ p, series, cat, show, href }: { p: P; series: SeriesOpt[]; cat: string; show: string; href: (o: Record<string, string | undefined>) => string }) {
  const all = { revenue: p.total.shipped.revenue + p.total.open.revenue, cost: p.total.shipped.cost + p.total.open.cost, fee: p.total.shipped.fee + p.total.open.fee };
  const uncosted = p.total.open.uncosted;
  const tentative = p.total.shipped.tentative || p.total.open.tentative;
  const list = p.orders.filter((o) => (show === "shipped" ? o.shipped.qty > 0 : show === "open" ? o.open.qty + o.open.uncosted > 0 : true));
  const chip = (on: boolean) => `shrink-0 rounded-full border px-3 py-1 text-[13px] ${on ? "border-ai bg-ai text-on-fill" : "border-line bg-card text-ink-2"}`;
  return (
    <section className="rounded-xl border border-line bg-card" data-testid="profit-board">
      <div className="border-b border-line-2 p-4">
        <SeriesFilter series={series} value={cat} />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div><div className="text-[12px] text-mute">收入</div><div className="num text-[18px] font-semibold" data-testid="pb-revenue">{formatTwd(all.revenue)}</div></div>
          <div><div className="text-[12px] text-mute">成本</div><div className="num text-[18px] font-semibold">{formatTwd(all.cost)}{tentative && <span className="text-warn">*</span>}</div></div>
          <div><div className="text-[12px] text-mute">賺多少</div><div className={`num text-[18px] font-semibold ${all.revenue - all.cost - all.fee < 0 ? "text-bad" : "text-good"}`} data-testid="pb-profit">{formatTwd(all.revenue - all.cost - all.fee)}</div></div>
        </div>
        <div className="mt-2 divide-y divide-line-2 border-t border-line-2 text-[14px]">
          <div className="flex justify-between py-2" data-testid="pb-shipped"><span>已出貨 {p.total.shipped.qty} 件</span>{earn(p.total.shipped)}</div>
          {all.fee > 0 && <div className="flex justify-between py-2" data-testid="pb-fee"><span>平台抽成（已從賺多少扣掉）</span><span className="num text-bad">−{formatTwd(all.fee)}</span></div>}
          <div className="flex justify-between py-2" data-testid="pb-open"><span>客人預訂（還沒給，預估）{p.total.open.qty} 件</span>{earn(p.total.open)}</div>
        </div>
        <p className="text-[12px] text-mute">
          還沒收的錢 {formatTwd(p.unpaid)}（賺多少照算，收款看「待收」）。收入是商品售價，不含運費。
          {tentative ? "＊有價格還沒確定。" : ""}
          {uncosted > 0 ? `還有 ${uncosted} 件還沒有成本（還沒買或不一定到），先不算。` : ""}
        </p>
      </div>

      {!cat && p.series.length > 0 && (
        <div className="overflow-x-auto border-b border-line-2">
          <table className="w-full text-[14px]" data-testid="pb-series">
            <thead>
              <tr className="text-[12px] text-mute">
                <th className="px-4 py-2 text-left font-medium">系列</th>
                <th className="px-2 py-2 text-right font-medium">已出貨</th>
                <th className="px-2 py-2 text-right font-medium">預訂（預估）</th>
                <th className="px-4 py-2 text-right font-medium">合計</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2 border-t border-line-2">
              {p.series.map((s) => (
                <tr key={s.id ?? "-"} data-name={s.name}>
                  <td className="px-4 py-2">{s.id ? <Link href={href({ cat: s.id })} className="whitespace-nowrap text-ai hover:underline">{s.name}</Link> : s.name}</td>
                  <td className="px-2 py-2 text-right">{s.shipped.qty ? money(profitOf(s.shipped), true) : <span className="text-mute">0</span>}</td>
                  <td className="px-2 py-2 text-right">{s.open.qty ? money(profitOf(s.open), true) : <span className="text-mute">0</span>}</td>
                  <td className="px-4 py-2 text-right font-semibold" data-k="sum">{money(profitOf(s.shipped) + profitOf(s.open), true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-4 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">每張單賺多少</h2>
          <div className="flex gap-1.5">
            <Link href={href({ show: undefined })} className={chip(!show)}>全部</Link>
            <Link href={href({ show: "shipped" })} className={chip(show === "shipped")}>已出貨</Link>
            <Link href={href({ show: "open" })} className={chip(show === "open")}>預訂</Link>
          </div>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="px-4 pb-4 text-[14px] text-mute">沒有訂單。</p>
      ) : (
        <ul className="divide-y divide-line-2 border-t border-line-2" data-testid="pb-orders">
          {list.slice(0, 100).map((o) => {
            const sum: Part = { qty: o.shipped.qty + o.open.qty, revenue: o.shipped.revenue + o.open.revenue, cost: o.shipped.cost + o.open.cost, fee: o.shipped.fee + o.open.fee, uncosted: o.open.uncosted, tentative: o.shipped.tentative || o.open.tentative };
            return (
              <li key={o.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-[14px]" data-testid="pb-order" data-no={o.orderNo}>
                <div className="min-w-0">
                  <Link href={`/orders/${o.id}`} className="font-medium text-ai hover:underline">{o.orderNo}</Link> {o.buyer}
                  {o.open.qty + o.open.uncosted > 0 ? <span className="ml-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] text-warn">{o.shipped.qty ? "部分預訂" : "預訂"}</span> : <span className="ml-1 rounded-full bg-good-soft px-2 py-0.5 text-[11.5px] text-good">已出貨</span>}
                  {o.balance > 0 && <span className="ml-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] text-warn">還沒收</span>}
                  <div className="text-[12.5px] text-mute">
                    {fmtDate(o.orderedAt).slice(0, 10)}，{o.channel ?? orderSource[o.source] ?? o.source}，{sum.qty} 件，{formatTwd(sum.revenue)}
                    {o.open.qty ? "（含預估）" : ""}
                    {sum.fee ? `，平台抽 ${sum.fee}` : ""}
                    {o.open.uncosted ? `，${o.open.uncosted} 件沒成本` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-right" data-k="profit">{earn(sum)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {list.length > 100 && <p className="px-4 py-2 text-[12px] text-mute">只列最近 100 張，選系列可以看更細。</p>}
    </section>
  );
}
