"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelWaitAction, lookupAction, mailMyOrdersAction } from "../actions";

export function OrderFilter({ value, counts }: { value: string; counts: { open: number; wait: number; done: number; cancelled: number } }) {
  const router = useRouter();
  return (
    <select
      aria-label="顯示"
      value={value}
      onChange={(e) => router.push(`/shop/orders?show=${e.target.value}`)}
      className="h-[46px] rounded-full border border-shop-line bg-white px-4 text-[15px] text-shop-ink"
    >
      <option value="open">進行中（{counts.open}）</option>
      <option value="wait">候補中（{counts.wait}）</option>
      <option value="done">已完成（{counts.done}）</option>
      <option value="cancelled">已取消（{counts.cancelled}）</option>
    </select>
  );
}

export function CancelWait({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("確定不排候補了嗎？")) return;
        start(async () => {
          const r = await cancelWaitAction(id);
          if (!r.ok) alert(r.error);
          router.refresh();
        });
      }}
      className="h-10 shrink-0 rounded-full border border-[#ddd0c3] bg-white px-3.5 text-[13px] text-shop-ink disabled:opacity-50"
    >
      取消候補
    </button>
  );
}

const inputCls = "h-[46px] w-full min-w-0 rounded-[14px] border border-[#e6dace] bg-[#fdfaf6] px-3.5 text-[16px] text-shop-ink";

/** 訂單編號＋查詢碼查詢 */
export function LookupForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ no: "", code: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2.5 rounded-[20px] border border-shop-line bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await lookupAction(f.no, f.code);
          if (r.ok) router.push(`/shop/o/${r.data.orderId}?t=${r.data.token}`);
          else setErr(r.error);
        });
      }}
    >
      <div className="text-[16px] font-bold">用訂單編號查詢</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-[12px] text-shop-mute">訂單編號
          <input className={inputCls} value={f.no} maxLength={20} onChange={(e) => setF({ ...f, no: e.target.value })} placeholder="O261103-012" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[12px] text-shop-mute">查詢碼
          <input className={`${inputCls} font-mono tracking-[2px]`} value={f.code} maxLength={8} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="6 碼" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </label>
      </div>
      {err && <p role="alert" className="text-[13px] font-bold text-shop-rose-2">{err}</p>}
      <button type="submit" disabled={pending || !f.no || f.code.length < 6} className="h-12 rounded-full bg-shop-ink text-[15px] font-bold text-white disabled:opacity-50">{pending ? "查詢中…" : "查詢"}</button>
    </form>
  );
}

/** 忘記查詢碼：寄所有訂單的連結到下單時的 Email */
export function MailMeForm() {
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-col gap-2.5 rounded-[20px] border border-shop-line bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        start(async () => {
          const r = await mailMyOrdersAction(email);
          setMsg(r.ok ? { ok: true, text: "如果這個 Email 有訂單，我們已經寄出連結，請到信箱查看（30 分鐘內有效）。" } : { ok: false, text: r.error });
        });
      }}
    >
      <div className="text-[16px] font-bold">換手機或找不到查詢碼</div>
      <p className="text-[13px] text-shop-mute">輸入下單時填的 Email，我們會把這個 Email 的所有訂單寄給你。</p>
      <input className={inputCls} type="email" inputMode="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      {msg && <p role="status" className={`text-[13px] ${msg.ok ? "text-shop-good" : "font-bold text-shop-rose-2"}`}>{msg.text}</p>}
      <button type="submit" disabled={pending || !email.includes("@")} className="h-12 rounded-full border border-[#d8c9bc] bg-white text-[15px] font-bold text-shop-ink-2 disabled:opacity-50">{pending ? "寄送中…" : "寄給我"}</button>
    </form>
  );
}
