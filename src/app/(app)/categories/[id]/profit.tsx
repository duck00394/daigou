// 這個系列預估可賺：已經賣掉、客人預訂還沒給、還沒人訂的（照售價），各自收多少、成本多少
import Link from "next/link";
import { formatTwd } from "@/lib/money";
import type { seriesProfit } from "@/server/services/preorder";

type P = Awaited<ReturnType<typeof seriesProfit>>;

function Line({ title, note, href, revenue, cost, testid }: { title: string; note: string; href: string; revenue: number; cost: number; testid: string }) {
  const profit = revenue - cost;
  return (
    <Link href={href} className="flex items-start justify-between gap-2 border-t border-line-2 px-4 py-2.5 hover:bg-[#fafbfd]" data-testid={testid}>
      <span className="min-w-0">
        <span className="font-medium">{title} <span className="text-ai">›</span></span>
        <span className="block text-[12px] text-mute">{note}</span>
      </span>
      <span className="shrink-0 text-right text-[13px]">
        <span className="block">收 <span className="num">{formatTwd(revenue)}</span>・成本 <span className="num">{formatTwd(cost)}</span></span>
        <span className={`num block text-[15px] font-semibold ${profit < 0 ? "text-bad" : "text-good"}`} data-k="profit">{profit < 0 ? "賠" : "賺"} {formatTwd(Math.abs(profit))}</span>
      </span>
    </Link>
  );
}

export function ProfitCard({ p, categoryId }: { p: P; categoryId: string }) {
  const skipped = [p.pre.uncosted ? `${p.pre.uncosted} 件客人訂的還沒有成本` : "", p.free.uncosted ? `${p.free.uncosted} 件沒有成本` : "", p.free.unpriced ? `${p.free.unpriced} 件還沒填售價` : ""].filter(Boolean);
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-card" aria-label="這個系列預估可賺" data-testid="series-profit">
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-[15px] font-semibold">這個系列預估可賺</h2>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
          <span className={`num text-[24px] font-bold ${p.profit < 0 ? "text-bad" : "text-good"}`} data-testid="series-profit-total">{formatTwd(p.profit)}</span>
          <span className="text-[13px] text-mute">成本 <span className="num text-ink">{formatTwd(p.cost)}</span>・會收 <span className="num text-ink">{formatTwd(p.revenue)}</span></span>
        </div>
      </div>
      <Line title="已經賣掉" note={`${p.sold.qty} 件・實際收的錢`} href={`/sales?ym=all`} revenue={p.sold.revenue} cost={p.sold.cost} testid="profit-sold" />
      <Line title="客人預訂還沒給" note={`${p.pre.qty} 件・照客人下訂的價格`} href="/sales#preorder" revenue={p.pre.revenue} cost={p.pre.cost} testid="profit-pre" />
      <Line title="還沒人訂的" note={`${p.free.qty} 件（現有＋一定到）・照售價`} href={`/inventory?tab=stock&cat=${categoryId}&v=1`} revenue={p.free.revenue} cost={p.free.cost} testid="profit-free" />
      <p className="border-t border-line-2 px-4 py-2 text-[12px] text-mute">
        自留的、不一定到的不算。{skipped.length > 0 && <span className="text-warn">{skipped.join("、")}，先不算。</span>}
        {p.free.unpriced > 0 && <Link href={`/categories/${categoryId}?tab=catalog`} className="ml-1 text-ai">去填售價 ›</Link>}
      </p>
    </section>
  );
}
