"use client";
import { useState } from "react";
import { Impact } from "@/components/help";
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
        <div className="mb-3 text-sm"><Impact items={["賣掉的商品退回庫存（回到原本那一團）", "這筆的收入、成本、賺多少歸零", "賣的時候自動記的收款作廢"]} keep={["原紀錄（按「顯示已作廢」看得到）", "另外手動記的收款（會顯示要退給客人）"]} /></div>
        <TextField label="作廢原因（必填）" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}
