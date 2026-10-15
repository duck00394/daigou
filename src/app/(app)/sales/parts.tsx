"use client";
import { useState } from "react";
import { Button, Modal, TextField, useRun } from "@/components/client";
import { voidQuickSaleAction } from "@/actions/sales";

export function VoidSaleButton({ orderId, label }: { orderId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending } = useRun();
  return (
    <>
      <Button small variant="danger" onClick={() => { setReason(""); setOpen(true); }}>作廢</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`作廢出售：${label}`}
        footer={<Button variant="danger" loading={pending} disabled={!reason.trim()} onClick={() => run(() => voidQuickSaleAction(orderId, reason), { success: "已作廢，商品已退回庫存", onOk: () => setOpen(false) })}>作廢</Button>}
      >
        <p className="mb-3 text-sm">商品會退回原本的採購批次、這筆收入與成本歸零、自動登記的收款會作廢。原紀錄保留，可在「顯示已作廢」看到。</p>
        <TextField label="作廢原因（必填）" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}
