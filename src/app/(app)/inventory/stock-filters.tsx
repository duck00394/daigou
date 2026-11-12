"use client";
// 庫存篩選：種類 › 系列 › 品項 用下拉選單，或直接搜尋；按「查看」才列出來（不會一打開就整頁都是）
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SeriesPicker, type SeriesOpt } from "@/components/series-picker";

export function StockFilters({ series, types, kind, cat, q, type, only }: { series: SeriesOpt[]; types: { id: string; name: string }[]; kind: string; cat: string; q: string; type: string; only: string }) {
  const router = useRouter();
  const [f, setF] = useState({ kind: kind || (series.find((s) => s.id === cat)?.kindKey ?? ""), cat, type, q, only });
  const go = (x = f) => {
    const sp = new URLSearchParams({ tab: "stock", v: "1" });
    if (x.kind) sp.set("kind", x.kind);
    if (x.cat) sp.set("cat", x.cat);
    if (x.type) sp.set("type", x.type);
    if (x.q.trim()) sp.set("q", x.q.trim());
    if (x.only) sp.set("only", x.only);
    router.push(`/inventory?${sp.toString()}`);
  };
  // 選了系列、品項、顯示就直接列出來（不用再按「查看」）；只選種類時還沒決定，等選系列或按查看
  const pick = (patch: Partial<typeof f>) => {
    const x = { ...f, ...patch };
    setF(x);
    go(x);
  };
  const ONLY: [string, string][] = [["stock", "現貨"], ["short", "待買清單"], ["sure", "預購・一定有"], ["", "有庫存或預購"], ["all", "全部商品"]];
  return (
    // 電腦：左邊選系列、右邊其他條件，篩選只佔半個畫面高；手機照舊一欄
    <form className="grid gap-2 rounded-xl border border-line bg-card p-3 md:grid-cols-2 md:gap-x-4" onSubmit={(e) => { e.preventDefault(); go(); }}>
      {/* 最常看的幾種一下就列出來 */}
      <div className="flex gap-1.5 overflow-x-auto md:col-span-2" role="group" aria-label="快速顯示" data-testid="stock-quick">
        {ONLY.map(([v, l]) => (
          <button key={v || "default"} type="button" aria-pressed={f.only === v} onClick={() => pick({ only: v })} className={`flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-[13.5px] transition-colors duration-150 ${f.only === v ? "border-ai bg-ai font-medium text-on-fill" : "border-line bg-card text-ink-2 hover:bg-line-2"}`}>{l}</button>
        ))}
      </div>
      <SeriesPicker series={series} value={f.cat} kind={f.kind} onKind={(k) => setF((x) => ({ ...x, kind: k }))} onChange={(id) => pick({ cat: id })} allLabel="全部系列" />
      <div className="space-y-2">
      <label className="block text-[13px] font-medium text-ink-2">
        品項
        <select aria-label="品項" className="mt-1 min-h-11 w-full rounded-lg border border-field bg-card px-2.5 text-[15px]" value={f.type} onChange={(e) => pick({ type: e.target.value })}>
          <option value="">全部品項</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="block text-[13px] font-medium text-ink-2">
        顯示
        <select aria-label="顯示" className="mt-1 min-h-11 w-full rounded-lg border border-field bg-card px-2.5 text-[15px]" value={f.only} onChange={(e) => pick({ only: e.target.value })}>
          <option value="">有庫存或預購的</option>
          <option value="stock">只看現貨（現在可以賣）</option>
          <option value="sure">預購，一定有貨（代購已確認）</option>
          <option value="unsure">預購，不一定有貨（還沒確認）</option>
          <option value="short">待買清單（客人訂的比庫存多）</option>
          <option value="all">全部商品（含沒庫存的）</option>
        </select>
      </label>
      <input type="search" aria-label="搜尋商品" placeholder="或直接搜角色、商品" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="min-h-11 w-full rounded-lg border border-field bg-card px-2.5 text-[15px] placeholder:text-mute" />
      </div>
      <button type="submit" className="min-h-11 w-full rounded-lg bg-ai text-[16px] font-semibold text-on-fill transition-colors duration-150 hover:bg-ai-2 md:col-span-2">查看</button>
    </form>
  );
}
