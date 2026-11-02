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

export type QuotaRow = { productId: string; type: string; typeSort: number; label: string; charSort: number; name: string; image: string | null; price: number | null; quota: number | null; sold: number; waiting: number };

export function QuotaForm({ categoryId, rows }: { categoryId: string; rows: QuotaRow[] }) {
  const init = useMemo(() => Object.fromEntries(rows.map((r) => [r.productId, r.quota === null ? "" : String(r.quota)])), [rows]);
  const [v, setV] = useState<Record<string, string>>(init);
  const [saved, setSaved] = useState(init);
  const [fill, setFill] = useState<Record<string, string>>({});
  const { run, pending } = useRun();
  const changed = rows.filter((r) => (v[r.productId] ?? "") !== (saved[r.productId] ?? ""));
  useLeaveGuard(changed.length > 0);
  const types = [...new Set(rows.map((r) => r.type))];
  const bad = changed.find((r) => v[r.productId] !== "" && !/^\d{1,4}$/.test(v[r.productId]));
  const save = () =>
    run(() => saveQuotasAction(categoryId, changed.map((r) => ({ productId: r.productId, quota: v[r.productId] === "" ? null : Number(v[r.productId]) }))), {
      success: (d) => `已儲存 ${d.changed} 個${d.filled ? `，候補遞補了 ${d.filled} 筆` : ""}`,
      onOk: () => setSaved(v),
    });
  if (!rows.length) return <section className="rounded-xl border border-line bg-card p-4 text-[14px] text-mute">這個系列還沒有商品。先到系列頁或採購加入商品，再回來設定開放數量。</section>;
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-4">
      <div>
        <h2 className="text-[16px] font-semibold">開放數量</h2>
        <p className="text-[13px] text-mute">跟庫存分開算，可以先接單再去買。空白＝不放到訂購頁；0＝顯示但已售完（可排候補）。賣完會自動顯示售完、開放候補。</p>
      </div>
      {types.map((t) => {
        const list = rows.filter((r) => r.type === t);
        return (
          <div key={t} className="overflow-hidden rounded-lg border border-line-2">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-line-2 px-3 py-2">
              <span className="text-[15px] font-semibold">{t}</span>
              <span className="flex items-center gap-1.5">
                <input aria-label={`${t} 全部填`} inputMode="numeric" placeholder="數量" className="h-9 w-16 rounded-md border border-line bg-white px-2 text-[15px]" value={fill[t] ?? ""} onChange={(e) => setFill({ ...fill, [t]: e.target.value })} />
                <Button small disabled={!/^\d{1,4}$/.test(fill[t] ?? "")} onClick={() => setV({ ...v, ...Object.fromEntries(list.map((r) => [r.productId, fill[t]])) })}>全部填</Button>
              </span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_76px_44px_44px] items-center gap-x-2 px-3 py-1.5 text-[12px] text-mute">
              <span>角色</span><span>開放數量</span><span className="text-center">已訂</span><span className="text-center">候補</span>
            </div>
            {list.map((r) => (
              <div key={r.productId} className="grid grid-cols-[minmax(0,1fr)_76px_44px_44px] items-center gap-x-2 border-t border-line-2 px-3 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <ProductImage src={r.image} alt={r.name} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px]">{r.label}</span>
                    <span className={`block text-[12px] ${r.price === null ? "text-bad" : "text-mute"}`}>{r.price === null ? "沒有售價，客人不能訂" : `NT$ ${r.price.toLocaleString("en-US")}`}</span>
                  </span>
                </span>
                <input aria-label={`${r.label} 開放數量`} inputMode="numeric" className={`h-10 w-full rounded-md border px-2 text-[15px] ${(v[r.productId] ?? "") !== (saved[r.productId] ?? "") ? "border-ai bg-ai-soft" : "border-line bg-white"}`} value={v[r.productId] ?? ""} onChange={(e) => setV({ ...v, [r.productId]: e.target.value.replace(/[^\d]/g, "") })} />
                <span className={`num text-center text-[15px] ${r.quota !== null && r.sold >= r.quota ? "font-semibold text-bad" : ""}`}>{r.sold}</span>
                <span className="num text-center text-[15px]">{r.waiting || "–"}</span>
              </div>
            ))}
          </div>
        );
      })}
      <p className="text-[12px] text-mute">售價用系列頁「品項售價」；沒有的話用商品的參考售價。</p>
      {bad && <p className="text-[13px] text-bad">開放數量要填 0～9999 的整數</p>}
      <Button variant="primary" className="w-full" loading={pending} disabled={!changed.length || !!bad} onClick={save}>{changed.length ? `儲存 ${changed.length} 個變更` : "儲存開放數量"}</Button>
    </section>
  );
}
