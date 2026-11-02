"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, inputCls, useRun } from "@/components/client";
import { bindOperatorLineAction, setShopNameAction } from "@/actions/shop";

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
