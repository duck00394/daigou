"use client";
// 訂購頁的購物車（存在這支手機的瀏覽器裡；送出時伺服器會重新檢查價格、名額、限購）
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type CartItem = { categoryId: string; productId: string; qty: number; name: string; price: number; image: string | null; catName: string; max: number };

type Ctx = {
  items: CartItem[];
  ready: boolean;
  add: (list: CartItem[]) => void;
  setQty: (categoryId: string, productId: string, qty: number) => void;
  remove: (categoryId: string, productId: string) => void;
  clear: () => void;
  count: number;
  total: number;
};

const KEY = "dg_cart_v1";
const CartCtx = createContext<Ctx | null>(null);

function load(): CartItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.productId === "string" && Number.isInteger(x.qty) && x.qty > 0) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setItems(load());
    setReady(true);
    const onStorage = (e: StorageEvent) => e.key === KEY && setItems(load());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const save = useCallback((next: CartItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 無痕模式等存不了：只留在這一頁 */
    }
  }, []);
  const value = useMemo<Ctx>(() => {
    const same = (a: CartItem, c: string, p: string) => a.categoryId === c && a.productId === p;
    return {
      items,
      ready,
      add: (list) => {
        const next = [...items];
        for (const it of list) {
          const i = next.findIndex((x) => same(x, it.categoryId, it.productId));
          if (i >= 0) next[i] = { ...it, qty: Math.min(it.max || 99, next[i].qty + it.qty) };
          else next.push(it);
        }
        save(next);
      },
      setQty: (c, p, qty) => save(items.map((x) => (same(x, c, p) ? { ...x, qty: Math.max(1, Math.min(x.max || 99, qty)) } : x))),
      remove: (c, p) => save(items.filter((x) => !same(x, c, p))),
      clear: () => save([]),
      count: items.reduce((a, x) => a + x.qty, 0),
      total: items.reduce((a, x) => a + x.qty * x.price, 0),
    };
  }, [items, ready, save]);
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("CartProvider missing");
  return c;
}

export const money = (n: number) => `NT$ ${n.toLocaleString("en-US")}`;

function BagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 8h14l-1.2 12H6.2L5 8z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

export function CartButton() {
  const { count, ready } = useCart();
  return (
    <Link href="/shop/cart" aria-label={`購物車，${count} 件`} className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-shop-ink text-white">
      <BagIcon />
      {ready && count > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-shop-rose px-1 text-[11px] font-bold">{count}</span>
      )}
    </Link>
  );
}

/** 底部固定的「已選幾件、多少錢、前往結帳」 */
export function CartBar() {
  const { count, total, ready } = useCart();
  if (!ready || count === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-between gap-3 rounded-[26px] bg-shop-ink py-2 pr-2 pl-5 text-white shadow-[0_10px_24px_rgba(59,47,42,0.3)]">
        <div>
          <div className="text-[12px] opacity-80">購物車 {count} 件</div>
          <div className="text-[18px] font-bold">{money(total)}</div>
        </div>
        <Link href="/shop/cart" className="flex h-12 items-center rounded-full bg-shop-rose px-5 text-[15px] font-bold text-white">前往結帳 →</Link>
      </div>
    </div>
  );
}

/** 數量：可以按 ＋／－，也可以點數字直接輸入 */
export function Stepper({ value, max, onChange, label, size = "md" }: { value: number; max: number; onChange: (n: number) => void; label: string; size?: "md" | "sm" }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.max(0, Math.min(max, Number.isFinite(n) ? Math.floor(n) : 0));
  const btn = size === "sm" ? "h-8 w-8 text-[17px]" : "h-9 w-9 text-[18px]";
  const atMax = value >= max;
  return (
    <div className={`flex items-center rounded-full bg-shop-sand px-1 ${size === "sm" ? "h-10 w-[116px]" : "h-11 w-[128px]"}`}>
      <button type="button" aria-label={`${label}減一`} disabled={value <= 0} onClick={() => onChange(clamp(value - 1))} className={`${btn} rounded-full bg-white text-shop-ink disabled:opacity-40`}>−</button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={`${label}數量`}
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = clamp(Number(text));
          setText(String(n));
          onChange(n);
        }}
        className="w-0 min-w-0 flex-1 appearance-none bg-transparent text-center text-[17px] font-bold text-shop-ink outline-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" aria-label={`${label}加一`} disabled={atMax} onClick={() => onChange(clamp(value + 1))} className={`${btn} rounded-full ${atMax ? "bg-[#ece5dd] text-[#b8aca2]" : "bg-white text-shop-ink"}`}>+</button>
    </div>
  );
}

/** 開賣倒數（天／時／分）；時間到自動重新整理 */
export function Countdown({ at, compact }: { at: string; compact?: boolean }) {
  const target = new Date(at).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= target) {
        clearInterval(id);
        location.reload();
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [target]);
  if (now === null) return null;
  const ms = Math.max(0, target - now);
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const parts: [string, string][] = [
    [String(d).padStart(2, "0"), "天"],
    [String(h).padStart(2, "0"), "時"],
    [String(m).padStart(2, "0"), "分"],
  ];
  if (compact)
    return (
      <span className="flex items-center gap-1.5">
        {parts.map(([v, u]) => (
          <span key={u} className="rounded-lg bg-shop-ink px-2 py-1 text-[15px] font-bold text-white">{v} {u}</span>
        ))}
      </span>
    );
  return (
    <span className="flex gap-2">
      {parts.map(([v, u]) => (
        <span key={u} className="w-[52px] rounded-[10px] bg-shop-ink py-1.5 text-center text-white">
          <span className="block text-[20px] leading-tight font-bold">{v}</span>
          <span className="block text-[10px] opacity-80">{u}</span>
        </span>
      ))}
    </span>
  );
}

/** 商品圖片：沒有圖或載入失敗時顯示柔和色塊 */
const TINTS = ["#f6e3e4", "#e2ecf5", "#f5ecd6", "#e6f2e7", "#efe6dc"];
export function Pic({ src, alt, seed = 0, className = "", label = "" }: { src: string | null; alt: string; seed?: number; className?: string; label?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <div role="img" aria-label={alt} className={`flex items-center justify-center text-[12px] text-shop-mute ${className}`} style={{ background: TINTS[Math.abs(seed) % TINTS.length] }}>
        {label}
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}
