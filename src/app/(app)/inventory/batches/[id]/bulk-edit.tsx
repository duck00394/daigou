"use client";
// 採購品項批次修改：數量、預估／實際單價、幣別、對客售價。全部檢查通過才寫入。
import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, ConfirmButton, inputCls, notify, useRun, useToast } from "@/components/client";
import { bulkUpdateItemsAction } from "@/actions/series";
import { deleteBatchItemAction } from "@/actions/ops";
import { formatTwd } from "@/lib/money";

type Currency = "JPY" | "TWD";
export type EditItem = {
  id: string;
  productId: string;
  name: string;
  specNote: string | null;
  qty: number; // 有效數量
  received: number;
  minQty: number;
  promisedNote: string;
  currency: Currency;
  estUnitCost: number;
  actualUnitCost: number | null;
  salePriceTwd: number | null;
  goodsTwd: number;
  feesTwd: number;
  canDelete: boolean;
};

type Draft = { qty: string; est: string; actual: string; currency: Currency; sale: string };
const toDraft = (i: EditItem): Draft => ({ qty: String(i.qty), est: String(i.estUnitCost), actual: i.actualUnitCost == null ? "" : String(i.actualUnitCost), currency: i.currency, sale: i.salePriceTwd == null ? "" : String(i.salePriceTwd) });
const num = (s: string) => (s.trim() === "" ? null : /^\d+$/.test(s.trim().replace(/,/g, "")) ? Number(s.trim().replace(/,/g, "")) : NaN);

