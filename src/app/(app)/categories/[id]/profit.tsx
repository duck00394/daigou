// 系列算起來：上面切換「確定的／預估的」，三個數字（預計可賺、實際已賺、還可以賣），叫的貨不夠的角色一行紅字
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

function Tile({ label, children, testid }: { label: string; children: React.ReactNode; testid?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2.5">
      <div className="text-[12.5px] text-mute">{label}</div>
      <div className="num mt-0.5 text-[19px] font-bold leading-tight" data-testid={testid}>{children}</div>
    </div>
  );
}

export function ProfitCard({ p, categoryId, est = false, sureHref, estHref, names = {} }: { p: P; categoryId: string; est?: boolean; sureHref?: string; estHref?: string; names?: Record<string, string> }) {
  const unpriced = p.free.unpriced;
  const noCost = p.free.uncosted + p.pre.uncosted;
  const profit = est ? p.est.profit : p.profit;
  const free = est ? p.est.free : p.free.qty;
  const short = (est ? p.estShort : p.short).map((x) => ({ name: names[x.id] ?? "", n: x.n })).filter((x) => x.name);
  const seg = (on: boolean) => `flex-1 rounded-lg py-2 text-center text-[14.5px] ${on ? "bg-white font-semibold text-ink shadow-sm" : "text-ink-2"}`;
  return (
    <section className="space-y-2.5" aria-label="這個系列算起來" data-testid="series-profit" data-tour="series-profit">
      {sureHref && estHref && (
        <nav className="flex rounded-xl bg-[#e7eaf0] p-1" aria-label="確定的或預估的" data-testid="est-toggle">
          <Link href={sureHref} scroll={false} className={seg(!est)} aria-current={!est ? "page" : undefined}>確定的</Link>
          <Link href={estHref} scroll={false} className={seg(est)} aria-current={est ? "page" : undefined}>預估的</Link>
        </nav>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="預計可賺" testid="series-profit-total"><span className={profit < 0 ? "text-bad" : "text-good"}>{profit.toLocaleString()}</span></Tile>
        <Tile label="實際已賺" testid="series-actual"><span className={p.actual < 0 ? "text-bad" : "text-good"}>{p.actual.toLocaleString()}</span></Tile>
        <Tile label="還可以賣" testid="series-free">{free} 隻</Tile>
      </div>
      {short.length > 0 && (
        <p className="rounded-xl bg-bad-soft px-3 py-2 text-[14px] font-semibold text-bad" data-testid="series-short">
          {est ? `就算全部買到，${short.map((x) => `${x.name}還差 ${x.n} 隻`).join("、")}` : `${short.map((x) => x.name).join("、")} 叫的貨不夠`}
        </p>
      )}
      {unpriced > 0 && (
        <p className="text-[14px] text-warn" data-testid="profit-unpriced">
          還有 {unpriced} 隻沒填售價，填了才算得出來 <Link href={`/categories/${categoryId}?tab=catalog`} className="text-ai">去填 ›</Link>
        </p>
      )}
      <details className="rounded-xl border border-line bg-card px-3 py-2 text-[14px]">
        <summary className="cursor-pointer text-[13px] text-ai">預計可賺怎麼算的</summary>
        <div className="mt-1 divide-y divide-line-2">
          {p.sold.qty > 0 && <Line href="/sales?ym=all" testid="profit-sold" profit={p.sold.revenue - p.sold.cost}>已經賣掉 {p.sold.qty} 隻</Line>}
          {p.pre.qty - p.pre.uncosted > 0 && <Line href="/sales#preorder" testid="profit-pre" profit={p.pre.revenue - p.pre.cost}>客人訂了 {p.pre.qty - p.pre.uncosted} 隻</Line>}
          {p.free.qty - unpriced - p.free.uncosted > 0 && <Line href={`/inventory?tab=stock&cat=${categoryId}&v=1`} testid="profit-free" profit={p.free.revenue - p.free.cost}>還沒人訂 {p.free.qty - unpriced - p.free.uncosted} 隻，照售價賣</Line>}
        </div>
        <p className="mt-1 text-[12.5px] text-mute">{est ? "預估＝還在等代購確認的也全部買到的話。" : "確定的＝手上的＋對單確定買到的。"}{noCost > 0 && !est ? `${noCost} 隻還沒有成本，先不算。` : ""}</p>
      </details>
    </section>
  );
}
