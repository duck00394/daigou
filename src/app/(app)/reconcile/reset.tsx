"use client";
// 改回待確認：不小心變成已對完的團，整批改回來重新對
import { useState } from "react";
import { Button, Modal, useRun } from "@/components/client";
import { resetReconcileAction } from "@/actions/reconcile";

export function ResetButton({ ids, label, names }: { ids: string[]; label: string; names: string[] }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useRun();
  if (!ids.length) return null;
  return (
    <>
      <button type="button" className="min-h-10 rounded-lg border border-line bg-white px-3 text-[14px] text-warn" onClick={() => setOpen(true)}>{label}</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="改回待確認"
        footer={<Button variant="primary" loading={pending} onClick={() => run(() => resetReconcileAction(ids), { success: (d) => `已把 ${d.batches} 團改回待確認`, onOk: () => setOpen(false) })}>改回待確認（{ids.length} 團）</Button>}
      >
        <p className="text-[14px]">這些團會變回「待確認」，要再用對單確認買到幾件。已經到貨的還是算買到，砍掉的、付款都不會變。</p>
        <ul className="mt-2 max-h-56 list-disc overflow-y-auto pl-5 text-[14px] text-ink-2">{names.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </Modal>
    </>
  );
}
