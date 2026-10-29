// 客人預訂（還沒給的）預估可賺：預訂金額 − 預購平均成本
import Link from "next/link";
import { formatTwd } from "@/lib/money";
import type { preorderProfit } from "@/server/services/preorder";
import { AssignAll } from "./assign";

type P = Awaited<ReturnType<typeof preorderProfit>>;

export function PreorderCard({ p, who = null, operators = [], acting = "" }: { p: P; who?: string | null; operators?: { id: string; name: string }[]; acting?: string }) {
  if (!p.qty && !p.unassigned) return null;
  const money = (v: number, tone?: boolean) => <span className={`num ${tone ? (v < 0 ? "text-bad" : "text-good") : ""}`}>{formatTwd(v)}</span>;
  const warn = p.unassigned > 0 && <AssignAll n={p.unassigned} operators={operators} acting={acting} counted={!who} />;
  if (!p.qty)
    return (
      <section id="preorder" className="scroll-mt-24 rounded-xl border border-line bg-card p-4" aria-label="客人預訂預估可賺" data-testid="preorder-card">
        <h2 className="text-[15px] font-semibold">客人預訂（還沒給的）{who ? `・跟${who}訂的` : ""}</h2>
        <p className="mt-1 text-[14px] text-mute">{who ? `沒有跟${who}訂的。` : ""}</p>
        {warn}
      </section>
    );
  return (
    <section id="preorder" className="scroll-mt-24 rounded-xl border border-line bg-card" aria-label="客人預訂預估可賺" data-testid="preorder-card">
      <div className="p-4">
        <h2 className="text-[15px] font-semibold">客人預訂（還沒給的）{who ? `・跟${who}訂的` : ""}</h2>
        {warn}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div><div className="text-[12px] text-mute">預訂金額</div><div className="num text-[18px] font-semibold" data-testid="pre-revenue">{formatTwd(p.revenue)}</div></div>
          <div><div className="text-[12px] text-mute">成本</div><div className="num text-[18px] font-semibold" data-testid="pre-cost">{formatTwd(p.cost)}{p.tentative && <span className="text-warn">*</span>}</div></div>
          <div><div className="text-[12px] text-mute">預估可賺</div><div className={`num text-[18px] font-semibold ${p.profit < 0 ? "text-bad" : "text-good"}`} data-testid="pre-profit">{formatTwd(p.profit)}</div></div>
        </div>
        <p className="mt-1 text-[12px] text-mute">共 {p.qty} 件・成本用預購平均成本（現有＋一定到，含運費、關稅）{p.tentative ? "・* 有預估價格" : ""}</p>
        {p.uncosted > 0 && <p className="text-[12px] text-warn" data-testid="pre-uncosted">{p.uncosted} 件還沒有成本（還沒買或不一定到），先不算</p>}
      </div>
      <details className="group border-t border-line-2">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-[14px] text-ai [&::-webkit-details-marker]:hidden"><span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>看每位客人</summary>
        <ul className="divide-y divide-line-2 border-t border-line-2" data-testid="pre-buyers">
          {p.buyers.map((b) => (
            <li key={b.id} className="flex items-baseline justify-between gap-2 px-4 py-2 text-[14px]" data-name={b.name}>
              <span className="min-w-0 truncate">{b.name}<span className="text-[12px] text-mute">{b.channel ? `・${b.channel}` : ""}・{b.qty} 件</span></span>
              <span className="shrink-0 text-right">{money(b.revenue)} <span className={b.profit < 0 ? "text-bad" : "text-good"}>{b.profit < 0 ? "賠" : "賺"} <span className="num">{Math.abs(b.profit).toLocaleString()}</span></span>{b.uncosted > 0 && <span className="block text-[11px] text-warn">{b.uncosted} 件沒成本</span>}</span>
            </li>
          ))}
        </ul>
      </details>
      <details className="group border-t border-line-2">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-[14px] text-ai [&::-webkit-details-marker]:hidden"><span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>依商品看</summary>
        <ul className="divide-y divide-line-2 border-t border-line-2" data-testid="pre-products">
          {p.products.map((x) => (
            <li key={x.productId} className="flex items-baseline justify-between gap-2 px-4 py-2 text-[14px]">
              <span className="min-w-0 truncate">{x.name}<span className="text-[12px] text-mute">・{x.qty} 件</span></span>
              <span className="shrink-0 text-right">{money(x.revenue)} {x.cost === null ? <span className="text-[12px] text-warn">沒成本</span> : <span className={x.revenue - x.cost < 0 ? "text-bad" : "text-good"}>{x.revenue - x.cost < 0 ? "賠" : "賺"} <span className="num">{Math.abs(x.revenue - x.cost).toLocaleString()}</span>{x.tentative ? "*" : ""}</span>}</span>
            </li>
          ))}
        </ul>
      </details>
      <details className="group border-t border-line-2" data-testid="pre-series-box">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-[14px] text-ai [&::-webkit-details-marker]:hidden"><span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>依系列看</summary>
        <div className="border-t border-line-2 overflow-x-auto">
          <table className="w-full text-[14px]" data-testid="pre-series">
            <thead>
              <tr className="text-[12px] text-mute">
                <th className="px-4 py-2 text-left font-medium">系列</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">件數</th>
                <th className="px-2 py-2 text-right font-medium">預訂金額</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">成本</th>
                <th className="px-4 py-2 text-right font-medium">預估可賺</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2 border-t border-line-2">
              {p.series.map((x) => (
                <tr key={x.id ?? "-"} data-name={x.name}>
                  <td className="px-4 py-2">{x.id ? <Link href={`/categories/${x.id}`} className="hover:underline">{x.name}</Link> : x.name}<span className="text-[12px] text-mute md:hidden">・{x.qty} 件</span>{x.uncosted > 0 && <span className="block text-[11px] text-warn">{x.uncosted} 件沒成本</span>}</td>
                  <td className="num hidden px-2 py-2 text-right md:table-cell">{x.qty}</td>
                  <td className="num px-2 py-2 text-right">{formatTwd(x.revenue)}</td>
                  <td className="num hidden px-2 py-2 text-right md:table-cell">{formatTwd(x.cost)}{x.tentative && <span className="text-warn">*</span>}</td>
                  <td className="px-4 py-2 text-right" data-k="profit">{money(x.profit, true)}</td>
                </tr>
              ))}
              <tr className="bg-[#fafbfc] font-semibold">
                <td className="px-4 py-2">合計</td>
                <td className="num hidden px-2 py-2 text-right md:table-cell">{p.qty}</td>
                <td className="num px-2 py-2 text-right">{formatTwd(p.revenue)}</td>
                <td className="num hidden px-2 py-2 text-right md:table-cell">{formatTwd(p.cost)}{p.tentative && <span className="text-warn">*</span>}</td>
                <td className="px-4 py-2 text-right" data-testid="pre-series-total">{money(p.profit, true)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
