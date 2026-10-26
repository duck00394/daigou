"use client";
// 賣給客人：一位客人可以一次買好幾個系列。選系列就加一段（品項＋角色），可以再加別的系列；
// 每個角色填數量（單價先帶系列的預設售價，可以改）。超過現貨的部分記成預訂。
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, inputCls, notify, useIdemKey, useRun } from "@/components/client";
import { SeriesPicker, type SeriesOpt } from "@/components/series-picker";
import { sellSheetAction, sellToCustomerAction } from "@/actions/catalog-tree";
import { ChannelPicker } from "@/components/channel-picker";
import { Choice } from "@/components/choice";
import { formatTwd } from "@/lib/money";

type Row = { productId: string; name: string; free: number; freeBy?: Record<string, number>; incoming: number; price: number | null };
type Sheet = { id: string; name: string; items: { typeId: string; typeName: string; price: number | null; rows: Row[] }[] };

export function SellForm({ series, buyers, initialCategory, waiting, channels = [], buyerChannels = {}, operators = [], me = null, initialQty = {} }: { series: SeriesOpt[]; buyers: string[]; initialCategory: string; waiting: number; channels?: string[]; buyerChannels?: Record<string, string>; operators?: { id: string; name: string }[]; me?: string | null; initialQty?: Record<string, string> }) {
  // 誰賣的：只賣、只扣這個人的現貨，兩個人的庫存才對得上（預設是這支手機的人）
  const [seller, setSeller] = useState<string>(me ?? "");
  const sellerName = seller === "joint" ? "合資" : seller === "none" ? "未指定" : (operators.find((o) => o.id === seller)?.name ?? "");
  const freeOf = (r: Row) => (seller ? (r.freeBy?.[seller] ?? 0) : r.free);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [picker, setPicker] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>(initialQty);
  const [price, setPrice] = useState<Record<string, string>>({});
  const [buyer, setBuyer] = useState("");
  // 販售平台：記住上次選的（這台裝置）
  const [channel, setChannelState] = useState("");
  useEffect(() => {
    try {
      const v = localStorage.getItem("sell-channel");
      if (v) setChannelState(v);
    } catch {
      /* 不能存就算了 */
    }
  }, []);
  const setChannel = (v: string) => {
    setChannelState(v);
    try {
      localStorage.setItem("sell-channel", v);
    } catch {
      /* 不能存就算了 */
    }
  };
  const [paid, setPaid] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const idem = useIdemKey();
  const { run, pending } = useRun();
  const first = useRef(false);

  /** 載入一個系列的品項與現貨；replace＝存好後重新整理現貨數字 */
  const fetchSheet = async (id: string) => {
    try {
      const r = await sellSheetAction(id);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    } catch (e) {
      // 例如網站剛更新、這個分頁還是舊版：請重新整理
      const msg = e instanceof Error && e.message && !/fetch|Server Action/i.test(e.message) ? e.message : "載入失敗，網站可能剛更新，請重新整理頁面再試";
      throw new Error(msg);
    }
  };
  const addSeries = async (id: string) => {
    if (!id) return;
    if (sheets.some((s) => s.id === id)) return notify("這個系列已經在下面了", "info");
    setLoading(id);
    setLoadError(null);
    try {
      const s = await fetchSheet(id);
      setSheets((l) => (l.some((x) => x.id === s.id) ? l : [...l, s]));
      setDone(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(null);
      setPicker("");
    }
  };
  useEffect(() => {
    if (first.current) return;
    first.current = true;
    if (initialCategory) addSeries(initialCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeSeries = (id: string) => {
    const s = sheets.find((x) => x.id === id);
    const ids = new Set(s?.items.flatMap((i) => i.rows.map((r) => r.productId)) ?? []);
    setQty((q) => Object.fromEntries(Object.entries(q).filter(([k]) => !ids.has(k))));
    setPrice((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !ids.has(k))));
    setSheets((l) => l.filter((x) => x.id !== id));
  };

  const lines = sheets.flatMap((s) =>
    s.items.flatMap((i) =>
      i.rows
        .map((r) => {
          const q = Number(qty[r.productId] || 0);
          const p = price[r.productId] !== undefined ? price[r.productId] : r.price != null ? String(r.price) : "";
          return { r, q, p, categoryId: s.id, series: s.name };
        })
        .filter((x) => x.q > 0),
    ),
  );
  const total = lines.reduce((s, x) => s + x.q * (Number(x.p) || 0), 0);
  const now = lines.reduce((s, x) => s + Math.min(x.q, freeOf(x.r)), 0);
  const pre = lines.reduce((s, x) => s + Math.max(0, x.q - freeOf(x.r)), 0);

  const submit = () => {
    if (!lines.length) return notify("至少填一個數量");
    for (const x of lines) {
      if (!Number.isInteger(x.q) || x.q <= 0) return notify(`「${x.series} ${x.r.name}」數量請填正整數`);
      if (!/^\d+$/.test(x.p.trim())) return notify(`「${x.series} ${x.r.name}」請填單價`);
    }
    if (pre > 0 && !buyer.trim()) return notify("有要預訂的，請填客人名字（到貨才知道要給誰）");
    // 同一個商品出現在兩個系列時合在一起
    const merged = new Map<string, { productId: string; qty: number; unitPrice: number; categoryId: string }>();
    for (const x of lines) {
      const m = merged.get(x.r.productId);
      if (m) m.qty += x.q;
      else merged.set(x.r.productId, { productId: x.r.productId, qty: x.q, unitPrice: Number(x.p), categoryId: x.categoryId });
    }
    run(() => sellToCustomerAction({ buyerName: buyer.trim() || null, channel: channel || null, idemKey: idem.key, paid, owner: seller || null, lines: [...merged.values()] }), {
      success: (d) => `已登記${buyer.trim() ? `「${buyer.trim()}」` : ""}：${[d.sold ? `賣出 ${d.sold} 件` : "", d.preordered ? `預訂 ${d.preordered} 件` : ""].filter(Boolean).join("、")}`,
      onOk: async (d) => {
        setDone(`${sellerName && d.sold ? `${sellerName}賣的・` : ""}${channel ? `${channel}・` : ""}${buyer.trim() || "客人"}：${[d.sold ? `賣出 ${d.sold} 件` : "", d.preordered ? `預訂 ${d.preordered} 件（到貨再給）` : ""].filter(Boolean).join("、")}，共 ${formatTwd(d.total)}`);
        idem.renew();
        setQty({});
        setPrice({});
        setBuyer("");
        // 重新整理現貨數字（系列保留，方便記下一位）
        try {
          const fresh = await Promise.all(sheets.map((s) => fetchSheet(s.id)));
          setSheets(fresh);
        } catch (e) {
          setLoadError((e as Error).message);
        }
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-line bg-card p-4">
        {operators.length > 0 && (
          <Choice
            label="誰賣的（扣誰的庫存）"
            value={seller}
            onChange={setSeller}
            options={[...operators.map((o) => ({ value: o.id, label: o.id === me ? `${o.name}（我）` : o.name })), { value: "joint", label: "合資的" }, { value: "none", label: "未指定的" }, { value: "", label: "誰的都可以（先賣先買進的）" }]}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <ChannelPicker value={channel} onChange={setChannel} extra={channels} />
          <label className="block text-[13px] font-medium text-ink-2">
            <span className="mb-1 block">客人名稱</span>
            <input list="sell-buyers" className={`${inputCls} min-h-11`} aria-label="客人" placeholder="打名字找，沒有會新增" value={buyer} onChange={(e) => { setBuyer(e.target.value); const ch = buyerChannels[e.target.value.trim()]; if (ch) setChannel(ch); }} />
            <datalist id="sell-buyers">{buyers.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
        </div>
        <p className="-mt-1 text-[12px] text-mute">客人名稱可以不填；有要預訂的一定要填。平台會記住；選了以前的客人會自動帶他的平台。</p>
        <div>
          <div className="mb-1 text-[13px] font-semibold text-ink-2">{sheets.length ? "＋ 再加一個系列（客人一次買好幾個系列）" : "買了哪個系列？"}</div>
          <SeriesPicker series={series} value={picker} onChange={(id) => { setPicker(id); addSeries(id); }} />
        </div>
      </section>

      {done && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-good-soft px-3 py-2 text-sm text-good" data-testid="sell-done">
          <span>已存好　{done}</span>
          <span className="text-[12px]">可以直接記下一位客人</span>
        </div>
      )}
      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
          <span>{loadError}</span>
          <Button small onClick={() => window.location.reload()}>重新整理</Button>
        </div>
      )}

      {sheets.length === 0 && !loading && !loadError && <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-[14px] text-mute">先選種類和系列，下面就會帶出這個系列有賣的東西。</p>}

      {sheets.map((sheet) => (
        <div key={sheet.id} className="overflow-hidden rounded-xl border border-line bg-card" data-testid="sell-sheet" data-name={sheet.name}>
          <div className="flex items-center justify-between bg-ai-soft px-3 py-2">
            <b className="text-ai">{sheet.name}</b>
            <button type="button" className="text-[13px] text-mute" aria-label={`拿掉「${sheet.name}」`} onClick={() => removeSeries(sheet.id)}>✕ 拿掉</button>
          </div>
          {sheet.items.length === 0 ? (
            <p className="p-4 text-center text-[14px] text-mute">
              「{sheet.name}」還沒有品項和角色。<Link className="text-ai underline" href={`/catalog?open=${sheet.id}`}>到系列目錄加</Link>
            </p>
          ) : (
            sheet.items.map((it) => (
              <div key={it.typeId || "none"}>
                <div className="flex items-baseline justify-between bg-[#f7f8fa] px-3 py-2">
                  <span className="font-semibold">{it.typeName}</span>
                  <span className="text-[12px] text-mute">{it.price != null ? `預設 ${formatTwd(it.price)}` : "還沒設預設售價"}</span>
                </div>
                <table className="w-full table-fixed text-[15px]" aria-label={`${sheet.name} ${it.typeName} 數量`}>
                  <colgroup>
                    <col />
                    <col className="w-12" />
                    <col className="w-[4.5rem]" />
                    <col className="w-[6.5rem]" />
                  </colgroup>
                  <thead>
                    <tr className="text-[11.5px] text-mute">
                      <th className="px-3 py-1 text-left font-normal">角色</th>
                      <th className="px-1 py-1 text-center font-normal whitespace-nowrap">{sellerName ? `${sellerName}的` : "現貨"}</th>
                      <th className="px-1 py-1 text-center font-normal">數量</th>
                      <th className="px-3 py-1 text-right font-normal">單價</th>
                    </tr>
                  </thead>
                  <tbody>
                    {it.rows.map((r) => {
                      const q = Number(qty[r.productId] || 0);
                      const free = freeOf(r);
                      const over = q - free;
                      return (
                        <tr key={r.productId} className="border-t border-line-2 align-top" data-testid="sell-row" data-name={`${sheet.name}:${it.typeName}:${r.name}`}>
                          <td className="px-3 py-2">
                            {r.name}
                            {q > 0 && (
                              <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] whitespace-nowrap">
                                {Math.min(q, free) > 0 && <span className="rounded bg-good-soft px-1.5 text-good">現貨 {Math.min(q, free)}</span>}
                                {over > 0 && <span className="rounded bg-warn-soft px-1.5 text-warn">預訂 {over}</span>}
                                {over > 0 && seller && r.free > free && <span className="rounded bg-info-soft px-1.5 text-info" data-testid="other-has">別人還有 {r.free - free}，可改上面「誰賣的」</span>}
                              </div>
                            )}
                          </td>
                          <td className={`num px-1 py-2 text-center ${free ? "" : "text-mute"}`} data-k="free">{free}</td>
                          <td className="px-1 py-1.5 text-center">
                            <input className={`${inputCls} num px-1 text-center`} inputMode="numeric" aria-label={`${r.name} 數量`} value={qty[r.productId] ?? ""} onChange={(e) => setQty({ ...qty, [r.productId]: e.target.value })} />
                          </td>
                          <td className="py-1.5 pr-3 pl-1 text-right">
                            <input className={`${inputCls} num px-1.5 text-right`} inputMode="numeric" aria-label={`${r.name} 單價`} value={price[r.productId] ?? (r.price != null ? String(r.price) : "")} onChange={(e) => setPrice({ ...price, [r.productId]: e.target.value })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      ))}
      {loading && <p className="p-4 text-center text-[14px] text-mute">載入中…</p>}

      {sheets.some((s) => s.items.length > 0) && (
        <div className="space-y-2">
          {now > 0 && (
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" className="h-5 w-5" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
              現貨的錢已經收了
            </label>
          )}
          <Button variant="primary" className="w-full" loading={pending} disabled={!lines.length} onClick={submit}>
            {lines.length ? `登記：${now + pre} 件 ${formatTwd(total)}${pre ? `（現貨 ${now}・預訂 ${pre}）` : ""}` : "填數量後登記"}
          </Button>
        </div>
      )}
      {waiting > 0 && (
        <p className="text-[13px] text-mute">
          客人預訂還沒給的有 {waiting} 件。<Link className="text-ai underline" href="/shipping">到貨了去出貨</Link>・<Link className="text-ai underline" href="/orders">看預訂</Link>
        </p>
      )}
    </div>
  );
}