export function BulkEditTable({ batchId, items, editable }: { batchId: string; items: EditItem[]; editable: boolean }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(items.map((i) => [i.id, toDraft(i)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useRun();
  const toast = useToast();
  const key = items.map((i) => `${i.id}:${i.qty}:${i.estUnitCost}:${i.actualUnitCost}:${i.currency}:${i.salePriceTwd}`).join("|");
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setDrafts(Object.fromEntries(items.map((i) => [i.id, toDraft(i)])));
  }

  const changed = useMemo(() => {
    const out: { itemId: string; qty?: number; unitCost?: number; actualUnitCost?: number | null; currency?: Currency; salePriceTwd?: number | null }[] = [];
    const local: Record<string, string> = {};
    for (const i of items) {
      const d = drafts[i.id];
      if (!d) continue;
      const o = toDraft(i);
      if (JSON.stringify(d) === JSON.stringify(o)) continue;
      const q = num(d.qty);
      const e = num(d.est);
      const a = num(d.actual);
      const s = num(d.sale);
      if (q === null || Number.isNaN(q)) local[i.id] = "數量必須是不小於 0 的整數";
      else if (q < i.minQty) local[i.id] = `數量不能少於 ${i.minQty}（${i.promisedNote}）`;
      else if (e === null || Number.isNaN(e)) local[i.id] = "預估單價必須是整數";
      else if (Number.isNaN(a) || Number.isNaN(s)) local[i.id] = "價格必須是整數";
      const row: (typeof out)[number] = { itemId: i.id };
      if (d.qty !== o.qty) row.qty = q ?? undefined;
      if (d.est !== o.est) row.unitCost = e ?? undefined;
      if (d.actual !== o.actual) row.actualUnitCost = a;
      if (d.currency !== o.currency) row.currency = d.currency;
      if (d.sale !== o.sale) row.salePriceTwd = s;
      out.push(row);
    }
    return { rows: out, local };
  }, [drafts, items]);

  const set = (id: string, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
    setErrors((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
  };
  const allErrors = { ...changed.local, ...errors };
  const lbl = "mb-0.5 block text-[12px] text-mute md:sr-only";

  return (
    <div>
      <div role="table" aria-label="採購品項" className="space-y-2 p-3 md:space-y-0 md:p-0">
        <div role="row" className="hidden border-b border-line bg-[#fafbfc] px-4 py-2 text-[13px] font-medium text-ink-2 md:grid md:grid-cols-[minmax(10rem,1.6fr)_4.5rem_5.5rem_6.5rem_6.5rem_5rem_6.5rem_7rem_4.5rem] md:gap-2">
          <span role="columnheader">商品</span>
          <span role="columnheader" className="text-right">已到貨</span>
          <span role="columnheader" className="text-right">數量</span>
          <span role="columnheader" className="text-right">預估單價</span>
          <span role="columnheader" className="text-right">實際單價</span>
          <span role="columnheader">幣別</span>
          <span role="columnheader" className="text-right">對客售價</span>
          <span role="columnheader" className="text-right">成本（台幣）</span>
          <span role="columnheader"><span className="sr-only">操作</span></span>
        </div>
        {items.map((i) => {
          const d = drafts[i.id] ?? toDraft(i);
          const err = allErrors[i.id];
          const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(i));
          return (
            <div key={i.id} role="row" className={`grid grid-cols-2 gap-2 rounded-xl border p-3 md:grid-cols-[minmax(10rem,1.6fr)_4.5rem_5.5rem_6.5rem_6.5rem_5rem_6.5rem_7rem_4.5rem] md:items-start md:rounded-none md:border-0 md:border-b md:px-4 md:py-1.5 ${err ? "border-[#f5c9c4] bg-bad-soft/40" : dirty ? "border-[#cfd9ea] bg-info-soft/60" : "border-line md:border-line-2"}`}>
              <div role="cell" className="col-span-2 md:col-span-1 md:pt-2">
                <Link href={`/products/${i.productId}`} className="font-medium hover:underline">{i.name}</Link>
                {i.specNote && <span className="ml-1 text-[12px] text-mute">{i.specNote}</span>}
                {i.minQty > 0 && <div className="text-[12px] text-mute">最少 {i.minQty} 件（{i.promisedNote}）</div>}
              </div>
              <div role="cell" className="flex items-center justify-between md:block md:pt-2 md:text-right">
                <span className="text-[12px] text-mute md:sr-only">已到貨</span>
                <span className="num">{i.received}</span>
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`eq-${i.id}`}>數量</label>
                <input id={`eq-${i.id}`} disabled={!editable} className={`${inputCls} num text-right`} inputMode="numeric" value={d.qty} onChange={(e) => set(i.id, { qty: e.target.value })} />
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`ee-${i.id}`}>預估單價</label>
                <input id={`ee-${i.id}`} disabled={!editable} className={`${inputCls} num text-right`} inputMode="numeric" value={d.est} onChange={(e) => set(i.id, { est: e.target.value })} />
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`ea-${i.id}`}>實際單價</label>
                <input id={`ea-${i.id}`} disabled={!editable} className={`${inputCls} num text-right`} inputMode="numeric" value={d.actual} onChange={(e) => set(i.id, { actual: e.target.value })} placeholder="未確認" />
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`ec-${i.id}`}>幣別</label>
                <select id={`ec-${i.id}`} disabled={!editable} className={inputCls} value={d.currency} onChange={(e) => set(i.id, { currency: e.target.value as Currency })}>
                  <option value="JPY">日幣</option>
                  <option value="TWD">台幣</option>
                </select>
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`es-${i.id}`}>對客售價</label>
                <input id={`es-${i.id}`} disabled={!editable} className={`${inputCls} num text-right`} inputMode="numeric" value={d.sale} onChange={(e) => set(i.id, { sale: e.target.value })} placeholder="選填" />
              </div>
              <div role="cell" className="col-span-2 flex items-center justify-between md:col-span-1 md:block md:pt-2 md:text-right">
                <span className="text-[12px] text-mute md:sr-only">成本（台幣）</span>
                <span className="num">{formatTwd(i.goodsTwd + i.feesTwd)}</span>
                <span className="block text-[11px] text-mute">{i.actualUnitCost == null ? "依預估單價" : "依實際單價"}{i.feesTwd ? `，含費用 ${i.feesTwd}` : ""}</span>
              </div>
              <div role="cell" className="col-span-2 flex justify-end md:col-span-1 md:pt-1">
                {editable && i.canDelete && (
                  <ConfirmButton small variant="danger" label="刪除" title={`刪除「${i.name}」`} message="這個品項沒有到貨紀錄，也沒有買家依賴這批到貨，可以安全刪除。" confirmLabel="刪除品項" onConfirm={() => run(() => deleteBatchItemAction(i.id), { success: "已刪除品項" })} />
                )}
              </div>
              {err && <p role="alert" className="col-span-2 text-[13px] text-bad md:col-span-9">{err}</p>}
            </div>
          );
        })}
      </div>
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 px-4 py-3">
          <span className="text-[13px] text-mute">
            {changed.rows.length ? `已修改 ${changed.rows.length} 列，尚未儲存` : "直接在表格修改，最後一次儲存；任何一列不合法時整批都不會寫入。"}
            <span className="ml-1">（日幣以本團鎖定匯率換算台幣）</span>
          </span>
          <span className="flex gap-2">
            <Button disabled={!changed.rows.length} onClick={() => { setDrafts(Object.fromEntries(items.map((i) => [i.id, toDraft(i)]))); setErrors({}); }}>
              還原
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={!changed.rows.length || Object.keys(changed.local).length > 0}
              onClick={() =>
                run(() => bulkUpdateItemsAction(batchId, changed.rows), {
                  onOk: (d) => {
                    if (!d.ok) {
                      setErrors(Object.fromEntries(d.errors.map((e) => [e.itemId, e.error])));
                      notify(`${d.errors.length} 列不合法，全部未儲存`);
                    } else toast(`已儲存 ${changed.rows.length} 列`);
                  },
                })
              }
            >
              儲存修改
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
