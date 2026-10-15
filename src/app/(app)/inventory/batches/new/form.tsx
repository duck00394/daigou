"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextField, SelectField, TextArea, useRun, inputCls, notify } from "@/components/client";
import { OperatorPicker, type OperatorOption } from "@/components/operator-picker";
import { createBatchAction } from "@/actions/ops";
import { saveSupplierAction } from "@/actions/series";
import { saveCategoryAction } from "@/actions/catalog";
import { toDateTimeInput } from "@/lib/labels";

type Template = {
  fromBatch: { id: string; code: string; name: string };
  supplierId: string | null;
  orderedById: string | null;
  paymentResponsibleById: string | null;
  receivingResponsibleById: string | null;
};
type Resp = { orderedById: string | null; paymentResponsibleById: string | null; receivingResponsibleById: string | null };

export function NewBatchForm({
  suppliers: init,
  defaultRate,
  operators,
  templates,
  initialFrom,
  categories,
  initialCategory,
}: {
  suppliers: { id: string; name: string }[];
  defaultRate: string;
  operators: OperatorOption[];
  templates: Template[];
  initialFrom: string | null;
  categories: { id: string; name: string }[];
  initialCategory: string | null;
}) {
  const [suppliers, setSuppliers] = useState(init);
  const first = templates.find((x) => x.fromBatch.id === initialFrom) ?? null;
  const [f, setF] = useState({ name: "", supplierId: first?.supplierId ?? init[0]?.id ?? "", rate: defaultRate, orderedAt: toDateTimeInput(new Date()), notes: "", responsibilityNote: "", categoryId: initialCategory ?? "", expectedAt: "", supplierOrderNo: "", orderUrl: "" });
  const [resp, setResp] = useState<Resp>(first ? pick(first) : { orderedById: null, paymentResponsibleById: null, receivingResponsibleById: null });
  const [copiedFrom, setCopiedFrom] = useState<Template | null>(first);
  const [confirmed, setConfirmed] = useState(false);
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const [cats, setCats] = useState(categories);
  const [newCategory, setNewCategory] = useState<string | null>(null);
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
        run(() => createBatchAction({ name: f.name, supplierId: f.supplierId || null, rate: f.rate, orderedAt: f.orderedAt, notes: f.notes || null, items: [], ...resp, orderedById: resp.orderedById === "__joint__" ? null : resp.orderedById, ownership: resp.orderedById === "__joint__" ? "JOINT" : "PERSONAL", responsibilityNote: f.responsibilityNote || null, categoryId: f.categoryId || null, expectedAt: f.expectedAt || null, supplierOrderNo: f.supplierOrderNo || null, orderUrl: f.orderUrl || null }), {
          success: "已建立採購團，接著批次新增系列商品",
          onOk: (d) => router.push(`/inventory/batches/${d.id}?bulk=1`),
        });
      }}
    >
      <TextField label="採購團名稱（必填）" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：聖誕 A 團（代購小美）" />
      {newCategory === null ? (
        <div className="flex items-end gap-2">
          <SelectField className="flex-1" label="所屬活動／系列" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} options={[["", "不指定"], ...cats.map((c) => [c.id, c.name] as [string, string])]} />
          <Button onClick={() => setNewCategory("")}>新增活動</Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <label className="flex-1 text-[13px] font-medium text-ink-2">
            新活動名稱
            <input autoFocus className={`${inputCls} mt-1`} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="例：吉伊卡哇聖誕系列" />
          </label>
          <Button variant="primary" onClick={async () => {
            if (!newCategory.trim()) return notify("請填寫活動名稱");
            const r = await saveCategoryAction(null, { name: newCategory.trim(), type: "FESTIVAL", active: true });
            if (!r.ok) return notify(r.error);
            setCats((l) => [...l, { id: r.data.id, name: newCategory.trim() }]);
            setF((x) => ({ ...x, categoryId: r.data.id }));
            setNewCategory(null);
          }}>建立</Button>
          <Button onClick={() => setNewCategory(null)}>取消</Button>
        </div>
      )}
      <p className="-mt-2 text-[12px] text-mute">同一活動的各團可以在活動頁一起比較價格與進度。要改名或停用活動，請到「全部功能 → 活動與分類」。</p>
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
              const r = await saveSupplierAction(null, { name: newSupplier, defaultCurrency: "TWD" });
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
        <TextField label="預計到貨日（選填）" type="date" value={f.expectedAt} onChange={(e) => setF({ ...f, expectedAt: e.target.value })} />
      </div>
      <details className="rounded-lg border border-line-2 px-3 py-2">
        <summary className="cursor-pointer text-sm text-ai">更多選填資料（訂單編號、訂購連結）</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <TextField label="訂單編號" value={f.supplierOrderNo} onChange={(e) => setF({ ...f, supplierOrderNo: e.target.value })} />
          <TextField label="訂購連結" value={f.orderUrl} onChange={(e) => setF({ ...f, orderUrl: e.target.value })} placeholder="https://" />
        </div>
      </details>

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
        <OperatorPicker label="這團是誰的" operators={[...operators, { id: "__joint__", name: "合資", code: "J" }]} value={resp.orderedById} onChange={setR("orderedById")} highlight={needConfirm} hint="合資：賣掉的錢依各自實際付給代購的金額比例分" />
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
