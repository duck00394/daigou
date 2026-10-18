"use client";
// 匯入列的人工確認編輯器（LINE 與 Excel 共用）
import { useEffect, useState } from "react";
import { Button, inputCls, useRun } from "./client";
import { BuyerPicker, ProductPicker } from "./pickers";
import { updateRowAction } from "@/actions/imports";
import { buyerOpenOrdersAction } from "@/actions/ops";
import { Badge } from "./ui";
import { importRowStatus } from "@/lib/labels";

export type RowView = {
  id: string;
  rowNo: number;
  seq: number;
  status: string;
  rawText: string;
  parsed: {
    buyerText: string | null;
    productText: string | null;
    qty: number | null;
    qtyText?: string | null;
    append?: boolean;
    vague?: boolean;
    candidates?: { buyers: { id: string; code: string; name: string; via: string; score: number }[]; products: { id: string; code: string; name: string; salePriceTwd: number | null; via: string; score: number }[] };
  };
  resolution: {
    buyerId?: string | null;
    newBuyerName?: string | null;
    productId?: string | null;
    qty?: number | null;
    unitPrice?: number | null;
    groupBuyId?: string | null;
    appendMode?: "NEW" | "APPEND" | "NEW_LINKED";
    appendOrderId?: string | null;
    saveProductAlias?: boolean;
    saveBuyerAlias?: boolean;
    forceDuplicate?: boolean;
    paidAmount?: number | null;
  };
  messages: { level: "error" | "warning" | "info"; text: string }[];
  orderNo?: string | null;
  orderId?: string | null;
};

export type Lookup = {
  buyers: Record<string, { name: string; code: string; tags: { name: string; color: string }[] }>;
  products: Record<string, { name: string; code: string; salePriceTwd: number | null }>;
  groupBuys: { id: string; name: string }[];
};

