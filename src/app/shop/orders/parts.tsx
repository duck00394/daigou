"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cancelWaitAction } from "../actions";

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
