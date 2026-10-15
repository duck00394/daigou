"use client";
// 採購團詳情：基本資料（可修改）、從其他團複製品項、砍單
import { useState } from "react";
import Link from "next/link";
import { Button, Modal, TextField, SelectField, TextArea, useIdemKey, useRun, inputCls, notify } from "@/components/client";
import { batchItemsForCopyAction, cancelBatchItemAction, copyBatchItemsAction, updateBatchInfoAction } from "@/actions/batches";
import { formatJpy, formatTwd } from "@/lib/money";

const money = (v: number, c: string) => (c === "JPY" ? formatJpy(v) : formatTwd(v));

// ── 基本資料 ──
export type BatchInfoView = {
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  supplierOrderNo: string | null;
  orderUrl: string | null;
  expectedAt: string; // yyyy-mm-dd 或空字串
  orderedAt: string;
  rate: string;
  notes: string | null;
};

export function BatchInfoCard({ batchId, info, suppliers, categories, editable }: { batchId: string; info: BatchInfoView; suppliers: { id: string; name: string }[]; categories: { id: string; name: string }[]; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(info);
  const { run, pending } = useRun();
  const rows: [string, React.ReactNode][] = [
    ["供應商", info.supplierName ?? "—"],
    ["活動／系列", info.categoryId ? <Link className="text-ai hover:underline" href={`/categories/${info.categoryId}`}>{info.categoryName}</Link> : "未指定"],
    ["供應商訂單編號", info.supplierOrderNo ?? "—"],
    ["訂購連結", info.orderUrl ? <a className="break-all text-ai hover:underline" href={info.orderUrl} target="_blank" rel="noopener noreferrer">{info.orderUrl}</a> : "—"],
    ["下單日", info.orderedAt],
    ["預計到貨", info.expectedAt ? info.expectedAt.replace(/-/g, "/") : "—"],
    ["本團匯率", `1 日圓 = ${info.rate} 台幣（建立時鎖定）`],
    ["備註", info.notes ?? "—"],
  ];
  return (
    <div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-mute">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {editable && (
        <div className="mt-2 text-right">
          <Button small onClick={() => { setF(info); setOpen(true); }}>修改基本資料</Button>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="修改採購團基本資料"
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              run(
                () => updateBatchInfoAction(batchId, { name: f.name, supplierId: f.supplierId || null, categoryId: f.categoryId || null, supplierOrderNo: f.supplierOrderNo, orderUrl: f.orderUrl, expectedAt: f.expectedAt || null, notes: f.notes }),
                { success: "已更新", onOk: () => setOpen(false) },
              )
            }
          >
            儲存
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="採購團名稱" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="sm:col-span-2" />
          <SelectField label="供應商" value={f.supplierId ?? ""} onChange={(e) => setF({ ...f, supplierId: e.target.value || null })} options={[["", "不指定"], ...suppliers.map((s) => [s.id, s.name] as [string, string])]} />
          <SelectField label="活動／系列" value={f.categoryId ?? ""} onChange={(e) => setF({ ...f, categoryId: e.target.value || null })} options={[["", "未指定"], ...categories.map((c) => [c.id, c.name] as [string, string])]} />
          <TextField label="供應商訂單編號" value={f.supplierOrderNo ?? ""} onChange={(e) => setF({ ...f, supplierOrderNo: e.target.value })} />
          <TextField label="預計到貨日" type="date" value={f.expectedAt} onChange={(e) => setF({ ...f, expectedAt: e.target.value })} />
          <TextField label="訂購連結" value={f.orderUrl ?? ""} onChange={(e) => setF({ ...f, orderUrl: e.target.value })} placeholder="https://" className="sm:col-span-2" />
          <TextArea label="備註" rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} className="sm:col-span-2" />
        </div>
        <p className="mt-2 text-[12px] text-mute">匯率在建立時鎖定，不能在這裡修改；改供應商不會改動已輸入的單價。</p>
      </Modal>
    </div>
  );
}

// ── 從其他採購團複製品項 ──
type SrcItem = { id: string; name: string; specNote: string | null; qty: number; currency: "JPY" | "TWD"; refPrice: number; refActual: boolean };
type Row = { qty: string; price: string; currency: "JPY" | "TWD" };

