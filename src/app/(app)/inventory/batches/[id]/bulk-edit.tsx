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
  deleteBlocked?: string | null; // 不能刪的原因（白話）
  kept?: number; // 這批裡已自留的件數（刪除時一起拿掉）
  cancelledQty: number;
  cancelReason: string | null;
  seriesId?: string | null; // 這個品項的系列（一團可以有好幾個系列）
  ownerId?: string | null; // 合資團：這個品項是誰的（空白＝大家一起）
};

type Draft = { qty: string; est: string; actual: string; currency: Currency; sale: string; cut: string; restore: boolean; owner: string };
const toDraft = (i: EditItem): Draft => ({ qty: String(i.qty), est: String(i.estUnitCost), actual: i.actualUnitCost == null ? "" : String(i.actualUnitCost), currency: i.currency, sale: i.salePriceTwd == null ? "" : String(i.salePriceTwd), cut: "", restore: false, owner: i.ownerId ?? "" });
const CUT_REASONS: [string, string][] = [["AGENT_CANCEL", "代購砍單（沒搶到）"], ["OUT_OF_STOCK", "商品缺貨"], ["SELLER_CANCEL", "賣家取消"], ["SELF_CANCEL", "自己不要了"]];
const num = (s: string) => (s.trim() === "" ? null : /^\d+$/.test(s.trim().replace(/,/g, "")) ? Number(s.trim().replace(/,/g, "")) : NaN);

