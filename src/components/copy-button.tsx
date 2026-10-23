"use client";
// 一鍵複製（例：訂單編號，貼到賣貨便查）
import { useState } from "react";

export function CopyButton({ text, label = "複製" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded-md border border-line bg-white px-2 py-0.5 text-[12px] text-ai"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* 有些瀏覽器不允許，就手動選取 */
        }
      }}
    >
      {done ? "已複製" : label}
    </button>
  );
}
