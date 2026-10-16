"use client";
// 舊商品名稱改成新格式（活動＋角色＋種類）：先列出會怎麼改，按了才改
import { useState } from "react";
import { Button, Modal, useRun } from "@/components/client";
import { applyRenameAction } from "@/actions/series";

export function RenameNames({ categoryId, plan }: { categoryId: string; plan: { productId: string; from: string; to: string }[] }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useRun();
  if (!plan.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#f0dfa8] bg-warn-soft px-4 py-2.5 text-[14px] text-warn" data-testid="rename-banner">
      <span>
        有 {plan.length} 個商品還是舊名稱（例：{plan[0].from} → <b>{plan[0].to}</b>）
      </span>
      <Button small onClick={() => setOpen(true)}>改成新格式</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="商品名稱改成新格式"
        footer={<Button variant="primary" loading={pending} onClick={() => run(() => applyRenameAction(categoryId, plan.map((p) => p.productId)), { success: `已改好 ${plan.length} 個商品名稱`, onOk: () => setOpen(false) })}>改 {plan.length} 個</Button>}
      >
        <p className="mb-2 text-[13px] text-mute">只改顯示的名稱，庫存、成本和以前的紀錄都不會變。</p>
        <ul className="max-h-[50vh] divide-y divide-line-2 overflow-y-auto text-sm">
          {plan.map((p) => (
            <li key={p.productId} className="py-1.5">
              <div className="text-[12px] text-mute line-through">{p.from}</div>
              <div className="font-medium">{p.to}</div>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
