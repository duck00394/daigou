"use client";
import { useState } from "react";
import { Button, Modal, TextField, SelectField, useRun, useIdemKey, notify, DateTimeField } from "@/components/client";
import { payForBuyerAction } from "@/actions/orders";
import { formatTwd } from "@/lib/money";
import { toDateTimeInput } from "@/lib/labels";

export function CollectForBuyer({ buyerId, buyerName, due }: { buyerId: string; buyerName: string; due: number }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: String(due), method: "轉帳", reference: "", paidAt: toDateTimeInput(new Date()) });
  const { run, pending } = useRun();
  const idem = useIdemKey();
  return (
    <>
      <Button small variant="primary" onClick={() => { setF((x) => ({ ...x, amount: String(due) })); setOpen(true); }}>登記收款</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${buyerName} 收款`} footer={
        <Button variant="primary" loading={pending} onClick={() => {
          const amount = Number(f.amount.replace(/[,\s]/g, ""));
          if (!Number.isInteger(amount) || amount <= 0) return notify("金額必須是正整數");
          run(() => payForBuyerAction({ buyerId, amount, method: f.method, reference: f.reference || null, paidAt: f.paidAt, dedupeKey: idem.key }), {
            success: (d) => `已登記收款，沖銷 ${d.orders.length} 張訂單`,
            onOk: () => { idem.renew(); setOpen(false); },
          });
        }}>登記收款</Button>
      }>
        <p className="mb-3 text-sm text-ink-2">待收合計 {formatTwd(due)}。一筆匯款會依訂單日期由舊到新沖銷，每張訂單各留一筆付款紀錄。</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="金額" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <DateTimeField label="付款時間" value={f.paidAt} onChange={(v) => setF({ ...f, paidAt: v })} />
          <SelectField label="方式" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={[["轉帳", "轉帳"], ["現金", "現金"], ["LINE Pay", "LINE Pay"], ["街口", "街口"], ["其他", "其他"]]} />
          <TextField label="識別資訊" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="例：末五碼" />
        </div>
      </Modal>
    </>
  );
}
