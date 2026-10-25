"use client";
// 勾選算成本：按「勾選算成本」才出現勾選框；勾商品、改件數，下面顯示成本合計；「選整套」＝這個品項每個角色各 1 件
import { createContext, useContext, useMemo, useState } from "react";
import { formatTwd } from "@/lib/money";

type Info = { id: string; name: string; cost: number | null; price: number | null; tentative: boolean };
type Ctx = { on: boolean; setOn: (v: boolean) => void; sel: Record<string, number>; set: (id: string, q: number) => void; setMany: (ids: string[], q: number) => void; clear: () => void; info: Record<string, Info> };
const PickCtx = createContext<Ctx | null>(null);

export function PickProvider({ items, children }: { items: Info[]; children: React.ReactNode }) {
  const [sel, setSel] = useState<Record<string, number>>({});
  const [on, setOn] = useState(false);
  const info = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const ctx: Ctx = {
    on,
    setOn: (v) => {
      setOn(v);
      if (!v) setSel({});
    },
    sel,
    info,
    set: (id, q) => setSel((s) => {
      const n = { ...s };
      if (q > 0) n[id] = q;
      else delete n[id];
      return n;
    }),
    setMany: (ids, q) => setSel((s) => ({ ...s, ...Object.fromEntries(ids.map((id) => [id, q])) })),
    clear: () => setSel({}),
  };
  return (
    <PickCtx.Provider value={ctx}>
      {children}
      <PickBar />
    </PickCtx.Provider>
  );
}

export function PickBox({ id, name }: { id: string; name: string }) {
  const c = useContext(PickCtx)!;
  const q = c.sel[id] ?? 0;
  if (!c.on) return null;
  return (
    <span className="flex w-11 shrink-0 flex-col items-center gap-1 py-2.5 pl-2">
      <input type="checkbox" className="h-5 w-5 accent-[#2f4b7c]" aria-label={`選 ${name}`} checked={q > 0} onChange={(e) => c.set(id, e.target.checked ? 1 : 0)} />
      {q > 0 && <input aria-label={`${name} 件數`} inputMode="numeric" className="num h-7 w-9 rounded-md border border-line text-center text-[13px]" onFocus={(e) => e.target.select()} value={q} onChange={(e) => c.set(id, Math.max(1, Math.min(999, Number(e.target.value.replace(/\D/g, "")) || 1)))} />}
    </span>
  );
}

/** 選整套：這個品項每個角色各 1 件；再按一次取消 */
export function SetButton({ ids, label }: { ids: string[]; label: string }) {
  const c = useContext(PickCtx)!;
  const all = ids.length > 0 && ids.every((id) => c.sel[id]);
  const cost = ids.reduce((a, id) => a + (c.info[id]?.cost ?? 0), 0);
  if (!c.on) return null;
  return (
    <button type="button" className={`rounded-lg border px-2 py-1 text-[12.5px] font-normal ${all ? "border-ai bg-ai text-white" : "border-line bg-white text-ink"}`} onClick={() => (all ? ids.forEach((id) => c.set(id, 0)) : c.setMany(ids, 1))} title={`整套成本約 ${formatTwd(cost)}`}>
      {all ? "取消整套" : label}
    </button>
  );
}

/** 標題列、合計列前面空一格，跟勾選框對齊 */
export function PickSpacer() {
  const c = useContext(PickCtx)!;
  return c.on ? <span className="w-11 shrink-0" aria-hidden /> : null;
}

export function PickToggle() {
  const c = useContext(PickCtx)!;
  return (
    <button type="button" className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${c.on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink"}`} onClick={() => c.setOn(!c.on)} aria-pressed={c.on}>
      {c.on ? "不勾了" : "勾選算成本"}
    </button>
  );
}

function PickBar() {
  const c = useContext(PickCtx)!;
  const ids = Object.keys(c.sel);
  if (!ids.length) return null;
  let qty = 0, cost = 0, price = 0, priced = 0, noCost = 0, tentative = false;
  for (const id of ids) {
    const q = c.sel[id];
    const i = c.info[id];
    qty += q;
    if (i?.cost == null) noCost += q;
    else {
      cost += i.cost * q;
      if (i.tentative) tentative = true;
      if (i.price != null) {
        price += i.price * q;
        priced += i.cost * q;
      }
    }
  }
  return (
    <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 mx-2 mb-2 rounded-2xl bg-ai px-4 py-2.5 text-white shadow-lg md:bottom-3" data-testid="pick-bar" role="status">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px]">已選 {qty} 隻　成本合計 <b className="num text-[18px]" data-testid="pick-cost">{formatTwd(cost)}</b>{tentative ? "（有預估價）" : ""}</span>
        <button type="button" className="text-[13px] underline" onClick={c.clear}>清除</button>
      </div>
      <div className="text-[12.5px] opacity-85">
        {price > 0 ? <span data-testid="pick-profit">照售價賣 {formatTwd(price)}・可賺 {formatTwd(price - priced)}</span> : "還沒填售價，算不出可賺多少"}
        {noCost > 0 && `・${noCost} 隻沒成本沒算`}
      </div>
    </div>
  );
}
