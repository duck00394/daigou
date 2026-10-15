"use client";
import { useState } from "react";
import { Button, Modal, TextField, TextArea, SelectField, useRun } from "@/components/client";
import { saveSupplierAction } from "@/actions/series";
import { supplierKind } from "@/lib/labels";

type S = { id: string; name: string; defaultCurrency: string; kind: string | null; contact: string | null; paymentMethod: string | null; orderUrl: string | null; notes: string | null; active: boolean };

export function SupplierEditButton({ supplier }: { supplier?: S }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: supplier?.name ?? "", defaultCurrency: supplier?.defaultCurrency ?? "JPY", kind: supplier?.kind ?? "", contact: supplier?.contact ?? "", paymentMethod: supplier?.paymentMethod ?? "", orderUrl: supplier?.orderUrl ?? "", notes: supplier?.notes ?? "", active: supplier?.active ?? true });
  const { run, pending } = useRun();
  return (
    <>
      <Button variant={supplier ? "default" : "primary"} small={!!supplier} onClick={() => setOpen(true)}>{supplier ? "編輯" : "新增供應商"}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={supplier ? "編輯供應商" : "新增供應商"} footer={
        <Button variant="primary" loading={pending} onClick={() => run(() => saveSupplierAction(supplier?.id ?? null, { ...f, defaultCurrency: f.defaultCurrency as "JPY" | "TWD" }), { success: supplier ? "已儲存供應商" : "已新增供應商", onOk: () => setOpen(false) })}>
          {supplier ? "儲存供應商" : "新增供應商"}
        </Button>
      }>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="供應商名稱" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：日本官網、某某代購" />
          <SelectField label="預設幣別" value={f.defaultCurrency} onChange={(e) => setF({ ...f, defaultCurrency: e.target.value })} options={[["JPY", "日幣 JPY"], ["TWD", "台幣 TWD"]]} hint="批次新增時新商品的預設幣別" />
          <SelectField label="類型" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[["", "不指定"], ...Object.entries(supplierKind)]} />
          <TextField label="常用付款方式" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })} placeholder="例：信用卡、轉帳" />
          <TextField label="聯絡方式" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
          <TextField label="訂購連結" value={f.orderUrl} onChange={(e) => setF({ ...f, orderUrl: e.target.value })} placeholder="https://" />
          <TextArea label="備註" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="sm:col-span-2" />
          {supplier && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />啟用（取消勾選＝封存，歷史採購與成本不受影響）</label>
          )}
        </div>
      </Modal>
    </>
  );
}
