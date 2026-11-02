"use client";
import { useMemo, useState } from "react";
import { Button, inputCls, ProductImage, TimeInput24, useLeaveGuard, useRun } from "@/components/client";
import { saveQuotasAction, saveShopCategoryAction } from "@/actions/shop";

type Settings = { enabled: boolean; openDate: string; openTime: string; perPersonLimit: number | null; ownerId: string | null; imageUrl: string; intro: string };

export function SettingsForm({ categoryId, ops, initial, isNew }: { categoryId: string; ops: { id: string; name: string }[]; initial: Settings; isNew: boolean }) {
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const { run, pending } = useRun();
  const dirty = JSON.stringify(f) !== JSON.stringify(saved) || isNew;
  useLeaveGuard(JSON.stringify(f) !== JSON.stringify(saved));
  const save = () =>
    run(
      () => saveShopCategoryAction(categoryId, { enabled: f.enabled, openDate: f.openDate, openTime: f.openTime, perPersonLimit: f.perPersonLimit, ownerId: f.ownerId, imageUrl: f.imageUrl || null, intro: f.intro || null }),
      { success: f.enabled ? "已儲存，客人看得到了" : "已儲存（還沒開放，客人看不到）", onOk: () => setSaved(f) },
    );
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-4">
      <label className="flex min-h-11 items-center justify-between gap-3 text-[16px] font-semibold">
        開放訂購
        <input type="checkbox" className="h-6 w-6 accent-ai" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
      </label>
      <div>
        <div className="text-[13px] font-medium text-ink-2">開賣時間（台灣時間；空白＝打開就能買）</div>
        <div className="mt-1 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-1.5">
          <input type="date" aria-label="開賣日期" className={inputCls} value={f.openDate} onChange={(e) => setF({ ...f, openDate: e.target.value, openTime: f.openTime || (e.target.value ? "20:00" : "") })} />
          <TimeInput24 label="開賣時間" value={f.openTime} required={false} onChange={(t) => setF({ ...f, openTime: t })} />
        </div>
        {(f.openDate || f.openTime) && <button type="button" className="mt-1 text-[13px] text-ai underline" onClick={() => setF({ ...f, openDate: "", openTime: "" })}>清除開賣時間</button>}
      </div>
      <label className="block text-[13px] font-medium text-ink-2">
        每人每款限購（空白＝不限）
        <input type="number" inputMode="numeric" min={1} max={99} className={`${inputCls} mt-1`} value={f.perPersonLimit ?? ""} onChange={(e) => setF({ ...f, perPersonLimit: e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value))) })} />
      </label>
      <label className="block text-[13px] font-medium text-ink-2">
        這個系列的訂單是誰的（扣誰的庫存、通知誰）
        <select className={`${inputCls} mt-1`} value={f.ownerId ?? ""} onChange={(e) => setF({ ...f, ownerId: e.target.value || null })}>
          <option value="">還沒分</option>
          {ops.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      <label className="block text-[13px] font-medium text-ink-2">
        系列主圖網址（選填，https:// 開頭）
        <input type="url" className={`${inputCls} mt-1`} value={f.imageUrl} placeholder="https://…" onChange={(e) => setF({ ...f, imageUrl: e.target.value })} />
      </label>
      <label className="block text-[13px] font-medium text-ink-2">
        給客人看的說明（選填，例如預計到貨時間、付款方式）
        <textarea rows={3} maxLength={500} className={`${inputCls} mt-1`} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} />
      </label>
      <Button variant="primary" className="w-full" loading={pending} disabled={!dirty} onClick={save}>儲存設定</Button>
    </section>
  );
}

export type QuotaRow = { productId: string; type: string; typeSort: number; label: string; charSort: number; name: string; image: string | null; defaultPrice: number | null; price: number | null; quota: number | null; sold: number; waiting: number };

type Cell = { q: string; p: string };
const cellOf = (r: QuotaRow): Cell => ({ q: r.quota === null ? "" : String(r.quota), p: r.price === null ? "" : String(r.price) });

