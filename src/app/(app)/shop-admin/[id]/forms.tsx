"use client";
import { useMemo, useState } from "react";
import { Button, inputCls, TimeInput24, useLeaveGuard, useRun } from "@/components/client";
import { saveQuotasAction, saveShopCategoryAction, setTypeImageAction } from "@/actions/shop";

type Settings = { enabled: boolean; openDate: string; openTime: string; perPersonLimit: number | null; ownerId: string | null; imageUrl: string; intro: string; payUrl: string; payTiming: "ORDER" | "ARRIVAL"; payHours: number; depositPerItem: number | null };

export function SettingsForm({ categoryId, ops, initial, isNew }: { categoryId: string; ops: { id: string; name: string }[]; initial: Settings; isNew: boolean }) {
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const { run, pending } = useRun();
  const dirty = JSON.stringify(f) !== JSON.stringify(saved) || isNew;
  useLeaveGuard(JSON.stringify(f) !== JSON.stringify(saved));
  const save = () =>
    run(
      () => saveShopCategoryAction(categoryId, { enabled: f.enabled, openDate: f.openDate, openTime: f.openTime, perPersonLimit: f.perPersonLimit, ownerId: f.ownerId, imageUrl: f.imageUrl || null, intro: f.intro || null, payUrl: f.payUrl.trim() || null, payTiming: f.payTiming, payHours: f.payHours, depositPerItem: f.depositPerItem }),
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
      <SeriesImage value={f.imageUrl} onChange={(url) => setF({ ...f, imageUrl: url })} />
      <label className="block text-[13px] font-medium text-ink-2">
        給客人看的說明（選填，例如預計到貨時間、付款方式）
        <textarea rows={3} maxLength={500} className={`${inputCls} mt-1`} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} />
      </label>
      <div className="space-y-2 rounded-lg border border-line-2 p-3">
        <div className="text-[14px] font-semibold">賣貨便付款</div>
        <label className="block text-[13px] font-medium text-ink-2">
          訂金（每件，台幣；空白＝不用訂金）
          <input type="number" inputMode="numeric" min={1} className={`${inputCls} mt-1`} value={f.depositPerItem ?? ""} onChange={(e) => setF({ ...f, depositPerItem: e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value))) })} />
        </label>
        <label className="block text-[13px] font-medium text-ink-2">
          {f.depositPerItem ? "尾款的賣貨便賣場連結（賣場價格要設成扣掉訂金後的金額）" : "賣貨便賣場連結（這個系列共用一個；空白＝不自動發付款通知）"}
          <input type="url" inputMode="url" className={`${inputCls} mt-1`} value={f.payUrl} placeholder="https://myship.7-11.com.tw/…" onChange={(e) => setF({ ...f, payUrl: e.target.value })} />
        </label>
        <div className={f.depositPerItem ? "" : "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-1.5"}>
          <label className={`block text-[13px] font-medium text-ink-2 ${f.depositPerItem ? "hidden" : ""}`}>
            什麼時候要客人下單
            <select className={`${inputCls} mt-1`} value={f.payTiming} onChange={(e) => setF({ ...f, payTiming: e.target.value as Settings["payTiming"] })}>
              <option value="ORDER">訂單成立就下單</option>
              <option value="ARRIVAL">到貨後才下單</option>
            </select>
          </label>
          <label className="block text-[13px] font-medium text-ink-2">
            {f.depositPerItem ? "確認訂金後，幾小時內要在賣貨便下單" : "幾小時內"}
            <select className={`${inputCls} mt-1`} value={f.payHours} onChange={(e) => setF({ ...f, payHours: Number(e.target.value) })}>
              {[1, 2, 3, 6, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} 小時</option>)}
            </select>
          </label>
        </div>
        {f.depositPerItem ? (
          <p className="text-[12px] text-mute">
            客人下單後 <b className="text-bad">1 小時</b>內要匯款並回傳末五碼，沒回傳自動取消。你在「訂購頁付款」確認收到後，系統才傳尾款賣場連結，<b className="text-bad">{f.payHours} 小時</b>內要下單；已付訂金的逾期不會自動取消，會列在「逾期」給你處理。匯款帳戶在「訂購頁」的客服資料設定。
          </p>
        ) : (
        <p className="text-[12px] text-mute">
          {f.payTiming === "ORDER" ? "訂單成立（或候補遞補成立）時，自動把賣場連結傳給客人，" : "到貨後在「訂購頁付款」按「已到貨，發付款通知」，系統把賣場連結傳給客人，"}
          <b className="text-bad">{f.payHours} 小時</b>內沒在後台按「賣貨便已下單」就自動取消，名額給下一位候補。
        </p>
        )}
      </div>
      <Button variant="primary" className="w-full" loading={pending} disabled={!dirty} onClick={save}>儲存設定</Button>
    </section>
  );
}

