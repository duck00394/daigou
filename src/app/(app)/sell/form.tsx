"use client";
// 賣給客人：選系列 → 帶出這個系列有賣的所有品項和角色 → 填數量（單價先帶系列的預設售價，可以改）
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, inputCls, notify, useIdemKey, useRun } from "@/components/client";
import { SeriesPicker, type SeriesOpt } from "@/components/series-picker";
import { sellSheetAction, sellToCustomerAction } from "@/actions/catalog-tree";
import { formatTwd } from "@/lib/money";

type Row = { productId: string; name: string; free: number; incoming: number; price: number | null };
type Sheet = { id: string; name: string; items: { typeId: string; typeName: string; price: number | null; rows: Row[] }[] };

export function SellForm({ series, buyers, initialCategory, waiting }: { series: SeriesOpt[]; buyers: string[]; initialCategory: string; waiting: number }) {
  const [cat, setCat] = useState(initialCategory);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [price, setPrice] = useState<Record<string, string>>({});
  const [buyer, setBuyer] = useState("");
  const [paid, setPaid] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const idem = useIdemKey();
  const { run, pending } = useRun();

  const load = async (id: string) => {
    if (!id) return setSheet(null);
    setLoading(true);
    const r = await sellSheetAction(id);
    setLoading(false);
    if (!r.ok) return notify(r.error);
    setSheet(r.data);
  };
  useEffect(() => {
    load(cat);
    setQty({});
    setPrice({});
  }, [cat]);

  const rows = sheet?.items.flatMap((i) => i.rows) ?? [];
  const lines = rows
    .map((r) => {
      const q = Number(qty[r.productId] || 0);
      const p = price[r.productId] !== undefined ? price[r.productId] : r.price != null ? String(r.price) : "";
      return { r, q, p };
    })
    .filter((x) => x.q > 0);
  const total = lines.reduce((s, x) => s + x.q * (Number(x.p) || 0), 0);
  const now = lines.reduce((s, x) => s + Math.min(x.q, x.r.free), 0);
  const pre = lines.reduce((s, x) => s + Math.max(0, x.q - x.r.free), 0);

  const submit = () => {
    if (!lines.length) return notify("至少填一個數量");
    for (const x of lines) {
      if (!Number.isInteger(x.q) || x.q <= 0) return notify(`「${x.r.name}」數量請填正整數`);
      if (!/^\d+$/.test(x.p.trim())) return notify(`「${x.r.name}」請填單價`);
    }
    if (pre > 0 && !buyer.trim()) return notify("有要預訂的，請填客人名字（到貨才知道要給誰）");
    run(() => sellToCustomerAction({ buyerName: buyer.trim() || null, categoryId: cat || null, idemKey: idem.key, paid, lines: lines.map((x) => ({ productId: x.r.productId, qty: x.q, unitPrice: Number(x.p) })) }), {
      success: (d) => `已登記${buyer.trim() ? `「${buyer.trim()}」` : ""}：${[d.sold ? `賣出 ${d.sold} 件` : "", d.preordered ? `預訂 ${d.preordered} 件` : ""].filter(Boolean).join("、")}`,
      onOk: (d) => {
        setDone(`${buyer.trim() || "客人"}：${[d.sold ? `賣出 ${d.sold} 件` : "", d.preordered ? `預訂 ${d.preordered} 件（到貨再給）` : ""].filter(Boolean).join("、")}，共 ${formatTwd(d.total)}`);
        idem.renew();
        setQty({});
        setPrice({});
        setBuyer("");
        load(cat);
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-line bg-card p-4">
        <SeriesPicker series={series} value={cat} onChange={(id) => { setCat(id); setDone(null); }} />
        <label className="block text-[13px] font-medium text-ink-2">
          客人（可不填；有預訂一定要填）
          <input list="sell-buyers" className={`${inputCls} mt-1`} aria-label="客人" placeholder="🔍 打名字找客人，沒有會自動新增" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
          <datalist id="sell-buyers">{buyers.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
      </section>

      {done && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-good-soft px-3 py-2 text-sm text-good" data-testid="sell-done">
          <span>已存好　{done}</span>
          <span className="text-[12px]">可以直接記下一位客人</span>
        </div>
      )}

      {!cat ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-[14px] text-mute">先選種類和系列，下面就會帶出這個系列有賣的東西。</p>
      ) : loading && !sheet ? (
        <p className="p-6 text-center text-[14px] text-mute">載入中…</p>
      ) : sheet && sheet.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-[14px] text-mute">
          「{sheet.name}」還沒有品項和角色。<Link className="text-ai underline" href={`/catalog?open=${sheet.id}`}>到系列目錄加</Link>
        </p>
      ) : (
        sheet && (
          <div className="overflow-hidden rounded-xl border border-line bg-card">
            {sheet.items.map((it) => (
              <div key={it.typeId || "none"}>
                <div className="flex items-baseline justify-between bg-[#f7f8fa] px-3 py-2">
                  <span className="font-semibold">{it.typeName}</span>
                  <span className="text-[12px] text-mute">{it.price != null ? `預設 ${formatTwd(it.price)}` : "還沒設預設售價"}</span>
                </div>
                <table className="w-full table-fixed text-[15px]" aria-label={`${it.typeName} 數量`}>
                  <colgroup>
                    <col />
                    <col className="w-12" />
                    <col className="w-[4.5rem]" />
                    <col className="w-[6.5rem]" />
                  </colgroup>
                  <thead>
                    <tr className="text-[11.5px] text-mute">
                      <th className="px-3 py-1 text-left font-normal">角色</th>
                      <th className="px-1 py-1 text-center font-normal whitespace-nowrap">現貨</th>
                      <th className="px-1 py-1 text-center font-normal">數量</th>
                      <th className="px-3 py-1 text-right font-normal">單價</th>
                    </tr>
                  </thead>
                  <tbody>
                    {it.rows.map((r) => {
                      const q = Number(qty[r.productId] || 0);
                      const over = q - r.free;
                      return (
                        <tr key={r.productId} className="border-t border-line-2 align-top" data-testid="sell-row" data-name={`${it.typeName}:${r.name}`}>
                          <td className="px-3 py-2">
                            {r.name}
                            {q > 0 && (
                              <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] whitespace-nowrap">
                                {Math.min(q, r.free) > 0 && <span className="rounded bg-good-soft px-1.5 text-good">現貨 {Math.min(q, r.free)}</span>}
                                {over > 0 && <span className="rounded bg-warn-soft px-1.5 text-warn">預訂 {over}</span>}
                              </div>
                            )}
                          </td>
                          <td className={`num px-1 py-2 text-center ${r.free ? "" : "text-mute"}`}>{r.free}</td>
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
            ))}
          </div>
        )
      )}

      {sheet && sheet.items.length > 0 && (
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
