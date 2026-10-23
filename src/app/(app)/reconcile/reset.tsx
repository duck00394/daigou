"use client";
// 改回待確認：不小心變成已對完的團，整批改回來重新對
import { useState } from "react";
import { Button, Modal, useRun } from "@/components/client";
import { recordRefundAction, resetReconcileAction } from "@/actions/reconcile";
import { formatTwd } from "@/lib/money";

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

/** 代購退錢了：記退款，記完就從「已砍單，未退款」拿掉 */
export function RefundButton({ batchId, name, owed }: { batchId: string; name: string; owed: number }) {
  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState(String(owed));
  const { run, pending } = useRun();
  const n = Number(amt.replace(/[^\d]/g, "") || 0);
  return (
    <>
      <button type="button" className="mt-1 min-h-9 rounded-lg border border-line bg-white px-3 text-[13px]" onClick={() => setOpen(true)}>記退款</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${name}：代購退款`}
        footer={<Button variant="primary" loading={pending} disabled={n <= 0} onClick={() => run(() => recordRefundAction(batchId, n), { success: `已記退款 ${formatTwd(n)}`, onOk: () => setOpen(false) })}>記退款 {formatTwd(n)}</Button>}
      >
        <label className="block text-[14px] font-medium text-ink-2">
          退了多少（台幣）
          <input aria-label="退了多少" inputMode="numeric" className="mt-1 min-h-11 w-full rounded-lg border border-line px-2.5 text-[16px]" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ""))} />
        </label>
        <p className="mt-1 text-[12px] text-mute">應該退 {formatTwd(owed)}。只退一部分就填實際退的，剩下的會繼續列著。</p>
      </Modal>
    </>
  );
}
