"use client";
// 送出訂單後自動跳回 LINE 聊天室（不在 LINE 裡打開時也可以按按鈕）
import { useEffect } from "react";

export function GoLine({ href }: { href: string }) {
  useEffect(() => {
    const t = setTimeout(() => {
      location.href = href;
    }, 1800);
    return () => clearTimeout(t);
  }, [href]);
  return (
    <a href={href} className="flex h-14 w-full max-w-xs items-center justify-center gap-2.5 rounded-full bg-[#078a3e] text-[17px] font-bold text-white">
      <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#078a3e]">LINE</span>回到 LINE 看訂單
    </a>
  );
}
