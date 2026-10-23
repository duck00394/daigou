"use client";
// 統一的單選：下拉式選單（取代一排一排的按鈕）。value 用 "" 代表沒選／未指定。
export type ChoiceOpt = { value: string; label: string; disabled?: boolean };

export function Choice({ label, value, options, onChange, hint, placeholder, className = "", disabled, required, highlight }: { label: string; value: string; options: ChoiceOpt[]; onChange: (v: string) => void; hint?: React.ReactNode; placeholder?: string; className?: string; disabled?: boolean; required?: boolean; highlight?: boolean }) {
  return (
    <label className={`block text-[13px] font-medium text-ink-2 ${className}`}>
      <span className="mb-1 block">{label}{required && <span className="ml-0.5 text-bad" aria-hidden>*</span>}</span>
      <select
        aria-label={label}
        disabled={disabled}
        className={`min-h-11 w-full rounded-lg border bg-white px-2.5 text-[15px] font-normal text-ink disabled:opacity-60 ${highlight ? "border-[#f0dfa8] bg-warn-soft" : "border-line"}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined && <option value="" disabled={required}>{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      {hint && <span className="mt-1 block text-[12px] font-normal text-mute">{hint}</span>}
    </label>
  );
}
