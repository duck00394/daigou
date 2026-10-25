"use client";
// 「這是什麼？」：點了才展開白話說明，不佔版面
import { useState } from "react";

/** 頁面標題：標題旁「這是什麼？」，說明展開在副標題下面 */
export function HeaderTitle({ title, sub, help }: { title: string; sub?: React.ReactNode; help?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center">
        <h1 className="round text-[22px] leading-tight font-semibold text-ink">{title}</h1>
        {help && (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="ml-2 inline-flex h-7 shrink-0 items-center rounded-full border border-[#cfdcf5] bg-white px-2.5 text-[12.5px] font-normal text-ai" data-testid="help-toggle">
            {open ? "收起說明" : "這是什麼？"}
          </button>
        )}
      </div>
      {sub && <div className="mt-1 text-sm text-mute">{sub}</div>}
      {help && open && <div className="mt-2 rounded-xl border border-[#cfdcf5] bg-[#eef4ff] px-3 py-2.5 text-[13.5px] leading-relaxed text-ink-2" data-testid="help-box">{help}</div>}
    </>
  );
}

export function HelpToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="ml-2 inline-flex h-7 shrink-0 items-center rounded-full border border-[#cfdcf5] bg-white px-2.5 align-middle text-[12.5px] font-normal text-ai" data-testid="help-toggle">
        {open ? "收起說明" : "這是什麼？"}
      </button>
      {open && (
        <div className="mt-2 w-full rounded-xl border border-[#cfdcf5] bg-[#eef4ff] px-3 py-2.5 text-[13.5px] leading-relaxed text-ink-2" data-testid="help-box">
          {children}
        </div>
      )}
    </>
  );
}

/** 說明裡的名詞＋解釋 */
export function Term({ name, tone, children }: { name: string; tone?: "good" | "info" | "warn" | "ink" | "bad"; children: React.ReactNode }) {
  const cls = { good: "bg-good-soft text-good", info: "bg-info-soft text-info", warn: "bg-warn-soft text-warn", ink: "bg-ink text-white", bad: "bg-bad-soft text-bad" }[tone ?? "info"] ?? "";
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${tone ? cls : "bg-line-2 text-ink-2"}`}>{name}</span>
      <span>{children}</span>
    </div>
  );
}