export type QuotaRow = { productId: string; type: string; typeId: string | null; typeImage: string | null; typeSort: number; label: string; charSort: number; name: string; image: string | null; defaultPrice: number | null; price: number | null; bundleNeed: number; bundleAmount: number; quota: number | null; sold: number; waiting: number };

// m：能不能單買（"" 可以單買／"n" 要搭幾個／"a" 要搭到多少錢），bv：個數或金額
type Cell = { q: string; p: string; m: "" | "n" | "a"; bv: string };
const cellOf = (r: QuotaRow): Cell => ({ q: r.quota === null ? "" : String(r.quota), p: r.price === null ? "" : String(r.price), m: r.bundleNeed ? "n" : r.bundleAmount ? "a" : "", bv: r.bundleNeed ? String(r.bundleNeed) : r.bundleAmount ? String(r.bundleAmount) : "" });

export function QuotaForm({ categoryId, rows }: { categoryId: string; rows: QuotaRow[] }) {
  const init = useMemo(() => Object.fromEntries(rows.map((r) => [r.productId, cellOf(r)])), [rows]);
  const [v, setV] = useState<Record<string, Cell>>(init);
  const [saved, setSaved] = useState(init);
  const [fill, setFill] = useState<Record<string, Cell>>({});
  const { run, pending } = useRun();
  const same = (a?: Cell, b?: Cell) => (a?.q ?? "") === (b?.q ?? "") && (a?.p ?? "") === (b?.p ?? "") && (a?.m ?? "") === (b?.m ?? "") && (a?.m ? a.bv : "") === (b?.m ? b.bv : "");
  const changed = rows.filter((r) => !same(v[r.productId], saved[r.productId]));
  useLeaveGuard(changed.length > 0);
  const types = [...new Set(rows.map((r) => r.type))];
  const num = /^\d{1,6}$/;
  const badQty = changed.find((r) => v[r.productId].q !== "" && !/^\d{1,4}$/.test(v[r.productId].q));
  const badBundle = changed.find((r) => v[r.productId].q !== "" && v[r.productId].m && !/^[1-9]\d{0,5}$/.test(v[r.productId].bv));
  const badPrice = changed.find((r) => v[r.productId].p !== "" && !num.test(v[r.productId].p));
  const set = (id: string, patch: Partial<Cell>) => setV((x) => ({ ...x, [id]: { ...x[id], ...patch } }));
  const save = () =>
    run(() => saveQuotasAction(categoryId, changed.map((r) => ({ productId: r.productId, quota: v[r.productId].q === "" ? null : Number(v[r.productId].q), price: v[r.productId].q === "" ? undefined : v[r.productId].p === "" ? null : Number(v[r.productId].p), bundleNeed: v[r.productId].q === "" ? undefined : v[r.productId].m === "n" ? Number(v[r.productId].bv) : null, bundleAmount: v[r.productId].q === "" ? undefined : v[r.productId].m === "a" ? Number(v[r.productId].bv) : null }))), {
      success: (d) => `已儲存 ${d.changed} 個${d.filled ? `，候補遞補了 ${d.filled} 筆` : ""}`,
      onOk: () => setSaved(v),
    });
  if (!rows.length) return <section className="rounded-xl border border-line bg-card p-4 text-[14px] text-mute">這個系列還沒有商品。先到系列頁或採購加入商品，再回來設定開放數量。</section>;
  const grid = "grid grid-cols-[minmax(0,1fr)_76px_64px_36px_36px] items-center gap-x-1.5 sm:grid-cols-[minmax(0,1fr)_96px_80px_48px_48px] sm:gap-x-2";
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-4">
      <div>
        <h2 className="text-[16px] font-semibold">售價與開放數量</h2>
        <p className="text-[13px] text-mute">開放數量跟庫存分開算，可以先接單再去買。<b>空白＝從訂購頁拿掉</b>（客人看不到、不能訂、不能排候補，已經排候補的人會收到 LINE 通知）；0＝顯示但已售完（可排候補）。售價空白＝用品項售價（灰字）。改售價只影響之後的新訂單。</p>
      </div>
      {types.map((t) => {
        const list = rows.filter((r) => r.type === t);
        const f = fill[t] ?? { q: "", p: "", m: "", bv: "" };
        const canFill = (f.q === "" || /^\d{1,4}$/.test(f.q)) && (f.p === "" || num.test(f.p)) && (f.q !== "" || f.p !== "");
        return (
          <div key={t} className="overflow-hidden rounded-lg border border-line-2">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-line-2 px-3 py-2">
              <span className="text-[15px] font-semibold">{t}</span>
              <span className="flex items-center gap-1.5">
                <input aria-label={`${t} 售價全部填`} inputMode="numeric" placeholder="售價" className="h-9 w-[72px] rounded-md border border-line bg-white px-2 text-[15px]" value={f.p} onChange={(e) => setFill({ ...fill, [t]: { ...f, p: e.target.value.replace(/[^\d]/g, "") } })} />
                <input aria-label={`${t} 數量全部填`} inputMode="numeric" placeholder="數量" className="h-9 w-14 rounded-md border border-line bg-white px-2 text-[15px]" value={f.q} onChange={(e) => setFill({ ...fill, [t]: { ...f, q: e.target.value.replace(/[^\d]/g, "") } })} />
                <Button small disabled={!canFill} onClick={() => setV({ ...v, ...Object.fromEntries(list.map((r) => [r.productId, { ...v[r.productId], q: f.q !== "" ? f.q : v[r.productId].q, p: f.p !== "" ? f.p : v[r.productId].p }])) })}>全部填</Button>
              </span>
            </div>
            {list[0].typeId && (
              <div className="border-b border-line-2 bg-white px-3 py-2">
                <TypePhoto categoryId={categoryId} typeId={list[0].typeId} typeName={t} value={list[0].typeImage} />
              </div>
            )}
            <div className={`${grid} px-3 py-1.5 text-[12px] text-mute`}>
              <span>角色</span><span>售價</span><span>開放數量</span><span className="text-center">已訂</span><span className="text-center">候補</span>
            </div>
            {list.map((r) => {
              const c = v[r.productId] ?? { q: "", p: "", m: "", bv: "" };
              const dirty = !same(c, saved[r.productId]);
              const noPrice = c.p === "" && r.defaultPrice === null && c.q !== "";
              return (
                <div key={r.productId} className={`${grid} border-t border-line-2 px-3 py-1.5`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px]">{r.label}</span>
                      {noPrice && <span className="block text-[12px] text-bad">沒有售價，客人不能訂</span>}
                    </span>
                  </span>
                  <input aria-label={`${r.label} 售價`} inputMode="numeric" placeholder={r.defaultPrice === null ? "未設" : String(r.defaultPrice)} className={`h-10 w-full rounded-md border px-2 text-[15px] placeholder:text-mute ${dirty && c.p !== (saved[r.productId]?.p ?? "") ? "border-ai bg-ai-soft" : noPrice ? "border-bad" : "border-line bg-white"}`} value={c.p} onChange={(e) => set(r.productId, { p: e.target.value.replace(/[^\d]/g, "") })} />
                  <input aria-label={`${r.label} 開放數量`} inputMode="numeric" className={`h-10 w-full rounded-md border px-2 text-[15px] ${dirty && c.q !== (saved[r.productId]?.q ?? "") ? "border-ai bg-ai-soft" : "border-line bg-white"}`} value={c.q} onChange={(e) => set(r.productId, { q: e.target.value.replace(/[^\d]/g, "") })} />
                  <span className={`num text-center text-[15px] ${r.quota !== null && r.sold >= r.quota ? "font-semibold text-bad" : ""}`}>{r.sold}</span>
                  <span className="num text-center text-[15px]">{r.waiting || "–"}</span>
                  {c.q !== "" && list.length > 1 && (
                    <span className="col-span-full -mt-0.5 flex flex-wrap items-center gap-1 pb-0.5">
                      <select aria-label={`${r.label} 能不能單買`} className={`h-7 rounded border px-1 text-[12px] ${c.m ? "border-[#f0dfa8] bg-warn-soft text-warn" : "border-line bg-white text-ink-2"}`} value={c.m} onChange={(e) => set(r.productId, { m: e.target.value as Cell["m"], bv: e.target.value ? c.bv : "" })}>
                        <option value="">可以單買</option>
                        <option value="n">要搭其他角色（個數）</option>
                        <option value="a">要搭其他角色（金額）</option>
                      </select>
                      {c.m && (
                        <span className="flex items-center gap-0.5 text-[12px] text-ink-2">
                          {c.m === "a" && "滿 NT$"}
                          <input aria-label={c.m === "n" ? `${r.label} 要搭幾個` : `${r.label} 要搭到多少錢`} inputMode="numeric" className={`h-7 rounded border px-1 text-[13px] ${c.m === "n" ? "w-10" : "w-16"} ${/^[1-9]\d*$/.test(c.bv) ? "border-line" : "border-bad"}`} value={c.bv} onChange={(e) => set(r.productId, { bv: e.target.value.replace(/[^\d]/g, "") })} />
                          {c.m === "n" && "個"}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {badQty && <p className="text-[13px] text-bad">開放數量要填 0～9999 的整數</p>}
      {badPrice && <p className="text-[13px] text-bad">售價要填整數（台幣）</p>}
      {badBundle && <p className="text-[13px] text-bad">「{badBundle.label}」要搭幾個（或多少錢）要填大於 0 的整數</p>}
      <Button variant="primary" className="w-full" loading={pending} disabled={!changed.length || !!badQty || !!badPrice || !!badBundle} onClick={save}>{changed.length ? `儲存 ${changed.length} 個變更` : "儲存"}</Button>
    </section>
  );
}

/** 預覽網址的圖片；載入失敗時提示 */
function Preview({ url, className }: { url: string; className: string }) {
  const [bad, setBad] = useState(false);
  if (!/^https:\/\/\S+$/.test(url) && !url.startsWith("/api/shop/img/")) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return bad ? <span className={`flex items-center justify-center bg-bad-soft text-center text-[11px] text-bad ${className}`}>打不開<br />這張圖</span> : <img src={url} alt="預覽" referrerPolicy="no-referrer" onError={() => setBad(true)} className={`object-cover ${className}`} />;
}

function SeriesImage({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-ink-2" htmlFor="series-image">系列主圖網址（選填，https:// 開頭）</label>
      <div className="flex items-center gap-2">
        {value && <Preview key={value} url={value} className="h-14 w-20 shrink-0 rounded-md border border-line" />}
        <input id="series-image" type="url" className={inputCls} value={value} placeholder="https://…" onChange={(e) => onChange(e.target.value.trim())} />
      </div>
      <p className="text-[12px] text-mute">在圖片上按右鍵（手機長按）→「複製圖片網址」貼上；按「儲存設定」才會換上去。</p>
    </div>
  );
}

/** 品項全體照：貼網址，按「存」就換上去（客人在系列頁、品項頁看到的大圖） */
function TypePhoto({ categoryId, typeId, typeName, value }: { categoryId: string; typeId: string; typeName: string; value: string | null }) {
  const { run, pending } = useRun();
  const [url, setUrl] = useState(value ?? "");
  const dirty = url.trim() !== (value ?? "");
  const bad = url.trim() !== "" && !/^https:\/\/\S+$/.test(url.trim()) && url.trim() !== value;
  return (
    <span className="flex w-full items-center gap-1.5">
      {url.trim() ? <Preview key={url.trim()} url={url.trim()} className="h-10 w-10 shrink-0 rounded-md border border-line" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-[1.5px] border-dashed border-[#b8bfcc] bg-white text-[10px] text-mute">全體照</span>}
      <input type="url" aria-label={`${typeName}全體照網址`} placeholder="全體照網址 https://…" className={`h-9 min-w-0 flex-1 rounded-md border bg-white px-2 text-[14px] ${bad ? "border-bad" : "border-line"}`} value={url} onChange={(e) => setUrl(e.target.value)} />
      <Button small loading={pending} disabled={!dirty || bad} onClick={() => run(() => setTypeImageAction(categoryId, typeId, url.trim() || null), { success: url.trim() ? `${typeName}的全體照已更新` : `已拿掉${typeName}的全體照` })}>存</Button>
    </span>
  );
}