export function QuotaForm({ categoryId, rows }: { categoryId: string; rows: QuotaRow[] }) {
  const init = useMemo(() => Object.fromEntries(rows.map((r) => [r.productId, cellOf(r)])), [rows]);
  const [v, setV] = useState<Record<string, Cell>>(init);
  const [saved, setSaved] = useState(init);
  const [fill, setFill] = useState<Record<string, Cell>>({});
  const { run, pending } = useRun();
  const same = (a?: Cell, b?: Cell) => (a?.q ?? "") === (b?.q ?? "") && (a?.p ?? "") === (b?.p ?? "");
  const changed = rows.filter((r) => !same(v[r.productId], saved[r.productId]));
  useLeaveGuard(changed.length > 0);
  const types = [...new Set(rows.map((r) => r.type))];
  const num = /^\d{1,6}$/;
  const badQty = changed.find((r) => v[r.productId].q !== "" && !/^\d{1,4}$/.test(v[r.productId].q));
  const badPrice = changed.find((r) => v[r.productId].p !== "" && !num.test(v[r.productId].p));
  const priceNoQty = changed.find((r) => v[r.productId].p !== "" && v[r.productId].q === "");
  const set = (id: string, patch: Partial<Cell>) => setV((x) => ({ ...x, [id]: { ...x[id], ...patch } }));
  const save = () =>
    run(() => saveQuotasAction(categoryId, changed.map((r) => ({ productId: r.productId, quota: v[r.productId].q === "" ? null : Number(v[r.productId].q), price: v[r.productId].p === "" ? null : Number(v[r.productId].p) }))), {
      success: (d) => `已儲存 ${d.changed} 個${d.filled ? `，候補遞補了 ${d.filled} 筆` : ""}`,
      onOk: () => setSaved(v),
    });
  if (!rows.length) return <section className="rounded-xl border border-line bg-card p-4 text-[14px] text-mute">這個系列還沒有商品。先到系列頁或採購加入商品，再回來設定開放數量。</section>;
  const grid = "grid grid-cols-[minmax(0,1fr)_76px_64px_36px_36px] items-center gap-x-1.5 sm:grid-cols-[minmax(0,1fr)_96px_80px_48px_48px] sm:gap-x-2";
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-4">
      <div>
        <h2 className="text-[16px] font-semibold">售價與開放數量</h2>
        <p className="text-[13px] text-mute">開放數量跟庫存分開算，可以先接單再去買。空白＝不放到訂購頁；0＝顯示但已售完（可排候補）。售價空白＝用品項售價（灰字）。改售價只影響之後的新訂單。</p>
      </div>
      {types.map((t) => {
        const list = rows.filter((r) => r.type === t);
        const f = fill[t] ?? { q: "", p: "" };
        const canFill = (f.q === "" || /^\d{1,4}$/.test(f.q)) && (f.p === "" || num.test(f.p)) && (f.q !== "" || f.p !== "");
        return (
          <div key={t} className="overflow-hidden rounded-lg border border-line-2">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-line-2 px-3 py-2">
              <span className="text-[15px] font-semibold">{t}</span>
              <span className="flex items-center gap-1.5">
                <input aria-label={`${t} 售價全部填`} inputMode="numeric" placeholder="售價" className="h-9 w-[72px] rounded-md border border-line bg-white px-2 text-[15px]" value={f.p} onChange={(e) => setFill({ ...fill, [t]: { ...f, p: e.target.value.replace(/[^\d]/g, "") } })} />
                <input aria-label={`${t} 數量全部填`} inputMode="numeric" placeholder="數量" className="h-9 w-14 rounded-md border border-line bg-white px-2 text-[15px]" value={f.q} onChange={(e) => setFill({ ...fill, [t]: { ...f, q: e.target.value.replace(/[^\d]/g, "") } })} />
                <Button small disabled={!canFill} onClick={() => setV({ ...v, ...Object.fromEntries(list.map((r) => [r.productId, { q: f.q !== "" ? f.q : v[r.productId].q, p: f.p !== "" ? f.p : v[r.productId].p }])) })}>全部填</Button>
              </span>
            </div>
            <div className={`${grid} px-3 py-1.5 text-[12px] text-mute`}>
              <span>角色</span><span>售價</span><span>開放數量</span><span className="text-center">已訂</span><span className="text-center">候補</span>
            </div>
            {list.map((r) => {
              const c = v[r.productId] ?? { q: "", p: "" };
              const dirty = !same(c, saved[r.productId]);
              const noPrice = c.p === "" && r.defaultPrice === null && c.q !== "";
              return (
                <div key={r.productId} className={`${grid} border-t border-line-2 px-3 py-1.5`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <ProductImage src={r.image} alt={r.name} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px]">{r.label}</span>
                      {noPrice && <span className="block text-[12px] text-bad">沒有售價，客人不能訂</span>}
                    </span>
                  </span>
                  <input aria-label={`${r.label} 售價`} inputMode="numeric" placeholder={r.defaultPrice === null ? "未設" : String(r.defaultPrice)} className={`h-10 w-full rounded-md border px-2 text-[15px] placeholder:text-mute ${dirty && c.p !== (saved[r.productId]?.p ?? "") ? "border-ai bg-ai-soft" : noPrice ? "border-bad" : "border-line bg-white"}`} value={c.p} onChange={(e) => set(r.productId, { p: e.target.value.replace(/[^\d]/g, "") })} />
                  <input aria-label={`${r.label} 開放數量`} inputMode="numeric" className={`h-10 w-full rounded-md border px-2 text-[15px] ${dirty && c.q !== (saved[r.productId]?.q ?? "") ? "border-ai bg-ai-soft" : "border-line bg-white"}`} value={c.q} onChange={(e) => set(r.productId, { q: e.target.value.replace(/[^\d]/g, "") })} />
                  <span className={`num text-center text-[15px] ${r.quota !== null && r.sold >= r.quota ? "font-semibold text-bad" : ""}`}>{r.sold}</span>
                  <span className="num text-center text-[15px]">{r.waiting || "–"}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {badQty && <p className="text-[13px] text-bad">開放數量要填 0～9999 的整數</p>}
      {badPrice && <p className="text-[13px] text-bad">售價要填整數（台幣）</p>}
      {priceNoQty && <p className="text-[13px] text-bad">「{priceNoQty.label}」有填售價，也要填開放數量</p>}
      <Button variant="primary" className="w-full" loading={pending} disabled={!changed.length || !!badQty || !!badPrice || !!priceNoQty} onClick={save}>{changed.length ? `儲存 ${changed.length} 個變更` : "儲存"}</Button>
    </section>
  );
}
