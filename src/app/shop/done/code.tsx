"use client";
// 成立頁的查詢碼：只在送出的這支手機上顯示一次（伺服器只存雜湊，之後也查不回來）
import { useEffect, useState } from "react";

export function LookupCode({ ids }: { ids: string[] }) {
  const [code, setCode] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem("dg_done") ?? "null");
      setCode(v && Array.isArray(v.ids) && ids.every((i) => v.ids.includes(i)) ? (v.code ?? null) : null);
    } catch {
      setCode(null);
    }
  }, [ids]);
  if (code === undefined) return <span className="text-[13px] text-shop-mute">…</span>;
  if (!code) return <span className="text-[13px] text-shop-mute">已寄到 Email／LINE</span>;
  return <span className="font-mono text-[18px] font-bold text-shop-rose-2">{code}</span>;
}
