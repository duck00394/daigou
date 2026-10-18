"use client";
// 選系列：種類 › 系列 兩個下拉選單。已過期的系列不在選單裡，按「找過期的」用打字找。
import { useMemo, useState } from "react";
import { byText } from "@/lib/sort";

export type SeriesOpt = { id: string; name: string; kindKey: string; kindLabel: string; active: boolean };

const selCls = "min-h-11 w-full rounded-lg border border-line bg-white px-2.5 text-[15px]";

export function kindsOf(series: SeriesOpt[]) {
  const m = new Map<string, string>();
  for (const s of series) if (s.active && !m.has(s.kindKey)) m.set(s.kindKey, s.kindLabel);
  return [...m.entries()].sort((a, b) => byText(a[1], b[1]));
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
  extra?: React.ReactNode; // 放在「找過期的」旁邊的按鈕（例：＋ 新系列）
  prefix?: string; // 同一頁有兩組選單時，標籤前面加字（例：「這批商品的」）
}) {
  const current = series.find((s) => s.id === value) ?? null;
  const [kindState, setKindState] = useState(current?.kindKey ?? kindProp ?? "");
  const kind = kindProp ?? kindState;
  const setKind = (k: string) => (onKind ? onKind(k) : setKindState(k));
  const [finding, setFinding] = useState(false);
  const [q, setQ] = useState("");
  const kinds = useMemo(() => kindsOf(series), [series]);
  const inKind = series.filter((s) => s.active && (!kind || s.kindKey === kind));
  const expired = series.filter((s) => !s.active);
  const hits = q.trim() ? series.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : expired.slice(0, 8);
  return (
    <div className="space-y-2">
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
          <select aria-label={`${prefix}系列`} className={`${selCls} mt-1`} value={value} onChange={(e) => { const s = series.find((x) => x.id === e.target.value); if (s && !kind) setKind(s.kindKey); onChange(e.target.value); }}>
            {allLabel !== undefined && <option value="">{allLabel}</option>}
            {noneLabel !== undefined && <option value="">{noneLabel}</option>}
            {allLabel === undefined && noneLabel === undefined && <option value="">請選系列</option>}
            {current && !current.active && <option value={current.id}>{current.name}（已過期）</option>}
            {inKind.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {expired.length > 0 && (
          <button type="button" className="min-h-10 rounded-lg border border-line bg-white px-3 text-[14px] text-ink-2" aria-expanded={finding} onClick={() => setFinding(!finding)}>🔍 找過期的系列</button>
        )}
        {extra}
      </div>
      {finding && (
        <div className="rounded-lg border border-line bg-white p-2">
          <input autoFocus type="search" aria-label="找系列" placeholder="打系列名字" className="w-full rounded-lg border border-line px-2.5 py-2 text-[15px]" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-1 divide-y divide-line-2">
            {hits.map((s) => (
              <li key={s.id}>
                <button type="button" className="flex w-full justify-between px-2 py-2 text-left text-[15px]" onClick={() => { setKind(s.kindKey); onChange(s.id); setFinding(false); setQ(""); }}>
                  <span>{s.name}</span>
                  <span className="text-[12px] text-mute">{s.kindLabel}{s.active ? "" : "・已過期"}</span>
                </button>
              </li>
            ))}
            {!hits.length && <li className="px-2 py-2 text-[13px] text-mute">找不到</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
