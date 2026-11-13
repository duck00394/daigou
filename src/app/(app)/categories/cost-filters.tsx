"use client";
// 系列成本比較的下拉選單：選了就套用（不用再按「套用」）。網址上的其他條件照留
import { useRouter, useSearchParams } from "next/navigation";

type Opt = [string, string];

export function CostSelect({ name, label, value, options, allLabel, className = "" }: { name: string; label: string; value: string; options: Opt[]; allLabel?: string; className?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        const q = new URLSearchParams(sp.toString());
        q.set("view", "cost");
        if (e.target.value) q.set(name, e.target.value);
        else q.delete(name);
        router.push(`/categories?${q.toString()}`, { scroll: false });
      }}
      className={`min-h-10 min-w-0 rounded-lg border border-field bg-card px-2 text-[14px] text-ink ${className}`}
    >
      {allLabel != null && <option value="">{allLabel}</option>}
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
