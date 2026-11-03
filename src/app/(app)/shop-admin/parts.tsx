"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, inputCls, useRun } from "@/components/client";
import { bindOperatorLineAction, setContactFieldAction, setShopInfoAction, setShopNameAction } from "@/actions/shop";

export function ShopName({ name }: { name: string }) {
  const [v, setV] = useState(name);
  const { run, pending } = useRun();
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setShopNameAction(v), { success: "店名已更新" });
      }}
    >
      <label className="block min-w-0 flex-1 text-[13px] font-medium text-ink-2">
        店名（顯示在訂購頁最上面）
        <input className={`${inputCls} mt-1`} value={v} maxLength={20} onChange={(e) => setV(e.target.value)} />
      </label>
      <Button type="submit" loading={pending} disabled={!v.trim() || v === name}>存</Button>
    </form>
  );
}

export function OpenSeries({ cats }: { cats: { id: string; name: string }[] }) {
  const router = useRouter();
  const [id, setId] = useState("");
  return (
    <div className="flex items-end gap-2">
      <label className="block min-w-0 flex-1 text-[13px] font-medium text-ink-2">
        設定新的系列
        <select aria-label="選系列" className={`${inputCls} mt-1`} value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">選系列…</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <Button variant="primary" disabled={!id} onClick={() => router.push(`/shop-admin/${id}`)}>設定</Button>
    </div>
  );
}

export function OperatorLine({ op, current, choices }: { op: { id: string; name: string }; current: string; choices: { id: string; label: string }[] }) {
  const [v, setV] = useState(current === "keep" ? "keep" : current);
  const { run, pending } = useRun();
  return (
    <div className="flex items-end gap-2">
      <label className="block min-w-0 flex-1 text-[13px] font-medium text-ink-2">
        {op.name} 的 LINE
        <select aria-label={`${op.name} 的 LINE`} className={`${inputCls} mt-1`} value={v} onChange={(e) => setV(e.target.value)}>
          <option value="">不通知</option>
          {current === "keep" && <option value="keep">（已綁定）</option>}
          {choices.map((c) => <option key={c.id} value={c.id}>這是我：{c.label}</option>)}
        </select>
      </label>
      <Button loading={pending} disabled={v === current || v === "keep"} onClick={() => run(() => bindOperatorLineAction(op.id, v || null), { success: v ? `之後${op.name}負責的系列有新訂單會通知這個 LINE` : "已取消通知" })}>存</Button>
    </div>
  );
}

export function ContactFieldForm({ mode: m0, label: l0 }: { mode: "phone" | "text" | "none"; label: string }) {
  const [mode, setMode] = useState(m0);
  const [label, setLabel] = useState(m0 === "text" ? l0 : "脆 ID 或 IG 帳號");
  const { run, pending } = useRun();
  const changed = mode !== m0 || (mode === "text" && label.trim() !== l0);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setContactFieldAction(mode, label), { success: "結帳欄位已更新" });
      }}
    >
      <label className="block min-w-[140px] flex-1 text-[13px] font-medium text-ink-2">
        結帳時客人要留
        <select aria-label="客人要留的聯絡方式" className={`${inputCls} mt-1`} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="text">帳號（自己取欄位名稱）</option>
          <option value="phone">手機號碼</option>
          <option value="none">不用留（只留暱稱）</option>
        </select>
      </label>
      {mode === "text" && (
        <label className="block min-w-[140px] flex-1 text-[13px] font-medium text-ink-2">
          欄位名稱
          <input aria-label="欄位名稱" className={`${inputCls} mt-1`} value={label} maxLength={20} onChange={(e) => setLabel(e.target.value)} placeholder="例如：脆 ID 或 IG 帳號" />
        </label>
      )}
      <Button type="submit" loading={pending} disabled={!changed || (mode === "text" && !label.trim())}>存</Button>
    </form>
  );
}

export function ShopInfoForm({ threads: t0, supportEmail: e0 }: { threads: string; supportEmail: string }) {
  const [threads, setThreads] = useState(t0);
  const [email, setEmail] = useState(e0);
  const { run, pending } = useRun();
  const changed = threads.trim() !== t0 || email.trim() !== e0;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setShopInfoAction(threads, email), { success: "客服資料已更新" });
      }}
    >
      <label className="block text-[13px] font-medium text-ink-2">
        Threads 帳號（客人在成立頁按「Threads 客服」會打開）
        <input aria-label="Threads 帳號" className={`${inputCls} mt-1`} value={threads} maxLength={60} onChange={(e) => setThreads(e.target.value)} placeholder="例如：ura_treasure（不用打 @）" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </label>
      <label className="block text-[13px] font-medium text-ink-2">
        客服 Email（寫在訂單憑證、交易規則、隱私權政策）
        <input aria-label="客服 Email" type="email" className={`${inputCls} mt-1`} value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </label>
      <Button type="submit" loading={pending} disabled={!changed}>存</Button>
    </form>
  );
}
