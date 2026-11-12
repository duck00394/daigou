// 訂購頁共用的畫面元件（伺服器端）
import Link from "next/link";
import type { ShopProduct } from "@/server/services/shop";
import type { ShopCustomer } from "@/server/shop-auth";
import { CartButton, Pic } from "./cart";

export type TypeGroup = { typeId: string; typeName: string; image: string | null; price: number | null; chars: string[]; left: number; total: number; waiting: number; products: ShopProduct[] };

/** 同一個品項的角色放在一起（一張卡片＝一個品項） */
export function groupTypes(products: ShopProduct[]): TypeGroup[] {
  const m = new Map<string, TypeGroup>();
  for (const p of products) {
    const g = m.get(p.typeId) ?? { typeId: p.typeId, typeName: p.typeName, image: null, price: null, chars: [], left: 0, total: 0, waiting: 0, products: [] };
    g.products.push(p);
    if (p.typeImage) g.image = p.typeImage;
    else if (!g.image && p.imageUrl) g.image = p.imageUrl;
    if (p.price !== null) g.price = g.price === null ? p.price : Math.min(g.price, p.price);
    if (p.character) g.chars.push(p.character);
    g.left += p.left;
    g.total += p.quota;
    g.waiting += p.waiting;
    m.set(p.typeId, g);
  }
  return [...m.values()];
}

export function SerifTitle({ children, size = 24 }: { children: React.ReactNode; size?: number }) {
  return <h2 className="font-serif font-bold leading-snug" style={{ fontSize: size }}>{children}</h2>;
}

export function LoginPill({ customer, next }: { customer: ShopCustomer | null; next: string }) {
  if (customer)
    return (
      <Link href="/shop/orders" className="flex h-10 items-center gap-1.5 rounded-full border border-tone-green-200 bg-tone-green-100-2 pr-3 pl-1 text-[13px] font-medium text-shop-good">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {customer.picture ? <img src={customer.picture} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" /> : <span className="rounded-full bg-tone-green-800 px-1.5 py-0.5 text-[10px] font-bold text-white">LINE</span>}
        <span className="max-w-[5.5em] truncate">{customer.name}</span>
      </Link>
    );
  return (
    <a href={`/shop/login?next=${encodeURIComponent(next)}`} className="flex h-10 items-center gap-1.5 rounded-full bg-tone-green-800 px-3 text-[13px] font-bold text-white">
      <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-tone-green-800">LINE</span>登入
    </a>
  );
}

export function ShopHeader({ name, customer, next }: { name: string; customer: ShopCustomer | null; next: string }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-shop-line bg-white px-4 py-3">
      <Link href="/shop" className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-shop-rose font-serif text-[19px] font-bold text-white">{[...name][0]}</span>
        <span className="truncate font-serif text-[18px] font-bold">{name}</span>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <LoginPill customer={customer} next={next} />
        <CartButton />
      </div>
    </header>
  );
}

export function BackCircle({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} className="flex h-11 w-11 items-center justify-center rounded-full border border-shop-line bg-white/95">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </Link>
  );
}

export function Tag({ children, tone = "rose" }: { children: React.ReactNode; tone?: "rose" | "good" | "plain" }) {
  const cls = tone === "good" ? "bg-shop-good-soft text-shop-good" : tone === "plain" ? "bg-tone-orange-100 text-shop-ink-2" : "bg-shop-rose-soft text-shop-rose-2";
  return <span className={`inline-block rounded-[10px] px-2.5 py-1 text-[12px] font-bold ${cls}`}>{children}</span>;
}

export function TypeCard({ g, href, seed }: { g: TypeGroup; href: string; seed: number }) {
  const soldOut = g.left === 0;
  const single = g.products.length === 1;
  return (
    <Link href={href} className="flex flex-col overflow-hidden rounded-[18px] border border-shop-line bg-white shadow-lift-9">
      <div className="relative">
        <Pic src={g.image} alt={g.typeName} seed={seed} className="h-40 w-full" label="商品圖片" fit="contain" />
        {soldOut ? (
          <span className="absolute inset-0 flex items-center justify-center bg-white/40"><span className="rounded-[14px] bg-shop-ink/80 px-3.5 py-1.5 text-[14px] font-bold text-white">全部售完</span></span>
        ) : (
          g.left <= 3 && <span className="absolute top-2.5 left-2.5 rounded-[10px] bg-white px-2 py-1 text-[11px] font-bold text-shop-rose-2">剩 {g.left} 個</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="text-[15px] leading-snug font-bold">{g.typeName}</div>
        <div className="line-clamp-1 text-[12px] text-shop-mute">{single ? (g.chars[0] ?? "單一款式") : `${g.chars.slice(0, 3).join("、")}${g.chars.length > 3 ? "…" : ""}　${g.products.length} 款`}</div>
        <div className={`mt-auto text-[18px] font-bold ${soldOut ? "text-shop-mute" : "text-shop-rose"}`}>{g.price === null ? "價格待定" : `NT$ ${g.price.toLocaleString("en-US")}`}</div>
        <span className={`flex h-10 items-center justify-center rounded-full text-[13px] font-bold ${soldOut ? "bg-shop-rose-soft text-shop-rose-2" : single ? "border border-tone-orange-300-3" : "bg-shop-rose text-white"}`}>
          {soldOut ? "排候補" : single ? "查看商品" : "選角色"}
        </span>
      </div>
    </Link>
  );
}

export function Notice({ children, tone = "warn" }: { children: React.ReactNode; tone?: "warn" | "good" }) {
  return <div className={`rounded-[14px] border px-3.5 py-3 text-[14px] ${tone === "good" ? "border-tone-green-200 bg-tone-green-100-2 text-shop-good" : "border-tone-orange-300-5 bg-tone-amber-100 text-shop-gold"}`}>{children}</div>;
}