export function CopyItemsButton({ toBatchId, batches }: { toBatchId: string; batches: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [items, setItems] = useState<SrcItem[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [withPrice, setWithPrice] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const idem = useIdemKey();
  const { run, pending } = useRun();

  const fill = (list: SrcItem[], price: boolean) => setRows(Object.fromEntries(list.map((i) => [i.id, { qty: String(i.qty), price: price ? String(i.refPrice) : "", currency: i.currency }])));
  const load = async (id: string) => {
    setFrom(id);
    setConfirmed(false);
    if (!id) return setItems([]);
    setLoading(true);
    const r = await batchItemsForCopyAction(id);
    setLoading(false);
    if (!r.ok) return notify(r.error);
    setItems(r.data);
    fill(r.data, withPrice);
  };
  const submit = () => {
    const out: { sourceItemId: string; qty: number; unitCost: number; currency: "JPY" | "TWD" }[] = [];
    for (const i of items) {
      const r = rows[i.id];
      const q = Number(r.qty || 0);
      if (!Number.isInteger(q) || q < 0) return notify(`「${i.name}」數量必須是整數`);
      if (q === 0) continue;
      if (!/^\d+$/.test(r.price.trim())) return notify(`請填寫「${i.name}」的單價`);
      out.push({ sourceItemId: i.id, qty: q, unitCost: Number(r.price), currency: r.currency });
    }
    if (!out.length) return notify("請至少保留一列數量大於 0");
    run(() => copyBatchItemsAction({ fromBatchId: from, toBatchId, submissionKey: idem.key, rows: out }), {
      success: (d) => `已新增 ${d.created} 個品項${d.duplicated ? `（${d.duplicated} 個先前已新增，未重複）` : ""}`,
      onOk: () => { idem.renew(); setOpen(false); setFrom(""); setItems([]); },
    });
  };
  return (
    <>
      <Button small onClick={() => setOpen(true)} disabled={!batches.length}>從其他團複製品項</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="從其他採購團複製品項"
        wide
        footer={<Button variant="primary" loading={pending} disabled={!items.length || (withPrice && !confirmed)} onClick={submit}>新增到本團</Button>}
      >
        <SelectField label="來源採購團" value={from} onChange={(e) => load(e.target.value)} options={[["", "請選擇"], ...batches.map((b) => [b.id, b.label] as [string, string])]} />
        <div role="radiogroup" aria-label="價格" className="mt-3 grid grid-cols-2 gap-2">
          {([[true, "帶入舊價格當參考"], [false, "只帶商品清單"]] as const).map(([v, l]) => (
            <button key={l} type="button" role="radio" aria-checked={withPrice === v} onClick={() => { setWithPrice(v); setConfirmed(false); fill(items, v); }} className={`min-h-10 rounded-lg border px-2 text-sm ${withPrice === v ? "border-ai bg-ai text-white" : "border-line bg-white"}`}>{l}</button>
          ))}
        </div>
        {loading && <p className="mt-3 text-sm text-mute">讀取中…</p>}
        {items.length > 0 && (
          <div className="mt-3 space-y-2">
            {items.map((i) => {
              const r = rows[i.id];
              return (
                <div key={i.id} className={`grid grid-cols-[1fr_4.5rem_6rem_4.5rem] items-center gap-2 rounded-lg border p-2 ${Number(r.qty || 0) === 0 ? "border-line-2 opacity-50" : "border-line"}`}>
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{i.name}{i.specNote ? ` ${i.specNote}` : ""}</div>
                    <div className="text-[12px] text-mute">參考：{money(i.refPrice, i.currency)}（{i.refActual ? "實際" : "預估"}）× {i.qty}</div>
                  </div>
                  <input aria-label={`${i.name} 數量`} className={`${inputCls} num px-2 text-right`} inputMode="numeric" value={r.qty} onChange={(e) => setRows({ ...rows, [i.id]: { ...r, qty: e.target.value } })} />
                  <input aria-label={`${i.name} 單價`} className={`${inputCls} num px-2 text-right ${withPrice ? "bg-warn-soft/50" : ""}`} inputMode="numeric" value={r.price} placeholder="單價" onChange={(e) => { setConfirmed(false); setRows({ ...rows, [i.id]: { ...r, price: e.target.value } }); }} />
                  <select aria-label={`${i.name} 幣別`} className={`${inputCls} px-1`} value={r.currency} onChange={(e) => setRows({ ...rows, [i.id]: { ...r, currency: e.target.value as "JPY" | "TWD" } })}>
                    <option value="JPY">日幣</option>
                    <option value="TWD">台幣</option>
                  </select>
                </div>
              );
            })}
            <p className="text-[12px] text-mute">數量填 0 的列不會新增。只會建立新的採購品項，不會複製付款、收貨、退款、出貨或庫存紀錄。</p>
            {withPrice && (
              <label className={`flex items-start gap-2 rounded-lg p-2 text-sm ${confirmed ? "bg-good-soft" : "bg-warn-soft"}`}>
                <input type="checkbox" className="mt-0.5 h-5 w-5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>黃底單價是舊團的參考值，我已確認本團的實際單價</span>
              </label>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

// ── 砍單 ──
const REASONS: [string, string][] = [["AGENT_CANCEL", "代購砍單"], ["SELLER_CANCEL", "賣家取消"], ["OUT_OF_STOCK", "商品缺貨"], ["SELF_CANCEL", "自己取消"], ["OTHER", "其他"]];
type CancelResult = { cancelled: number; remaining: number; affected: { orderNo: string; buyerName: string; qty: number }[]; marked: boolean; paid: { currency: string; amount: number }[] };

export function CancelItemButton({ itemId, name, max }: { itemId: string; name: string; max: number }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(max);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [mark, setMark] = useState(true);
  const [result, setResult] = useState<CancelResult | null>(null);
  const cancelIdem = useIdemKey();
  const { run, pending } = useRun();
  if (max <= 0) return null;
  const close = () => { setOpen(false); setResult(null); };
  return (
    <>
      <Button small variant="ghost" onClick={() => { setN(max); setReason(null); setNote(""); setResult(null); setOpen(true); }}>砍單</Button>
      <Modal
        open={open}
        onClose={close}
        title={result ? "已砍單" : `砍單：${name}`}
        footer={
          result ? (
            <Button variant="primary" onClick={close}>知道了</Button>
          ) : (
            <Button
              variant="danger"
              loading={pending}
              disabled={!reason || n < 1 || n > max || (reason === "OTHER" && !note.trim())}
              onClick={() => reason && run(() => cancelBatchItemAction(itemId, { qty: n, reason, note: note || null, markShortage: mark, requestKey: cancelIdem.key }), { success: `已砍單 ${n} 件`, onOk: (d) => { cancelIdem.renew(); setResult(d); } })}
            >
              砍掉 {n} 件
            </Button>
          )
        }
      >
        {result ? (
          <div className="space-y-3 text-sm">
            <p>已取消 {result.cancelled} 件，這個品項還有 {result.remaining} 件有效。同團其他品項不受影響。</p>
            {result.paid.length > 0 && (
              <p className="rounded-lg bg-warn-soft p-2 text-warn">這團已付給供應商 {result.paid.map((p) => money(p.amount, p.currency)).join("、")}。砍單不會自動當成已退款，退款到帳後請在付款紀錄備註或修改。</p>
            )}
            {result.affected.length > 0 ? (
              <div>
                <p className="font-medium">{result.marked ? "以下買家明細已標為「缺貨」（訂單沒有刪除，請聯絡買家後再處理）：" : "以下買家明細可能因此缺貨："}</p>
                <ul className="mt-1 list-disc pl-5">{result.affected.map((a) => <li key={a.orderNo}>{a.orderNo} {a.buyerName}：缺 {a.qty} 件</li>)}</ul>
              </div>
            ) : (
              <p className="text-mute">沒有買家訂單因此缺貨。</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-[13px] font-medium text-ink-2">原因</div>
              <div role="radiogroup" aria-label="砍單原因" className="flex flex-wrap gap-1.5">
                {REASONS.map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={reason === k} onClick={() => setReason(k)} className={`min-h-10 rounded-lg border px-3 text-[15px] ${reason === k ? "border-ai bg-ai text-white" : "border-line bg-white"}`}>{l}</button>
                ))}
              </div>
              {reason === "OTHER" && <input aria-label="其他原因" autoFocus className={`${inputCls} mt-2`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="請補充原因" />}
            </div>
            <div>
              <div className="mb-1 text-[13px] font-medium text-ink-2">砍幾件（尚未到貨 {max} 件）</div>
              <div className="flex items-center gap-3">
                <Button onClick={() => setN((x) => Math.max(1, x - 1))} aria-label="減少">－</Button>
                <input aria-label="砍單數量" inputMode="numeric" className={`${inputCls} num w-20 text-center text-lg`} value={n} onChange={(e) => setN(Number(e.target.value.replace(/\D/g, "")) || 0)} />
                <Button onClick={() => setN((x) => Math.min(max, x + 1))} aria-label="增加">＋</Button>
                <Button small variant="ghost" onClick={() => setN(max)}>全部</Button>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5" checked={mark} onChange={(e) => setMark(e.target.checked)} />
              <span>若有買家訂單因此不夠貨，把它們標為「缺貨」（不會刪除訂單）</span>
            </label>
            <p className="text-[12px] text-mute">砍單會保留原始紀錄與原因；只有輸入錯誤、沒有任何到貨的品項才適合用「刪除」。</p>
          </div>
        )}
      </Modal>
    </>
  );
}
