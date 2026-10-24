"use client";
// 販售平台：下拉選單（常見的＋用過的），最後一項可以自己打
import { useState } from "react";
import { Choice } from "./choice";
import { inputCls } from "./client";

export const DEFAULT_CHANNELS = ["賣貨便", "蝦皮", "IG", "Threads", "LINE", "Facebook", "面交"];

export function ChannelPicker({ value, onChange, extra = [], label = "販售平台" }: { value: string; onChange: (v: string) => void; extra?: string[]; label?: string }) {
  const [typing, setTyping] = useState<string | null>(null);
  const opts = [...new Set([...DEFAULT_CHANNELS, ...extra, ...(value ? [value] : [])])];
  if (typing !== null)
    return (
      <label className="block text-[13px] font-medium text-ink-2">
        <span className="mb-1 block">{label}（自己打）</span>
        <input autoFocus aria-label={`其他${label}`} className={`${inputCls} min-h-11`} value={typing} onChange={(e) => setTyping(e.target.value)} onBlur={() => { if (typing.trim()) onChange(typing.trim()); setTyping(null); }} placeholder="例：小紅書" />
      </label>
    );
  return <Choice label={label} value={value} placeholder="不指定" options={[...opts.map((c) => ({ value: c, label: c })), { value: "__other__", label: "＋ 其他…" }]} onChange={(v) => (v === "__other__" ? setTyping("") : onChange(v))} />;
}
