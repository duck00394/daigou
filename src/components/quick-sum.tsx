"use client";
// 快速加總：勾幾列，下面直接顯示成本合計、平均每支（庫存、系列成本比較共用）
// 數字直接用頁面上原本的平均成本 × 件數加起來，不另外算一套；沒有成本的列件數照算、金額不算（另外寫出來）
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatTwd } from "@/lib/money";

type V = { qty: number; cost: number | null };
type Ctx = { sel: Record<string, V>; set: (id: string, v: V | null) => void; setMany: (items: ({ id: string } & V)[], on: boolean) => void };
const SumCtx = createContext<Ctx | null>(null);

export function SumProvider({ children, itemWord = "項", qtyWord = "件", qtyLabel = "", avgLabel = "平均每支" }: { children: ReactNode; itemWord?: string; qtyWord?: string; qtyLabel?: string; avgLabel?: string }) {
  const [sel, setSel] = useState<Record<string, V>>({});
  const ctx = useMemo<Ctx>(
    () => ({
      sel,
      set: (id, v) =>
        setSel((s) => {
          const n = { ...s };
          if (v) n[id] = v;
          else delete n[id];
          return n;
        }),
      setMany: (items, on) =>
        setSel((s) => {
          const n = { ...s };
          for (const it of items) {
            if (on) n[it.id] = { qty: it.qty, cost: it.cost };
            else delete n[it.id];
          }
          return n;
        }),
    }),
    [sel],
  );
  const rows = Object.values(sel);
  const qty = rows.reduce((a, r) => a + r.qty, 0);
  const priced = rows.filter((r) => r.cost != null && r.qty > 0);
  const total = priced.reduce((a, r) => a + r.cost! * r.qty, 0);
  const pricedQty = priced.reduce((a, r) => a + r.qty, 0);
  const noCost = rows.filter((r) => r.cost == null && r.qty > 0).length;
  // 每樣各一件加起來（像一套的成本）：不管手上幾件，勾的每列只算一次
  const each = rows.filter((r) => r.cost != null);
  const eachTotal = each.reduce((a, r) => a + r.cost!, 0);
  return (
    <SumCtx.Provider value={ctx}>
      {children}
      {rows.length > 0 && (
        <div className="no-print sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 mt-2 rounded-xl border border-line bg-card px-4 py-2.5 md:bottom-4" role="status" aria-live="polite" data-testid="quick-sum">
          <div className="flex items-baseline justify-between gap-2 text-[13px] text-mute">
            <span>
              已選 {rows.length} {itemWord}，{qtyLabel}<span className="num">{qty}</span> {qtyWord}
              {noCost > 0 && <span>（{noCost} {itemWord}沒有成本，金額沒算）</span>}
            </span>
            <button type="button" className="min-h-9 shrink-0 px-1 text-[14px] text-ai" onClick={() => setSel({})}>清除</button>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-[14px]">成本合計 <b className="num text-[20px]" data-testid="quick-sum-total">{formatTwd(Math.round(total))}</b></span>
            <span className="text-[14px]">{avgLabel} <b className="num text-[17px]" data-testid="quick-sum-avg">{pricedQty ? formatTwd(Math.round(total / pricedQty)) : "無"}</b></span>
          </div>
          {each.length > 0 && (
            <div className="text-[14px]">
              各一{qtyWord}合計 <b className="num text-[17px]" data-testid="quick-sum-each">{formatTwd(Math.round(eachTotal))}</b>
            </div>
          )}
        </div>
      )}
    </SumCtx.Provider>
  );
}

const boxCls = "size-5 shrink-0 cursor-pointer accent-ai";

/** 一列的勾選（勾了就算進加總）；數字變了（例如切換含運費）會跟著更新 */
export function SumCheck({ id, qty, cost, label }: { id: string; qty: number; cost: number | null; label: string }) {
  const c = useContext(SumCtx);
  const on = !!c?.sel[id];
  const cur = c?.sel[id];
  useEffect(() => {
    if (c && cur && (cur.qty !== qty || cur.cost !== cost)) c.set(id, { qty, cost });
  }, [c, cur, id, qty, cost]);
  if (!c) return null;
  return (
    <input
      type="checkbox"
      className={boxCls}
      aria-label={`加總：${label}`}
      checked={on}
      onClick={(e) => e.stopPropagation()}
      onChange={() => c.set(id, on ? null : { qty, cost })}
      data-testid="sum-check"
    />
  );
}

/** 整組一起勾／取消 */
export function SumGroup({ items, label }: { items: ({ id: string } & V)[]; label: string }) {
  const c = useContext(SumCtx);
  if (!c || !items.length) return null;
  const all = items.every((i) => c.sel[i.id]);
  return (
    <button type="button" className="ml-2 min-h-8 px-1 text-[12.5px] font-normal text-ai" aria-label={`${all ? "取消" : "全選"}這組：${label}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); c.setMany(items, !all); }} data-testid="sum-group">
      {all ? "取消這組" : "全選這組"}
    </button>
  );
}
