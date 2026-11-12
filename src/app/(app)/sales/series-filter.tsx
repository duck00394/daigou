"use client";
// 賺多少：選系列（常用排最上面）
import { useRouter, useSearchParams } from "next/navigation";
import type { SeriesOpt } from "@/components/series-picker";
import { kindsOf } from "@/components/series-picker";

export function SeriesFilter({ series, value }: { series: SeriesOpt[]; value: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const go = (id: string) => {
    const u = new URLSearchParams(sp.toString());
    if (id) u.set("cat", id);
    else u.delete("cat");
    u.delete("show");
    router.push(`/sales${u.size ? `?${u}` : ""}`);
  };
  const pinned = series.filter((s) => s.active && s.pin != null).sort((a, b) => a.pin! - b.pin!);
  const kinds = kindsOf(series);
  const current = series.find((s) => s.id === value);
  return (
    <div className="space-y-2">
      {pinned.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-mute">常用</span>
          {pinned.map((s) => (
            <button key={s.id} type="button" aria-pressed={value === s.id} onClick={() => go(value === s.id ? "" : s.id)} className={`rounded-full border px-3 py-1 text-[14px] ${value === s.id ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <label className="block text-[13px] font-medium text-ink-2">
        看哪個系列
        <select aria-label="看哪個系列" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-2.5 text-[15px]" value={value} onChange={(e) => go(e.target.value)}>
          <option value="">全部系列</option>
          {current && !current.active && <option value={current.id}>{current.name}（已過期）</option>}
          {kinds.map(([k, l]) => (
            <optgroup key={k} label={l}>
              {series.filter((s) => s.active && s.kindKey === k).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}
