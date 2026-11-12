"use client";
// 客人回傳匯款末五碼（確認前可以改）
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reportDepositAction } from "../actions";

export function DepositForm({ orderId, token, current }: { orderId: string; token: string; current: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(current ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        start(async () => {
          const r = await reportDepositAction(orderId, token, v);
          // 成功時上面會顯示「已回傳末五碼…」，這裡不再重複
          if (r.ok) router.refresh();
          else setMsg({ ok: false, text: r.error });
        });
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input
          aria-label="匯款帳號末五碼"
          inputMode="numeric"
          maxLength={5}
          className="h-[46px] min-w-0 rounded-[14px] border border-tone-orange-200 bg-tone-sand-50 px-3.5 font-mono text-[18px] text-shop-ink"
          value={v}
          onChange={(e) => setV(e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="末五碼"
        />
        <button type="submit" disabled={pending || v.length !== 5} className="h-[46px] rounded-full bg-shop-rose px-5 text-[15px] font-bold text-white disabled:opacity-50">
          {pending ? "回傳中…" : current ? "更改" : "回傳"}
        </button>
      </div>
      {msg && <p role="status" className={`text-[13px] ${msg.ok ? "text-shop-good" : "font-bold text-shop-rose-2"}`}>{msg.text}</p>}
    </form>
  );
}
