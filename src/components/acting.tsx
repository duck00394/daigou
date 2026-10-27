"use client";
// 「現在看誰的」選了誰，賣東西、買東西就預設是誰的，只顯示一行提醒；要換別人才按「換人」打開選單。
import { useState } from "react";
import { Choice, type ChoiceOpt } from "./choice";

export function ActingChoice({ label, value, options, onChange, defaultValue, noun, testid = "acting" }: { label: string; value: string; options: ChoiceOpt[]; onChange: (v: string) => void; defaultValue: string; noun: string; testid?: string }) {
  const [open, setOpen] = useState(false);
  const name = (v: string) => (options.find((o) => o.value === v)?.label ?? "").replace(/（我）$/, "");
  if (!open && value === defaultValue && defaultValue) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-[#c9d6ec] bg-[#eef3fb] px-3 py-2" data-testid={testid}>
        <span className="text-[14px] text-ink">
          這是 <b data-testid={`${testid}-name`}>{name(value)}</b> 的{noun}
          <span className="ml-1 text-[12px] text-mute">（跟著「現在看誰的」）</span>
        </span>
        <button type="button" className="shrink-0 rounded-lg border border-line bg-white px-2.5 py-1 text-[13px] text-ai" onClick={() => setOpen(true)}>換人</button>
      </div>
    );
  }
  return (
    <div data-testid={testid}>
      <Choice label={label} value={value} options={options} onChange={onChange} highlight={!!defaultValue && value !== defaultValue} hint={defaultValue && value !== defaultValue ? `不是「現在看誰的」（${name(defaultValue)}），存之前再確認一下。` : undefined} />
    </div>
  );
}
