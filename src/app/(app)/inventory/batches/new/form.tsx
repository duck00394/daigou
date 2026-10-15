"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextField, SelectField, TextArea, useRun, inputCls, notify } from "@/components/client";
import { OperatorPicker, type OperatorOption } from "@/components/operator-picker";
import { createBatchAction } from "@/actions/ops";
import { saveSupplierAction } from "@/actions/series";
import { toDateTimeInput } from "@/lib/labels";

type Template = {
  fromBatch: { id: string; code: string; name: string };
  supplierId: string | null;
  orderedById: string | null;
  paymentResponsibleById: string | null;
  receivingResponsibleById: string | null;
};
type Resp = { orderedById: string | null; paymentResponsibleById: string | null; receivingResponsibleById: string | null };

export function NewBatchForm({ suppliers: init, defaultRate, operators, templates, initialFrom }: { suppliers: { id: string; name: string }[]; defaultRate: string; operators: OperatorOption[]; templates: Template[]; initialFrom: string | null }) {
  const [suppliers, setSuppliers] = useState(init);
  const first = templates.find((x) => x.fromBatch.id === initialFrom) ?? null;
  const [f, setF] = useState({ name: "", supplierId: first?.supplierId ?? init[0]?.id ?? "", rate: defaultRate, orderedAt: toDateTimeInput(new Date()), notes: "", responsibilityNote: "" });
  const [resp, setResp] = useState<Resp>(first ? pick(first) : { orderedById: null, paymentResponsibleById: null, receivingResponsibleById: null });
  const [copiedFrom, setCopiedFrom] = useState<Template | null>(first);
  const [confirmed, setConfirmed] = useState(false);
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const { run, pending } = useRun();
  const router = useRouter();
  const needConfirm = !!copiedFrom && !confirmed;
  const setR = (k: keyof Resp) => (v: string | null) => setResp((r) => ({ ...r, [k]: v }));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim()) return notify("請填寫採購團名稱");
        if (needConfirm) return notify("請先確認從其他採購團帶入的負責人");
        run(() => createBatchAction({ name: f.name, supplierId: f.supplierId || null, rate: f.rate, orderedAt: f.orderedAt, notes: f.notes || null, items: [], ...resp, responsibilityNote: f.responsibilityNote || null }), {
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

      <fieldset className="space-y-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-[14px] font-semibold">負責人</legend>
        {templates.length > 0 && (
          <SelectField
            label="沿用其他採購團的負責人（選填）"
            value={copiedFrom?.fromBatch.id ?? ""}
            onChange={(e) => {
              const tpl = templates.find((x) => x.fromBatch.id === e.target.value) ?? null;
              setCopiedFrom(tpl);
              setConfirmed(false);
              if (tpl) setResp(pick(tpl));
            }}
            options={[["", "不沿用"], ...templates.map((x) => [x.fromBatch.id, `${x.fromBatch.code} ${x.fromBatch.name}`] as [string, string])]}
            hint="只帶入三位負責人，不會複製付款或收貨紀錄。"
          />
        )}
        <OperatorPicker label="訂購負責人（負責下單）" operators={operators} value={resp.orderedById} onChange={setR("orderedById")} highlight={needConfirm} />
        <OperatorPicker label="主要付款負責人（安排付款）" operators={operators} value={resp.paymentResponsibleById} onChange={setR("paymentResponsibleById")} highlight={needConfirm} hint="實際是誰付的錢，請在採購團頁面逐筆登記付款。" />
        <OperatorPicker label="收貨負責人（主要清點）" operators={operators} value={resp.receivingResponsibleById} onChange={setR("receivingResponsibleById")} highlight={needConfirm} hint="每次到貨仍要記錄實際收貨確認人。" />
        <TextField label="負責人備註（選填）" value={f.responsibilityNote} onChange={(e) => setF({ ...f, responsibilityNote: e.target.value })} />
        {copiedFrom && (
          <label className={`flex items-start gap-2 rounded-lg p-2 text-sm ${confirmed ? "bg-good-soft" : "bg-warn-soft"}`}>
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>已確認負責人（由 {copiedFrom.fromBatch.code} 帶入，可在上方修改）</span>
          </label>
        )}
      </fieldset>

      <TextArea label="備註" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <Button type="submit" variant="primary" loading={pending} disabled={needConfirm}>建立採購團</Button>
    </form>
  );
}

function pick(x: Template): Resp {
  return { orderedById: x.orderedById, paymentResponsibleById: x.paymentResponsibleById, receivingResponsibleById: x.receivingResponsibleById };
}
