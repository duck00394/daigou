"use client";
// 手機：表格一列變一張小卡片，每格前面自動加上欄位名稱（從表頭抄過來），不用往右拉；電腦版照舊是表格
import { useEffect, useRef } from "react";

function label(table: HTMLTableElement) {
  const head = table.tHead?.rows[0];
  if (!head) return;
  const names: string[] = [];
  for (const th of Array.from(head.cells)) {
    const text = (th.querySelector(".sr-only") ? "" : th.textContent ?? "").trim();
    for (let i = 0; i < (th.colSpan || 1); i++) names.push(text);
  }
  for (const body of Array.from(table.tBodies)) {
    for (const tr of Array.from(body.rows)) {
      let col = 0;
      for (const td of Array.from(tr.cells)) {
        if (!td.hasAttribute("data-label")) td.setAttribute("data-label", (td.colSpan || 1) > 1 ? "" : (names[col] ?? ""));
        // 沒有內容的格（「—」或空白、也沒有按鈕或勾選框）手機上不列，卡片短一點
        const blank = /^[—–-]?$/.test((td.textContent ?? "").trim()) && !td.querySelector("input,button,select,a,img");
        if (blank) td.setAttribute("data-empty", "");
        else td.removeAttribute("data-empty");
        col += td.colSpan || 1;
      }
    }
  }
}

export function StackTable({ children, maxH, className }: { children: React.ReactNode; maxH?: string; className: string }) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    label(t);
    const mo = new MutationObserver(() => label(t));
    mo.observe(t, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return (
    <div className="stack-wrap overflow-auto" style={maxH ? { maxHeight: maxH } : undefined}>
      <table ref={ref} className={`stack-table ${className}`}>{children}</table>
    </div>
  );
}
