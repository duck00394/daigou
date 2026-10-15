"use client";
// 買家與商品的搜尋選擇器
import { useEffect, useRef, useState } from "react";
import { buyerSearchAction, productSearchAction } from "@/actions/ops";
import { inputCls } from "./client";

export type BuyerOpt = { id: string; code: string; name: string; lineName: string | null };
export type ProductOpt = { id: string; code: string; name: string; salePriceTwd: number | null; spec: string | null; categories: { id: string; name: string }[] };

function useSearch<T>(fn: (q: string) => Promise<{ ok: true; data: T[] } | { ok: false; error: string }>, q: string, enabled: boolean) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fn(q);
        if (alive && r.ok) setItems(r.data);
      } finally {
        if (alive) setLoading(false);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, enabled, fn]);
  return { items, loading };
}

function Picker<T extends { id: string }>({
  label,
  value,
  onPick,
  search,
  render,
  display,
  placeholder,
  extra,
}: {
  label: string;
  value: T | null;
  onPick: (v: T | null) => void;
  search: (q: string) => Promise<{ ok: true; data: T[] } | { ok: false; error: string }>;
  render: (v: T) => React.ReactNode;
  display: (v: T) => string;
  placeholder: string;
  extra?: (q: string, close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { items, loading } = useSearch(search, q, open);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={box} className="relative">
      <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>
      {value && !open ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2">
          <span className="min-w-0 truncate">{display(value)}</span>
          <button type="button" className="shrink-0 text-sm text-ai" onClick={() => setOpen(true)}>
            更換
          </button>
        </div>
      ) : (
        <input autoFocus={open} className={inputCls} value={q} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)} aria-label={label} />
      )}
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-lg">
          {loading && <div className="px-3 py-2 text-sm text-mute">搜尋中…</div>}
          {!loading && items.length === 0 && <div className="px-3 py-2 text-sm text-mute">找不到符合的資料</div>}
          {items.map((it) => (
            <button
              type="button"
              key={it.id}
              className="block w-full border-b border-line-2 px-3 py-2 text-left hover:bg-ai-soft"
              onClick={() => {
                onPick(it);
                setOpen(false);
                setQ("");
              }}
            >
              {render(it)}
            </button>
          ))}
          {extra?.(q, () => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function BuyerPicker({ value, onPick, label = "買家", extra }: { value: BuyerOpt | null; onPick: (b: BuyerOpt | null) => void; label?: string; extra?: (q: string, close: () => void) => React.ReactNode }) {
  return (
    <Picker
      label={label}
      value={value}
      onPick={onPick}
      search={buyerSearchAction}
      placeholder="輸入名稱、LINE 暱稱或別名"
      display={(b) => `${b.name}（${b.code}）`}
      render={(b) => (
        <span>
          <span className="font-medium">{b.name}</span>
          <span className="ml-2 text-[12px] text-mute">
            {b.code}
            {b.lineName ? `｜LINE：${b.lineName}` : ""}
          </span>
        </span>
      )}
      extra={extra}
    />
  );
}

export function ProductPicker({ value, onPick, label = "商品", extra }: { value: ProductOpt | null; onPick: (p: ProductOpt | null) => void; label?: string; extra?: (q: string, close: () => void) => React.ReactNode }) {
  return (
    <Picker
      label={label}
      value={value}
      onPick={onPick}
      search={productSearchAction}
      placeholder="輸入商品名稱、編號或別名"
      display={(p) => `${p.name}（${p.code}）`}
      render={(p) => (
        <span>
          <span className="font-medium">{p.name}</span>
          <span className="ml-2 text-[12px] text-mute">
            {p.code}
            {p.salePriceTwd !== null ? `｜NT$${p.salePriceTwd}` : "｜未設定售價"}
            {p.spec ? `｜${p.spec}` : ""}
          </span>
        </span>
      )}
      extra={extra}
    />
  );
}
