"use client";
// 選系列：最上面打關鍵字直接找（含已過期），或用 種類 › 系列 兩個下拉選單。
import { useMemo, useState } from "react";
import { byText } from "@/lib/sort";

export type SeriesOpt = { id: string; name: string; kindKey: string; kindLabel: string; active: boolean; kindSort?: number; pin?: number | null };

const selCls = "min-h-11 w-full rounded-lg border border-field bg-card px-2.5 text-[15px]";

export function kindsOf(series: SeriesOpt[]) {
  // 照「系列目錄 › 調整順序」排的順序
  const m = new Map<string, [string, number]>();
  for (const s of series) if (s.active && !m.has(s.kindKey)) m.set(s.kindKey, [s.kindLabel, s.kindSort ?? 1e6]);
  return [...m.entries()].sort((a, b) => a[1][1] - b[1][1] || byText(a[1][0], b[1][0])).map(([k, [l]]) => [k, l] as [string, string]);
}

export function SeriesPicker({
  series,
  value,
  onChange,
  kind: kindProp,
  onKind,
  allLabel,
  noneLabel,
  extra,
  prefix = "",
}: {
  series: SeriesOpt[];
  value: string; // 系列 id；"" 表示全部／不指定
  onChange: (id: string) => void;
  kind?: string;
  onKind?: (k: string) => void;
  allLabel?: string; // 例：「全部系列」（不選＝全部）
  noneLabel?: string; // 例：「不指定」
  extra?: React.ReactNode; // 選單下面的按鈕（例：＋ 新系列）
  prefix?: string; // 同一頁有兩組選單時，標籤前面加字（例：「這批商品的」）
}) {
  const current = series.find((s) => s.id === value) ?? null;
  const [kindState, setKindState] = useState(current?.kindKey ?? kindProp ?? "");
  const kind = kindProp ?? kindState;
  const setKind = (k: string) => (onKind ? onKind(k) : setKindState(k));
  const [q, setQ] = useState("");
  const kinds = useMemo(() => kindsOf(series), [series]);
  // 常用（自己打 1、2、3 的）：選單最上面，也有一排按一下就選
  const pinned = series.filter((s) => s.active && s.pin != null).sort((a, b) => a.pin! - b.pin!);
  const inKind = series.filter((s) => s.active && (!kind || s.kindKey === kind) && s.pin == null);
  const pick = (s: SeriesOpt) => {
    setKind(s.kindKey);
    onChange(s.id);
  };
  // 打關鍵字：系列名稱或種類名稱有這幾個字就列出來（已過期的也找得到）
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? series
        .filter((s) => words.every((w) => `${s.name} ${s.kindLabel}`.toLowerCase().includes(w)))
        .sort((a, b) => Number(b.active) - Number(a.active))
        .slice(0, 10)
    : [];
  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="search"
          aria-label={`${prefix}找系列`}
          placeholder="找系列：打關鍵字，例如 聖誕"
          className="min-h-11 w-full rounded-lg border border-field bg-card px-2.5 text-[15px]"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {words.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 divide-y divide-line-2 overflow-y-auto rounded-lg border border-line bg-card shadow-lg" data-testid="series-hits">
            {hits.map((s) => (
              <li key={s.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[15px] hover:bg-line-2" onClick={() => { setKind(s.kindKey); onChange(s.id); setQ(""); }}>
                  <span>{s.name}</span>
                  <span className="shrink-0 text-[12px] text-mute">{s.kindLabel}{s.active ? "" : "，已過期"}</span>
                </button>
              </li>
            ))}
            {!hits.length && <li className="px-3 py-2.5 text-[13px] text-mute">找不到「{q.trim()}」</li>}
          </ul>
        )}
      </div>
      {pinned.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="pinned-series">
          <span className="text-[13px] text-mute">常用</span>
          {pinned.map((s) => (
            <button key={s.id} type="button" aria-pressed={value === s.id} onClick={() => pick(s)} className={`rounded-full border px-3 py-1 text-[14px] ${value === s.id ? "border-ai bg-ai text-on-fill" : "border-line bg-card text-ink-2"}`}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[13px] font-medium text-ink-2">
          {prefix}種類
          <select aria-label={`${prefix}種類`} className={`${selCls} mt-1`} value={kind} onChange={(e) => { setKind(e.target.value); if (current && current.kindKey !== e.target.value) onChange(""); }}>
            <option value="">全部種類</option>
            {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-[13px] font-medium text-ink-2">
          {prefix}系列
          <select aria-label={`${prefix}系列`} className={`${selCls} mt-1`} value={value} onChange={(e) => { const s = series.find((x) => x.id === e.target.value); if (s && kind !== s.kindKey && (!kind || s.pin != null)) setKind(s.kindKey); onChange(e.target.value); }}>
            {allLabel !== undefined && <option value="">{allLabel}</option>}
            {noneLabel !== undefined && <option value="">{noneLabel}</option>}
            {allLabel === undefined && noneLabel === undefined && <option value="">請選系列</option>}
            {current && !current.active && <option value={current.id}>{current.name}（已過期）</option>}
            {pinned.length > 0 ? (
              <>
                <optgroup label="常用">{pinned.map((s) => <option key={s.id} value={s.id}>{s.pin}. {s.name}</option>)}</optgroup>
                <optgroup label={kinds.find(([k]) => k === kind)?.[1] ?? "其他"}>{inKind.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
              </>
            ) : (
              inKind.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
            )}
          </select>
        </label>
      </div>
      {extra && <div className="flex flex-wrap gap-2">{extra}</div>}
    </div>
  );
}
