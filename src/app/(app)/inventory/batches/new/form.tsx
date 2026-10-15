"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextField, SelectField, TextArea, useRun, inputCls, notify } from "@/components/client";
import { createBatchAction } from "@/actions/ops";
import { saveSupplierAction } from "@/actions/series";
import { toDateTimeInput } from "@/lib/labels";

export function NewBatchForm({ suppliers: init, defaultRate }: { suppliers: { id: string; name: string }[]; defaultRate: string }) {
  const [suppliers, setSuppliers] = useState(init);
  const [f, setF] = useState({ name: "", supplierId: init[0]?.id ?? "", rate: defaultRate, orderedAt: toDateTimeInput(new Date()), notes: "" });
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const { run, pending } = useRun();
  const router = useRouter();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim()) return notify("請填寫採購團名稱");
        run(() => createBatchAction({ name: f.name, supplierId: f.supplierId || null, rate: f.rate, orderedAt: f.orderedAt, notes: f.notes || null, items: [] }), {
          success: "已建立採購團，接著批次新增系列商品",
          onOk: (d) => router.push(`/inventory/batches/${d.id}?bulk=1`),
        });
      }}
    >
      <TextField label="採購團名稱" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：10/20 吉伊卡哇官網團" />
      <div>
        {newSupplier === null ? (
          <div className="flex items-end gap-2">
            <SelectField className="flex-1" label="供應商" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} options={[["", "不指定"], ...suppliers.map((s) => [s.id, s.name] as [string, string])]} />
            <Button onClick={() => setNewSupplier("")}>新增供應商</Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <label className="flex-1 text-[13px] font-medium text-ink-2">
              新供應商名稱
              <input autoFocus className={`${inputCls} mt-1`} value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
            </label>
            <Button variant="primary" onClick={async () => {
              const r = await saveSupplierAction(null, { name: newSupplier, defaultCurrency: "JPY" });
              if (!r.ok) return notify(r.error);
              setSuppliers((l) => [...l, r.data]);
              setF((x) => ({ ...x, supplierId: r.data.id }));
              setNewSupplier(null);
            }}>建立</Button>
            <Button onClick={() => setNewSupplier(null)}>取消</Button>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="匯率（1 日圓 = ? 台幣）" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} hint="建立後鎖定，之後修改預設匯率不影響這一團" inputMode="decimal" />
        <TextField label="下單時間" type="datetime-local" value={f.orderedAt} onChange={(e) => setF({ ...f, orderedAt: e.target.value })} />
      </div>
      <TextArea label="備註" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <Button type="submit" variant="primary" loading={pending}>建立採購團</Button>
    </form>
  );
}
