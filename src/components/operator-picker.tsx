"use client";
// 經營者快速選擇：一排大按鈕（手機好點），不藏在下拉選單裡
import { useId } from "react";

export type OperatorOption = { id: string; name: string; code: string };

export function OperatorPicker({
  label,
  operators,
  value,
  onChange,
  allowNone = true,
  required,
  hint,
  highlight,
}: {
  label: string;
  operators: OperatorOption[];
  value: string | null;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
  required?: boolean;
  hint?: React.ReactNode;
  highlight?: boolean; // 由其他採購團帶入、尚待確認
}) {
  const id = useId();
  const opts: [string | null, string][] = [...operators.map((o) => [o.id, o.name] as [string, string]), ...(allowNone ? [[null, "未指定"] as [null, string]] : [])];
  return (
    <div role="radiogroup" aria-labelledby={id} aria-required={required || undefined}>
      <div id={id} className="mb-1 text-[13px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-bad" aria-hidden>*</span>}
      </div>
      <div className={`flex flex-wrap gap-1.5 ${highlight ? "rounded-lg bg-warn-soft/60 p-1" : ""}`}>
        {opts.map(([v, name]) => {
          const on = value === v;
          return (
            <button
              key={v ?? "none"}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(v)}
              className={`min-h-10 min-w-[4.5rem] rounded-lg border px-3 py-1.5 text-[15px] ${on ? (v ? "border-ai bg-ai text-white" : "border-ink-2 bg-ink-2 text-white") : "border-line bg-white text-ink hover:border-ai"}`}
            >
              {name}
            </button>
          );
        })}
      </div>
      {hint && <p className="mt-1 text-[12px] text-mute">{hint}</p>}
    </div>
  );
}

export function operatorName(operators: { id: string; name: string }[], id: string | null | undefined) {
  if (!id) return "未指定";
  return operators.find((o) => o.id === id)?.name ?? "（已移除）";
}