export function BulkEditTable({ batchId, items, editable, jointOps }: { batchId: string; items: EditItem[]; editable: boolean; jointOps?: { id: string; name: string }[] }) {
  const [reason, setReason] = useState("AGENT_CANCEL");
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(items.map((i) => [i.id, toDraft(i)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useRun();
  const toast = useToast();
  const key = items.map((i) => `${i.id}:${i.qty}:${i.estUnitCost}:${i.actualUnitCost}:${i.currency}:${i.salePriceTwd}:${i.cancelledQty}:${i.ownerId ?? ""}`).join("|");
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setDrafts(Object.fromEntries(items.map((i) => [i.id, toDraft(i)])));
  }

  const changed = useMemo(() => {
    const out: { itemId: string; qty?: number; unitCost?: number; actualUnitCost?: number | null; currency?: Currency; salePriceTwd?: number | null; cancelQty?: number; cancelReason?: string; restoreQty?: number; ownerId?: string | null }[] = [];
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
      const cut = num(d.cut);
      const canCut = (q ?? i.qty) - i.received;
      if (cut !== null && (Number.isNaN(cut) || cut > canCut)) local[i.id] = canCut > 0 ? `最多只能砍 ${canCut} 件（已到貨的不能砍）` : "已經全部到貨，不能砍";
      const row: (typeof out)[number] = { itemId: i.id };
      if (d.qty !== o.qty) row.qty = q ?? undefined;
      if (d.est !== o.est) row.unitCost = e ?? undefined;
      if (d.actual !== o.actual) row.actualUnitCost = a;
      if (d.currency !== o.currency) row.currency = d.currency;
      if (d.sale !== o.sale) row.salePriceTwd = s;
      if (cut) {
        row.cancelQty = cut;
        row.cancelReason = reason;
      }
      if (d.restore && i.cancelledQty > 0) row.restoreQty = i.cancelledQty;
      if (d.owner !== o.owner) row.ownerId = d.owner || null;
      out.push(row);
    }
    return { rows: out, local };
  }, [drafts, items, reason]);

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
        <div role="row" className="hidden border-b border-line bg-[#fafbfc] px-4 py-2 text-[13px] font-medium text-ink-2 md:grid md:grid-cols-[minmax(10rem,1.6fr)_4.5rem_5.5rem_6.5rem_6.5rem_5rem_6.5rem_7rem_7.5rem] md:gap-2">
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
          // 按「編輯」後每一列的欄位全部打開，不用一列一列點
          const x = "";
          return (
            <div key={i.id} role="row" className={`grid grid-cols-2 gap-2 rounded-xl border p-3 md:grid-cols-[minmax(10rem,1.6fr)_4.5rem_5.5rem_6.5rem_6.5rem_5rem_6.5rem_7rem_7.5rem] md:items-start md:rounded-none md:border-0 md:border-b md:px-4 md:py-1.5 ${err ? "border-[#f5c9c4] bg-bad-soft/40" : dirty ? "border-[#cfd9ea] bg-info-soft/60" : "border-line md:border-line-2"}`}>
              <div role="cell" className="col-span-2 md:col-span-1 md:pt-2">
                <Link href={`/products/${i.productId}`} className="font-medium hover:underline">{i.name}</Link>
                {i.specNote && <span className="ml-1 text-[12px] text-mute">{i.specNote}</span>}
                {jointOps && (editable ? (
                  <select aria-label={`${i.name} 誰的`} data-testid="edit-owner" className={`${inputCls} mt-1 h-9 w-full max-w-[12rem] text-[13px]`} value={d.owner} onChange={(e) => set(i.id, { owner: e.target.value })}>
                    <option value="">大家一起</option>
                    {jointOps.map((o) => <option key={o.id} value={o.id}>{o.name}的</option>)}
                  </select>
                ) : (
                  <div className="text-[12px] text-mute" data-testid="item-owner">{jointOps.find((o) => o.id === i.ownerId)?.name ? `${jointOps.find((o) => o.id === i.ownerId)!.name}的` : "大家一起"}</div>
                ))}
                {i.minQty > 0 && <div className="text-[12px] text-mute">最少 {i.minQty} 件（{i.promisedNote}）</div>}
                {i.cancelledQty > 0 && (
                  <div className="text-[12px] text-bad">
                    {d.restore ? <span className="text-good">會恢復砍掉的 {i.cancelledQty} 件</span> : <>已砍單 {i.cancelledQty} 件{i.cancelReason ? `（${i.cancelReason}）` : ""}</>}
                    {editable && <button type="button" className="ml-2 text-ai underline" onClick={() => set(i.id, { restore: !d.restore })}>{d.restore ? "不要恢復" : "砍錯了，恢復"}</button>}
                  </div>
                )}

              </div>
              <div role="cell" className="flex items-center justify-between md:block md:pt-2 md:text-right">
                <span className="text-[12px] text-mute md:sr-only">已到貨</span>
                <span className="num">{i.received}</span>
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`eq-${i.id}`}>數量</label>
                <div className="flex items-center gap-1">
                  {editable && <button type="button" className="h-10 w-9 shrink-0 rounded-lg border border-line text-[17px] md:hidden" aria-label={`${i.name} 少一件`} onClick={() => set(i.id, { qty: String(Math.max(0, (Number(d.qty) || 0) - 1)) })}>−</button>}
                  <input id={`eq-${i.id}`} disabled={!editable} className={`${inputCls} num text-center md:text-right`} inputMode="numeric" value={d.qty} onChange={(e) => set(i.id, { qty: e.target.value })} />
                  {editable && <button type="button" className="h-10 w-9 shrink-0 rounded-lg border border-line text-[17px] md:hidden" aria-label={`${i.name} 多一件`} onClick={() => set(i.id, { qty: String((Number(d.qty) || 0) + 1) })}>＋</button>}
                </div>
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`ee-${i.id}`}>預估單價</label>
                <input id={`ee-${i.id}`} disabled={!editable} className={`${inputCls} num text-right`} inputMode="numeric" value={d.est} onChange={(e) => set(i.id, { est: e.target.value })} />
              </div>
              <div role="cell" className={x}>
                <label className={lbl} htmlFor={`ea-${i.id}`}>實際單價</label>
                <input id={`ea-${i.id}`} disabled={!editable} className={`${inputCls} num text-right`} inputMode="numeric" value={d.actual} onChange={(e) => set(i.id, { actual: e.target.value })} placeholder="未確認" />
              </div>
              <div role="cell" className={x}>
                <label className={lbl} htmlFor={`ec-${i.id}`}>幣別</label>
                <select id={`ec-${i.id}`} disabled={!editable} className={inputCls} value={d.currency} onChange={(e) => set(i.id, { currency: e.target.value as Currency })}>
                  <option value="JPY">日幣</option>
                  <option value="TWD">台幣</option>
                </select>
              </div>
              <div role="cell" className={x}>
                <label className={lbl} htmlFor={`es-${i.id}`}>想賣價</label>
                <input id={`es-${i.id}`} disabled={!editable} className={`${inputCls} num text-right`} inputMode="numeric" value={d.sale} onChange={(e) => set(i.id, { sale: e.target.value })} placeholder="選填" />
              </div>
              <div role="cell" className="col-span-2 flex items-center justify-between md:col-span-1 md:block md:pt-2 md:text-right">
                <span className="text-[12px] text-mute md:sr-only">成本（台幣）</span>
                <span className="num">{formatTwd(i.goodsTwd + i.feesTwd)}</span>
                <span className="block text-[11px] text-mute">{i.actualUnitCost == null ? "依預估單價" : "依實際單價"}{i.feesTwd ? `，含費用 ${i.feesTwd}` : ""}</span>
              </div>
              <div role="cell" className="col-span-2 flex flex-wrap items-center justify-end gap-1 md:col-span-1 md:pt-1">
                {editable && i.qty - i.received > 0 && (
                  <label className="flex items-center gap-1 text-[13px] text-bad">
                    ✂ 砍
                    <input aria-label={`${i.name} 砍幾件`} className={`${inputCls} num w-14 text-center`} inputMode="numeric" value={d.cut} onChange={(e) => set(i.id, { cut: e.target.value })} placeholder="0" />
                    件
                  </label>
                )}
                {editable && !i.canDelete && i.deleteBlocked && <span className="w-full text-right text-[12px] text-mute">不能刪：{i.deleteBlocked}</span>}
                {editable && i.canDelete && (
                  <ConfirmButton small variant="danger" label="刪除" title={`刪除「${i.name}」`} message={i.received > 0 ? `已經收進庫存的 ${i.received} 件會一起從庫存拿掉${i.kept ? `（其中自留的 ${i.kept} 件也會一起拿掉）` : ""}。` : "這個品項還沒到貨，刪掉就不見了。"} confirmLabel="刪除品項" onConfirm={() => run(() => deleteBatchItemAction(i.id), { success: "已刪除品項" })} />
                )}
              </div>
              {err && <p role="alert" className="col-span-2 text-[13px] text-bad md:col-span-9">{err}</p>}
            </div>
          );
        })}
      </div>
      {editable && Object.values(drafts).some((d) => d.cut.trim() && d.cut.trim() !== "0") && (
        <label className="flex flex-wrap items-center gap-2 border-t border-line-2 px-4 py-2 text-[14px]">
          砍單原因
          <select aria-label="砍單原因" className={`${inputCls} w-auto`} value={reason} onChange={(e) => setReason(e.target.value)}>
            {CUT_REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="text-[12px] text-mute">砍了之後總額、還要付會自動重算；買家訂的會標成缺貨</span>
        </label>
      )}
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
