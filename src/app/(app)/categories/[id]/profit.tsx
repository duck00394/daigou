// 這個系列全部賣掉預估可賺：一個大數字，下面幾句白話（數量是 0 的不列）
import Link from "next/link";
import { formatTwd } from "@/lib/money";
import type { seriesTotals } from "@/server/services/preorder";

type P = ReturnType<typeof seriesTotals>;

function Line({ href, testid, children, profit }: { href: string; testid: string; children: React.ReactNode; profit: number }) {
  return (
    <Link href={href} className="flex items-baseline justify-between gap-2 py-1 text-[14px]" data-testid={testid}>
      <span>{children}</span>
      <span className={`num shrink-0 font-semibold ${profit < 0 ? "text-bad" : "text-good"}`}>{profit < 0 ? "賠" : "賺"} {formatTwd(Math.abs(profit))} <span className="font-normal text-mute">›</span></span>
    </Link>
  );
}

export function ProfitCard({ p, categoryId }: { p: P; categoryId: string }) {
  const unpriced = p.free.unpriced;
  const noCost = p.free.uncosted + p.pre.uncosted;
  return (
    <section className="rounded-xl border border-line bg-card px-4 py-3" aria-label="全部賣掉預估可賺" data-testid="series-profit" data-tour="series-profit">
      <div className="text-[13px] text-ink-2">全部賣掉預估可賺</div>
      <div className={`num text-[24px] font-bold ${p.profit < 0 ? "text-bad" : "text-good"}`} data-testid="series-profit-total">{formatTwd(p.profit)}</div>
      <div className="mt-1 divide-y divide-line-2">
        {p.sold.qty > 0 && <Line href="/sales?ym=all" testid="profit-sold" profit={p.sold.revenue - p.sold.cost}>已經賣掉 {p.sold.qty} 隻</Line>}
        {p.pre.qty - p.pre.uncosted > 0 && <Line href="/sales#preorder" testid="profit-pre" profit={p.pre.revenue - p.pre.cost}>客人訂了 {p.pre.qty - p.pre.uncosted} 隻</Line>}
        {p.free.qty - unpriced - p.free.uncosted > 0 && <Line href={`/inventory?tab=stock&cat=${categoryId}&v=1`} testid="profit-free" profit={p.free.revenue - p.free.cost}>還沒人訂 {p.free.qty - unpriced - p.free.uncosted} 隻，照售價賣</Line>}
      </div>
      {unpriced > 0 && (
        <p className="mt-1 text-[14px] text-warn" data-testid="profit-unpriced">
          還有 {unpriced} 隻沒填售價，填了才算得出來 <Link href={`/categories/${categoryId}?tab=catalog`} className="text-ai">去填 ›</Link>
        </p>
      )}
      {noCost > 0 && <p className="mt-1 text-[13px] text-mute">{noCost} 隻還沒有成本（還沒確定買到），先不算</p>}
      {p.cost > 0 && <p className="mt-1 text-[12px] text-mute">算進去的：成本 {formatTwd(p.cost)}・會收 {formatTwd(p.revenue)}</p>}
    </section>
  );
}
