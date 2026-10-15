"use client";
import { useState } from "react";
import { Button, ConfirmButton, Modal, TextField, SelectField, useRun, inputCls, notify } from "@/components/client";
import { ProductPicker, type ProductOpt } from "@/components/pickers";
import { addBatchCostAction, deleteBatchCostAction, updateBatchItemAction, addBatchItemAction, cancelBatchAction } from "@/actions/ops";
import { allocMethod, costKind } from "@/lib/labels";

export function AddCost({ batchId, items }: { batchId: string; items: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: "INTL_SHIPPING", currency: "TWD", amount: "", method: "BY_QTY", note: "" });
  const [manual, setManual] = useState<Record<string, string>>({});
  const { run, pending } = useRun();
  return (
    <>
      <Button small variant="primary" onClick={() => setOpen(true)}>新增共同費用</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新增共同費用"
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              const amount = Number(f.amount);
              if (!Number.isInteger(amount) || amount < 0) return notify("金額必須是整數");
              const split = f.method === "MANUAL" ? Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v) || 0])) : null;
              run(() => addBatchCostAction({ batchId, kind: f.kind as never, currency: f.currency as never, amount, method: f.method as never, manualSplit: split, note: f.note || null }), { success: "已新增費用並重新分攤", onOk: () => setOpen(false) });
            }}
          >
            新增並分攤
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="費用類型" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={Object.entries(costKind)} />
          <SelectField label="幣別" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} options={[["TWD", "台幣"], ["JPY", "日幣（以本批匯率換算）"]]} />
          <TextField label="金額" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <SelectField label="分攤方式" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={Object.entries(allocMethod)} />
          <TextField label="備註" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="sm:col-span-2" />
        </div>
        {f.method === "MANUAL" && (
          <div className="mt-3 space-y-2">
            <p className="text-[13px] text-mute">手動分配（台幣），合計必須等於費用金額。</p>
            {items.map((i) => (
              <label key={i.id} className="flex items-center justify-between gap-2 text-sm">
                {i.name}
                <input className={`${inputCls} w-28 text-right`} inputMode="numeric" value={manual[i.id] ?? ""} onChange={(e) => setManual({ ...manual, [i.id]: e.target.value })} />
              </label>
            ))}
          </div>
        )}
        {f.method === "BY_WEIGHT" && <p className="mt-2 text-[13px] text-mute">依重量分攤時，每一項採購明細都要填寫重量。</p>}
      </Modal>
    </>
  );
}

export function DeleteCost({ id }: { id: string }) {
  const { run } = useRun();
  return <ConfirmButton small variant="danger" label="刪除" title="刪除費用" message="刪除後會重新分攤本批其他費用，已出貨商品的成本也會跟著更新。" confirmLabel="刪除費用" onConfirm={() => run(() => deleteBatchCostAction(id), { success: "已刪除費用" })} />;
}

export function EditBatchItem({ item }: { item: { id: string; name: string; unitCostJpy: number; weightGrams: number | null; cancellable: number } }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ jpy: String(item.unitCostJpy), w: item.weightGrams == null ? "" : String(item.weightGrams), cancel: "" });
  const { run, pending } = useRun();
  return (
    <>
      <Button small onClick={() => setOpen(true)}>修改</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`修改「${item.name}」`} footer={
        <Button variant="primary" loading={pending} onClick={() => {
          const jpy = Number(f.jpy);
          const w = f.w === "" ? null : Number(f.w);
          const c = f.cancel === "" ? 0 : Number(f.cancel);
          if (!Number.isInteger(jpy) || jpy < 0 || (w !== null && (!Number.isInteger(w) || w < 0)) || !Number.isInteger(c) || c < 0) return notify("請輸入正確的整數");
          run(() => updateBatchItemAction(item.id, { unitCostJpy: jpy, weightGrams: w, cancelQty: c || undefined }), { success: "已儲存", onOk: () => setOpen(false) });
        }}>儲存</Button>
      }>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="日幣單價" inputMode="numeric" value={f.jpy} onChange={(e) => setF({ ...f, jpy: e.target.value })} />
          <TextField label="本筆總重（公克）" inputMode="numeric" value={f.w} onChange={(e) => setF({ ...f, w: e.target.value })} />
          <TextField label={`取消未到貨數量（最多 ${item.cancellable}）`} inputMode="numeric" value={f.cancel} onChange={(e) => setF({ ...f, cancel: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}

export function AddBatchItem({ batchId }: { batchId: string }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<ProductOpt | null>(null);
  const [qty, setQty] = useState("");
  const [jpy, setJpy] = useState("");
  const { run, pending } = useRun();
  return (
    <>
      <Button small onClick={() => setOpen(true)}>新增採購商品</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="新增採購商品" footer={
        <Button variant="primary" loading={pending} onClick={() => {
          if (!p) return notify("請選擇商品");
          run(() => addBatchItemAction(batchId, { productId: p.id, qty: Number(qty), unitCostJpy: Number(jpy) }), { success: "已新增", onOk: () => setOpen(false) });
        }}>新增</Button>
      }>
        <div className="grid gap-3">
          <ProductPicker value={p} onPick={setP} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="數量" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
            <TextField label="日幣單價" inputMode="numeric" value={jpy} onChange={(e) => setJpy(e.target.value)} />
          </div>
        </div>
      </Modal>
    </>
  );
}

export function CancelBatch({ id }: { id: string }) {
  const { run } = useRun();
  return <ConfirmButton variant="danger" label="取消批次" title="取消採購批次" message="只有完全沒有到貨紀錄的批次可以取消。相關訂單明細的採購狀態不會自動改回，請視需要調整。" confirmLabel="取消批次" onConfirm={() => run(() => cancelBatchAction(id), { success: "已取消批次" })} />;
}
