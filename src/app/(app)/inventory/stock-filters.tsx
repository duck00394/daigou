"use client";
// 庫存篩選：種類 › 系列 › 品項 用下拉選單，或直接搜尋；按「查看」才列出來（不會一打開就整頁都是）
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SeriesPicker, type SeriesOpt } from "@/components/series-picker";

export function StockFilters({ series, types, kind, cat, q, type, only, owner = "" }: { series: SeriesOpt[]; types: { id: string; name: string }[]; kind: string; cat: string; q: string; type: string; only: string; owner?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ kind: kind || (series.find((s) => s.id === cat)?.kindKey ?? ""), cat, type, q, only });
  const go = () => {
    const sp = new URLSearchParams({ tab: "stock", v: "1" });
    if (f.kind) sp.set("kind", f.kind);
    if (f.cat) sp.set("cat", f.cat);
    if (f.type) sp.set("type", f.type);
    if (f.q.trim()) sp.set("q", f.q.trim());
    if (f.only) sp.set("only", f.only);
    if (owner) sp.set("owner", owner);
    router.push(`/inventory?${sp.toString()}`);
  };
  return (
    <form className="space-y-2 rounded-xl border border-line bg-card p-3" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <SeriesPicker series={series} value={f.cat} kind={f.kind} onKind={(k) => setF((x) => ({ ...x, kind: k }))} onChange={(id) => setF((x) => ({ ...x, cat: id }))} allLabel="全部系列" />
      <label className="block text-[13px] font-medium text-ink-2">
        品項
        <select aria-label="品項" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-2.5 text-[15px]" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="">全部品項</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="block text-[13px] font-medium text-ink-2">
        顯示
        <select aria-label="顯示" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-2.5 text-[15px]" value={f.only} onChange={(e) => setF({ ...f, only: e.target.value })}>
          <option value="">有庫存或預購的</option>
          <option value="stock">只看現貨（現在可以賣）</option>
          <option value="sure">預購・一定有貨（代購已確認）</option>
          <option value="unsure">預購・不一定有貨（還沒確認）</option>
          <option value="all">全部商品（含沒庫存的）</option>
        </select>
      </label>
      <input type="search" aria-label="搜尋商品" placeholder="🔍 或直接搜角色、商品" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[15px]" />
      <button type="submit" className="min-h-11 w-full rounded-lg bg-ai text-[16px] font-semibold text-white">查看</button>
    </form>
  );
}
