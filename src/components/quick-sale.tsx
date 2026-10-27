"use client";
// 現貨直接出售：選商品（或從庫存卡片直接帶入）→ 數量 → 售價 → 確認；也用於「更正」
import { useState } from "react";
import { Button, Modal, TextField, useIdemKey, useRun, inputCls, notify } from "./client";
import { ProductPicker, type ProductOpt } from "./pickers";
import { correctQuickSaleAction, quickSaleAction } from "@/actions/sales";
import { formatTwd } from "@/lib/money";
import { toDateInput } from "@/lib/labels";
import { OwnerChips, defaultOwner, type OwnerStockOpt } from "./owner-chips";
import { Choice } from "./choice";

type Fixed = { id: string; name: string; salePriceTwd: number | null; available?: number; avgCost?: number | null; owners?: OwnerStockOpt[] };
export type CorrectFrom = { orderId: string; productId: string; productName: string; qty: number; unitPrice: number; buyerName: string | null; soldAt: string; note: string | null; owner?: string | null; ownerNow?: string };

export function SellButton({ product, small, label = "出售", primary, autoOpen, correct, me, operators = [] }: { product?: Fixed; small?: boolean; label?: string; primary?: boolean; autoOpen?: boolean; correct?: CorrectFrom; me?: string | null; operators?: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(!!autoOpen);
  const [picked, setPicked] = useState<ProductOpt | null>(null);
  const init = () => ({
    qty: String(correct?.qty ?? 1),
    price: correct ? String(correct.unitPrice) : product?.salePriceTwd != null ? String(product.salePriceTwd) : "",
    buyer: correct?.buyerName ?? "",
    date: correct?.soldAt ?? toDateInput(new Date()),
    note: correct?.note ?? "",
    paid: true,
    reason: "",
  });
  const [f, setF] = useState(init);
  const freeOf = (o: OwnerStockOpt) => o.free;
  const [owner, setOwner] = useState<string | null>(null);
  // 更正時可以改「誰賣的」：改扣那個人的庫存，原本扣到的會退回去
  const sellerOpts = [...operators.map((o) => ({ value: o.id, label: o.name })), { value: "joint", label: "合資的" }, { value: "none", label: "未指定的" }, { value: "", label: "誰的都可以（先賣先買進的）" }];
  const [seller, setSeller] = useState(correct?.owner ?? "");
  const sellerChanged = !!correct && seller !== (correct.owner ?? "");
  const sellerName = sellerOpts.find((o) => o.value === seller)?.label ?? "";
  const [done, setDone] = useState<{ revenue: number; cost: number; profit: number; tentative: boolean; duplicated: boolean } | null>(null);
  const idem = useIdemKey();
  const { run, pending } = useRun();
  const productId = correct?.productId ?? product?.id ?? picked?.id ?? null;
  const productName = correct?.productName ?? product?.name ?? picked?.name ?? "";
  const qty = Number(f.qty);
  const price = Number(f.price);
  const valid = !!productId && Number.isInteger(qty) && qty > 0 && /^\d+$/.test(f.price.trim()) && (!correct || !!f.reason.trim() || sellerChanged);
  const ownerOpt = product?.owners?.find((o) => o.key === owner);
  const max = ownerOpt ? ownerOpt.free : product?.available;
  const close = () => { setOpen(false); setDone(null); };

  const submit = () => {
    if (!productId) return notify("請選擇商品");
    if (!valid) return notify(correct && !f.reason.trim() ? "請填寫更正原因" : "請確認數量與售價");
    if (max !== undefined && qty > max) return notify(`可售庫存只有 ${max} 件`);
    const payload = { productId, qty, unitPrice: price, buyerName: f.buyer || null, soldAt: f.date || null, note: f.note || null, paid: f.paid, owner: correct ? seller || null : owner, idemKey: idem.key };
    const reason = f.reason.trim() || (sellerChanged ? `改成${seller ? sellerName : "誰的都可以"}賣的` : "");
    run(() => (correct ? correctQuickSaleAction(correct.orderId, { ...payload, reason }) : quickSaleAction(payload)), {
      success: (d) => (d.duplicated ? "這筆出售已經登記過，沒有重複扣庫存" : correct ? `已更正：收入 ${formatTwd(d.revenue)}、毛利 ${formatTwd(d.profit)}${d.tentative ? "（成本價格還沒確定）" : ""}` : `已出售 ${qty} 件`),
      // 更正後舊紀錄會變成已作廢、這一列重新整理，所以直接關閉並以提示訊息顯示結果
      onOk: (d) => { idem.renew(); if (correct) setOpen(false); else setDone(d); },
    });
  };

  return (
    <>
      <Button small={small} variant={primary ? "primary" : "default"} disabled={!correct && max !== undefined && max <= 0} title={!correct && max !== undefined && max <= 0 ? "沒有可售庫存" : undefined} onClick={() => { setF(init()); setDone(null); setSeller(correct?.owner ?? ""); setOwner(defaultOwner(product?.owners, me, freeOf)); setOpen(true); }}>{label}</Button>
      <Modal
        open={open}
        onClose={close}
        title={done ? (correct ? "已更正" : "已出售") : correct ? `更正出售：${productName}` : productName ? `出售：${productName}` : "出售現貨"}
        footer={done ? <Button variant="primary" onClick={close}>完成</Button> : <Button variant="primary" loading={pending} disabled={!valid} onClick={submit}>{correct ? "作廢舊紀錄並儲存" : `確認出售${valid ? ` ${formatTwd(qty * price)}` : ""}`}</Button>}
      >
        {done ? (
          <dl className="grid grid-cols-3 gap-2 text-center">
            {([["收入", done.revenue], ["商品成本", done.cost], ["毛利", done.profit]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-[#fafbfc] py-2">
                <dt className="text-[12px] text-mute">{k}</dt>
                <dd className={`num text-[18px] font-semibold ${k === "毛利" && v < 0 ? "text-bad" : ""}`}>{formatTwd(v)}</dd>
              </div>
            ))}
            {done.tentative && <p className="col-span-3 text-[12px] text-warn">成本有價格還沒確定（採購實際單價或運費等費用尚未確認），之後確認了會自動更新。</p>}
          </dl>
        ) : (
          <div className="space-y-3">
            {!product && !correct && <ProductPicker value={picked} onPick={(p) => { setPicked(p); if (p?.salePriceTwd != null && !f.price) setF((x) => ({ ...x, price: String(p.salePriceTwd) })); }} />}
            {correct && operators.length > 0 && (
              <Choice
                label="誰賣的（扣誰的庫存）"
                value={seller}
                onChange={setSeller}
                options={sellerOpts}
                hint={`${correct.ownerNow ? `現在扣的是：${correct.ownerNow}。` : ""}改了之後會改扣這個人的貨，原本扣到的會退回去。`}
              />
            )}
            {!correct && <OwnerChips label="賣誰的" owners={product?.owners ?? []} value={owner} onChange={setOwner} count={freeOf} />}
            {max !== undefined && <p className="text-[13px] text-mute">可售庫存 {max} 件（留給買家、自留的不會被賣掉）</p>}
            {product?.avgCost != null && (
              <p className="text-[13px] text-mute">
                平均成本約 {formatTwd(product.avgCost)}／件
                {valid && <span className={price - product.avgCost < 0 ? " text-bad" : " text-good"}>，預估毛利 {formatTwd((price - product.avgCost) * qty)}</span>}
                <span className="block text-[11px]">實際成本以先進先出的批次計算，儲存後會顯示。</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="qs-qty">數量</label>
                <div className="flex items-center gap-1">
                  <Button onClick={() => setF((x) => ({ ...x, qty: String(Math.max(1, (Number(x.qty) || 1) - 1)) }))} aria-label="減少">－</Button>
                  <input id="qs-qty" inputMode="numeric" className={`${inputCls} num text-center`} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, "") })} />
                  <Button onClick={() => setF((x) => ({ ...x, qty: String(Math.min(max ?? 999, (Number(x.qty) || 0) + 1)) }))} aria-label="增加">＋</Button>
                </div>
              </div>
              <TextField label="每件售價（台幣）" inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d]/g, "") })} />
            </div>
            <details className="rounded-lg border border-line-2 px-3 py-2" open={!!correct || undefined}>
              <summary className="cursor-pointer text-sm text-ai">選填：買家、日期、備註</summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="qs-buyer">買家</label>
                  <input id="qs-buyer" list="buyer-names" className={inputCls} value={f.buyer} onChange={(e) => setF({ ...f, buyer: e.target.value })} placeholder="不填＝散客" />
                </div>
                <TextField label="成交日期" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
                <TextField label="備註" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="sm:col-span-2" />
              </div>
            </details>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} />
              已收到款項
            </label>
            {correct && <TextField label={sellerChanged ? "更正原因（可不填）" : "更正原因（必填）"} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} hint="原紀錄會作廢並保留，商品先退回庫存，再依新內容出售" />}
          </div>
        )}
      </Modal>
    </>
  );
}
