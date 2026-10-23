"use client";
// 下拉選單切換頁面／篩選（取代一排一排的標籤按鈕）：選了就換頁
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type NavOpt = { label: string; href: string };

export function NavSelect({ label, options, current, className = "", hideLabel = false }: { label: string; options: NavOpt[]; current: string; className?: string; hideLabel?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className={`block min-w-0 text-[12px] font-medium text-mute ${className}`}>
      {!hideLabel && <span className="mb-0.5 block">{label}</span>}
      <select
        aria-label={label}
        value={current}
        disabled={pending}
        onChange={(e) => start(() => router.push(e.target.value))}
        className="min-h-11 w-full rounded-lg border border-line bg-white px-2.5 text-[15px] font-normal text-ink disabled:opacity-60"
      >
        {options.map((o) => <option key={o.href} value={o.href}>{o.label}</option>)}
      </select>
    </label>
  );
}
