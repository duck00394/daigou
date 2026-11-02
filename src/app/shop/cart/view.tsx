"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { money, Pic, Stepper, useCart, type CartItem } from "../cart";
import { placeOrderAction } from "../actions";
import type { ContactField } from "@/server/services/shop";

type Status = Record<string, { open: boolean; openAt: string | null; name: string }>;
const fieldCls = "h-[46px] w-full rounded-[14px] border border-[#e6dace] bg-[#fdfaf6] px-3.5 text-[16px] text-shop-ink";

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CartView({ loggedIn, defaults, returning, shippingOptions, status, field }: { field: ContactField; loggedIn: boolean; defaults: { name: string; phone: string; shipping: string }; returning: boolean; shippingOptions: string[]; status: Status }) {
  const cart = useCart();
  const router = useRouter();
  const [f, setF] = useState({ ...defaults, note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(newKey);
  const [pending, start] = useTransition();

  if (!cart.ready) return <div className="p-8 text-center text-shop-mute">載入中…</div>;
  if (cart.items.length === 0)
    return (
      <div className="mx-4 mt-6 flex flex-col items-center gap-4 rounded-[20px] border border-shop-line bg-white p-8 text-center">
        <div className="text-[16px] font-bold">購物車是空的</div>
        <Link href="/shop" className="flex h-11 items-center rounded-full bg-shop-rose px-5 text-[15px] font-bold text-white">去逛逛</Link>
      </div>
    );

  const groups = new Map<string, CartItem[]>();
  for (const it of cart.items) groups.set(it.categoryId, [...(groups.get(it.categoryId) ?? []), it]);
  const gone = cart.items.filter((it) => !status[it.categoryId]);
  const notOpen = [...groups.keys()].filter((c) => status[c] && !status[c].open);

  const submit = () => {
    setErr(null);
    if (gone.length) return setErr("有商品的系列已經停止訂購，請先刪掉");
    if (notOpen.length) return setErr(`「${status[notOpen[0]].name}」還沒開賣，時間到才能送出`);
    start(async () => {
      const res = await placeOrderAction(
        cart.items.map((i) => ({ categoryId: i.categoryId, productId: i.productId, qty: i.qty })),
        { name: f.name, phone: f.phone, shipping: f.shipping, note: f.note || null },
        key,
      );
      if (res.ok) {
        cart.clear();
        router.push(`/shop/done?no=${encodeURIComponent(res.data.orderNo)}`);
      } else if (res.login) {
        location.href = `/shop/login?next=${encodeURIComponent("/shop/cart")}`;
      } else {
        setErr(res.error);
        setKey(newKey());
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      {[...groups.entries()].map(([cid, list]) => {
        const st = status[cid];
        return (
          <div key={cid} className="overflow-hidden rounded-[20px] border border-shop-line bg-white shadow-[0_6px_18px_rgba(120,70,60,0.08)]">
            <div className="flex items-center justify-between border-b border-[#f3e1e1] bg-[#fdf1f1] px-4 py-3.5">
              <span className="font-serif text-[17px] font-bold">{list[0].catName}</span>
              <span className="text-[12px] font-bold text-shop-rose-2">{!st ? "已停止訂購" : st.open ? "販售中" : "還沒開賣"}</span>
            </div>
            {list.map((it, i) => (
              <div key={it.productId} className="flex gap-3 border-b border-[#f1e9e0] px-4 py-3.5 last:border-b-0">
                <Pic src={it.image} alt={it.name} seed={i} className="h-16 w-16 shrink-0 rounded-[14px]" label="" />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex justify-between gap-2">
                    <div>
                      <div className="text-[15px] font-bold">{it.name}</div>
                      <div className="text-[12px] text-shop-mute">{money(it.price)}</div>
                    </div>
                    <button type="button" aria-label={`刪除${it.name}`} onClick={() => cart.remove(it.categoryId, it.productId)} className="h-8 w-8 text-[18px] text-shop-mute">×</button>
                  </div>
                  <div className="flex items-center justify-between">
                    <Stepper size="sm" label={it.name} value={it.qty} max={it.max || 99} onChange={(n) => (n <= 0 ? cart.remove(it.categoryId, it.productId) : cart.setQty(it.categoryId, it.productId, n))} />
                    <span className="text-[16px] font-bold">{money(it.qty * it.price)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {loggedIn ? (
        <div className="flex flex-col gap-3 rounded-[20px] border border-shop-line bg-white p-4 shadow-[0_6px_18px_rgba(120,70,60,0.08)]">
          <div className="flex items-baseline justify-between">
            <span className="text-[16px] font-bold">聯絡資料</span>
            <span className="text-[12px] text-shop-mute">{returning ? "已從上次訂單帶入" : "第一次填，之後自動帶入"}</span>
          </div>
          <label className="flex flex-col gap-1.5 text-[13px] text-shop-mute">社群暱稱
            <input className={fieldCls} value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="nickname" />
          </label>
          {field.mode === "phone" && (
            <label className="flex flex-col gap-1.5 text-[13px] text-shop-mute">手機
              <input className={fieldCls} type="tel" value={f.phone} maxLength={20} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" placeholder="0912-345-678" />
            </label>
          )}
          {field.mode === "text" && (
            <label className="flex flex-col gap-1.5 text-[13px] text-shop-mute">{field.label}
              <input className={fieldCls} value={f.phone} maxLength={60} onChange={(e) => setF({ ...f, phone: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-[13px] text-shop-mute">取貨方式
            <select className={fieldCls} value={f.shipping} onChange={(e) => setF({ ...f, shipping: e.target.value })}>
              {shippingOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-shop-mute">備註（選填）
            <input className={fieldCls} value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="例如：和上一單一起寄" />
          </label>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-[20px] border border-shop-line bg-white p-5 text-center">
          <div className="text-[15px] font-bold">用 LINE 登入才能送出訂單</div>
          <p className="text-[13px] text-shop-mute">登入後訂單明細、取消、出貨都會傳到 LINE 聊天室</p>
          <a href={`/shop/login?next=${encodeURIComponent("/shop/cart")}`} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#078a3e] text-[16px] font-bold text-white">
            <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#078a3e]">LINE</span>用 LINE 登入
          </a>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-[20px] border border-shop-line bg-white p-4 text-[14px]">
        <div className="flex justify-between"><span className="text-shop-mute">商品小計（{cart.count} 件）</span><span>{money(cart.total)}</span></div>
        <div className="flex justify-between"><span className="text-shop-mute">運費</span><span>到貨後通知</span></div>
        <div className="mt-0.5 flex justify-between border-t border-dashed border-[#e6dace] pt-2.5"><span className="font-bold">合計</span><span className="text-[20px] font-bold text-shop-rose">{money(cart.total)}</span></div>
      </div>

      {err && <div role="alert" className="rounded-[14px] border border-[#f1c9cc] bg-[#fdf0f1] px-3.5 py-3 text-[14px] font-bold text-shop-rose-2">{err}</div>}

      {loggedIn && (
        <div className="flex flex-col gap-2 pt-1">
          <button type="button" disabled={pending} onClick={submit} className="flex h-14 items-center justify-center gap-2.5 rounded-full bg-[#078a3e] text-[17px] font-bold text-white shadow-[0_10px_24px_rgba(7,138,62,0.3)] disabled:opacity-60">
            <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#078a3e]">LINE</span>
            {pending ? "送出中…" : "送出訂單並回到 LINE"}
          </button>
          <p className="text-center text-[12px] text-shop-mute">{notOpen.length ? "開賣時間到才能送出" : "訂單明細會傳到 LINE 聊天室"}</p>
        </div>
      )}
    </div>
  );
}