export function RowStatus({ s }: { s: string }) {
  const [label, tone] = importRowStatus[s] ?? [s, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Messages({ list }: { list: RowView["messages"] }) {
  if (!list?.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-[13px]">
      {list.map((m, i) => (
        <li key={i} className={m.level === "error" ? "text-bad" : m.level === "warning" ? "text-warn" : "text-mute"}>
          {m.level === "error" ? "錯誤：" : m.level === "warning" ? "注意：" : ""}
          {m.text}
        </li>
      ))}
    </ul>
  );
}

export function RowEditor({ batchId, row, lookup, locked }: { batchId: string; row: RowView; lookup: Lookup; locked: boolean }) {
  const { run, pending } = useRun();
  const r = row.resolution;
  const save = (patch: Record<string, unknown>) => run(() => updateRowAction(batchId, row.id, patch), {});
  const [qty, setQty] = useState(String(r.qty ?? ""));
  const [price, setPrice] = useState(r.unitPrice == null ? "" : String(r.unitPrice));
  const [orders, setOrders] = useState<{ id: string; orderNo: string; groupBuy: { id: string; name: string } | null }[] | null>(null);
  useEffect(() => setQty(String(r.qty ?? "")), [r.qty]);
  useEffect(() => setPrice(r.unitPrice == null ? "" : String(r.unitPrice)), [r.unitPrice]);
  useEffect(() => {
    if (r.buyerId && r.appendMode && r.appendMode !== "NEW") buyerOpenOrdersAction(r.buyerId).then((x) => x.ok && setOrders(x.data));
  }, [r.buyerId, r.appendMode]);
  const buyer = r.buyerId ? lookup.buyers[r.buyerId] : null;
  const product = r.productId ? lookup.products[r.productId] : null;
  const cands = row.parsed.candidates ?? { buyers: [], products: [] };
  const disabled = locked || pending || row.status === "COMMITTED";

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* 買家 */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[13px]">
          <span className="font-medium text-ink-2">買家{row.parsed.buyerText ? `（原文：${row.parsed.buyerText}）` : ""}</span>
        </div>
        {buyer ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#c6e6d4] bg-good-soft px-3 py-2 text-sm">
            <b>{buyer.name}</b>
            <span className="text-[12px] text-mute">{buyer.code}</span>
            {buyer.tags.map((t) => (
              <span key={t.name} className="inline-flex items-center gap-1 rounded-full bg-white px-2 text-[12px]">
                <span className="h-2 w-2 rounded-full" style={{ background: t.color }} aria-hidden />
                {t.name}
              </span>
            ))}
            {!disabled && (
              <button type="button" className="ml-auto text-ai" onClick={() => save({ buyerId: null })}>
                更換
              </button>
            )}
          </div>
        ) : r.newBuyerName ? (
          <div className="flex items-center gap-2 rounded-lg border border-[#cfd9ea] bg-info-soft px-3 py-2 text-sm">
            將新增買家「<b>{r.newBuyerName}</b>」
            {!disabled && (
              <button type="button" className="ml-auto text-ai" onClick={() => save({ newBuyerName: null })}>
                取消
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {cands.buyers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {cands.buyers.map((c) => (
                  <button key={c.id} type="button" disabled={disabled} onClick={() => save({ buyerId: c.id })} className="rounded-lg border border-line bg-white px-2.5 py-1 text-[13px] hover:border-ai disabled:opacity-50">
                    {c.name} <span className="text-mute">{c.code}・{c.via}</span>
                  </button>
                ))}
              </div>
            )}
            {!disabled && (
              <>
                <BuyerPicker label="選擇其他買家" value={null} onPick={(b) => b && save({ buyerId: b.id })} />
                {row.parsed.buyerText && (
                  <Button small onClick={() => save({ newBuyerName: row.parsed.buyerText })}>
                    新增買家「{row.parsed.buyerText}」
                  </Button>
                )}
              </>
            )}
          </div>
        )}
        {buyer && row.parsed.buyerText && row.parsed.buyerText !== buyer.name && !disabled && (
          <label className="mt-1.5 flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" className="h-4 w-4" checked={!!r.saveBuyerAlias} onChange={(e) => save({ saveBuyerAlias: e.target.checked })} />
            記住「{row.parsed.buyerText}」是這位買家的別名
          </label>
        )}
      </div>

      {/* 商品 */}
      <div>
        <div className="mb-1 text-[13px] font-medium text-ink-2">商品{row.parsed.productText ? `（原文：${row.parsed.productText}）` : ""}</div>
        {product ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#c6e6d4] bg-good-soft px-3 py-2 text-sm">
            <b>{product.name}</b>
            <span className="text-[12px] text-mute">{product.code}</span>
            {!disabled && (
              <button type="button" className="ml-auto text-ai" onClick={() => save({ productId: null })}>
                更換
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {cands.products.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {cands.products.map((c) => (
                  <button key={c.id} type="button" disabled={disabled} onClick={() => save({ productId: c.id })} className="rounded-lg border border-line bg-white px-2.5 py-1 text-[13px] hover:border-ai disabled:opacity-50">
                    {c.name} <span className="text-mute">{c.salePriceTwd != null ? `NT$${c.salePriceTwd}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
            {!disabled && (
              <>
                <ProductPicker label="配對既有商品" value={null} onPick={(p) => p && save({ productId: p.id })} />
                {row.parsed.productText && (
                  <a className="inline-block text-[13px] text-ai hover:underline" href={`/products/new?name=${encodeURIComponent(row.parsed.productText)}`} target="_blank" rel="noopener">
                    在新分頁新增商品「{row.parsed.productText}」，完成後按「重新比對」
                  </a>
                )}
              </>
            )}
          </div>
        )}
        {product && row.parsed.productText && row.parsed.productText !== product.name && !disabled && (
          <label className="mt-1.5 flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" className="h-4 w-4" checked={!!r.saveProductAlias} onChange={(e) => save({ saveProductAlias: e.target.checked })} />
            記住「{row.parsed.productText}」是這個商品的別名
          </label>
        )}
      </div>

      {/* 數量、價格、代購團、追加 */}
      <div className="grid grid-cols-2 gap-2 md:col-span-2 md:grid-cols-4">
        <label className="text-[13px] text-ink-2">
          數量
          <input
            className={inputCls}
            inputMode="numeric"
            disabled={disabled}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onBlur={(e) => {
              const v = e.currentTarget.value;
              const n = Number(v);
              if (v !== String(r.qty ?? "")) save({ qty: Number.isInteger(n) ? n : null });
            }}
          />
        </label>
        <label className="text-[13px] text-ink-2">
          成交單價
          <input
            className={inputCls}
            inputMode="numeric"
            disabled={disabled}
            value={price}
            placeholder={product?.salePriceTwd != null ? `預設 ${product.salePriceTwd}` : "必填"}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={(e) => {
              const raw = e.currentTarget.value;
              const v = raw.trim() === "" ? null : Number(raw);
              if (v !== (r.unitPrice ?? null)) save({ unitPrice: v === null || Number.isNaN(v) ? null : v });
            }}
          />
        </label>
        <label className="text-[13px] text-ink-2">
          代購團
          <select className={inputCls} disabled={disabled} value={r.groupBuyId ?? ""} onChange={(e) => save({ groupBuyId: e.target.value || null, appendOrderId: null })}>
            <option value="">不指定</option>
            {lookup.groupBuys.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px] text-ink-2">
          建立方式
          <select className={inputCls} disabled={disabled || !r.buyerId} value={r.appendMode ?? "NEW"} onChange={(e) => save({ appendMode: e.target.value, appendOrderId: null })}>
            <option value="NEW">新訂單</option>
            <option value="APPEND">追加到原訂單</option>
            <option value="NEW_LINKED">獨立追加訂單</option>
          </select>
        </label>
        {r.appendMode && r.appendMode !== "NEW" && (
          <label className="col-span-2 text-[13px] text-ink-2">
            原訂單
            <select className={inputCls} disabled={disabled} value={r.appendOrderId ?? ""} onChange={(e) => save({ appendOrderId: e.target.value || null })}>
              <option value="">{orders === null ? "載入中…" : orders.length ? "請選擇" : "這位買家沒有進行中的訂單"}</option>
              {(orders ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNo}
                  {o.groupBuy ? `（${o.groupBuy.name}）` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[13px] md:col-span-2">
        {row.status === "DUPLICATE_SUSPECT" && !disabled && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="h-4 w-4" checked={!!r.forceDuplicate} onChange={(e) => save({ forceDuplicate: e.target.checked })} />
            確認不是重複，仍要建立
          </label>
        )}
        {r.forceDuplicate && row.status !== "DUPLICATE_SUSPECT" && !disabled && (
          <button type="button" className="text-ai" onClick={() => save({ forceDuplicate: false })}>
            撤銷「仍要建立」
          </button>
        )}
        {row.status !== "COMMITTED" && !locked && (
          <Button small variant="ghost" onClick={() => save({ exclude: row.status !== "EXCLUDED" })}>
            {row.status === "EXCLUDED" ? "取消排除" : "排除這一列"}
          </Button>
        )}
      </div>
    </div>
  );
}
