"use client";
// 系列列表：打關鍵字找；依種類收合，點種類才展開
import { useState } from "react";
import Link from "next/link";
import { formatTwd } from "@/lib/money";

export type SeriesRow = { id: string; name: string; active: boolean; batches: number; totalTwd: number; dueTwd: number; refundTwd: number; ordered: number; received: number; pendingBatches: number };
export type KindGroup = { key: string; label: string; rows: SeriesRow[] };

function Row({ r }: { r: SeriesRow }) {
  const pct = r.ordered ? Math.min(100, Math.round((r.received / r.ordered) * 100)) : 0;
  return (
    <li>
      <Link href={`/categories/${r.id}`} className="block px-3 py-2.5 hover:bg-[#fafbfc]" data-testid={`cat-card-${r.name}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-semibold">{r.name}{!r.active && <span className="ml-1 text-[12px] font-normal text-mute">已過期</span>}</span>
          {r.refundTwd > 0 ? (
            <span className="num shrink-0 text-[14px] font-semibold text-bad">代購要退 {formatTwd(r.refundTwd)}</span>
          ) : r.dueTwd > 0 ? (
            <span className="num shrink-0 text-[14px] font-semibold text-bad">還要付 {formatTwd(r.dueTwd)}</span>
          ) : r.batches > 0 ? (
            <span className="shrink-0 text-[13px] text-good">已付清</span>
          ) : null}
        </div>
        <div className="text-[12px] text-mute">
          {r.batches ? [`${r.batches} 團`, `花了 ${formatTwd(r.totalTwd)}`, `到了 ${r.received}／${r.ordered} 件`, r.pendingBatches ? `待對單 ${r.pendingBatches} 團` : null].filter(Boolean).join("・") : "還沒有採購"}
        </div>
        {r.ordered > 0 && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-2" aria-hidden><div className="h-full rounded-full bg-good" style={{ width: `${pct}%` }} /></div>}
      </Link>
    </li>
  );
}

export function SeriesList({ groups }: { groups: KindGroup[] }) {
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? groups.flatMap((g) => g.rows.filter((r) => words.every((w) => `${r.name} ${g.label}`.toLowerCase().includes(w)))) : [];
  return (
    <div className="space-y-2">
      <input type="search" aria-label="找系列" placeholder="找系列：打關鍵字" className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-[15px]" value={q} onChange={(e) => setQ(e.target.value)} />
      {words.length > 0 ? (
        <ul className="divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-card" data-testid="series-search-hits">
          {hits.map((r) => <Row key={r.id} r={r} />)}
          {!hits.length && <li className="px-3 py-3 text-[14px] text-mute">找不到「{q.trim()}」</li>}
        </ul>
      ) : (
        groups.map((g) => {
          const due = g.rows.reduce((a, r) => a + r.dueTwd, 0);
          const refund = g.rows.reduce((a, r) => a + r.refundTwd, 0);
          return (
            <details key={g.key} className="overflow-hidden rounded-xl border border-line bg-card" data-testid="series-kind">
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-3 text-[15px] font-semibold">
                <span>{g.label}<span className="ml-1.5 text-[13px] font-normal text-mute">{g.rows.length} 個系列</span></span>
                <span className="text-[13px] font-normal">{refund > 0 ? <span className="text-bad">要退 {formatTwd(refund)}</span> : due > 0 ? <span className="text-bad">還要付 {formatTwd(due)}</span> : null}</span>
              </summary>
              <ul className="divide-y divide-line-2 border-t border-line-2">{g.rows.map((r) => <Row key={r.id} r={r} />)}</ul>
            </details>
          );
        })
      )}
    </div>
  );
}
