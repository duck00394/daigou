"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { money, Pic, Stepper, useCart, type CartItem } from "../cart";
import { placeOrderAction } from "../actions";
import type { ContactField } from "@/server/services/shop";

type Status = Record<string, { open: boolean; openAt: string | null; name: string; pay: { timing: "ORDER" | "ARRIVAL"; hours: number } | null }>;
export const DONE_KEY = "dg_done";
const fieldCls = "h-[46px] w-full rounded-[14px] border border-tone-orange-200 bg-tone-sand-50 px-3.5 text-[16px] text-shop-ink";

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CartView({ loggedIn, lineName, deposits, defaults, returning, shippingOptions, status, field }: { field: ContactField; loggedIn: boolean; lineName: string | null; deposits: Record<string, number>; defaults: { name: string; phone: string; shipping: string }; returning: boolean; shippingOptions: string[]; status: Status }) {
  const cart = useCart();
  const router = useRouter();
  const [f, setF] = useState({ ...defaults, note: "", email: "", social: "" });
  const [mode, setMode] = useState<"guest" | "line">(loggedIn ? "line" : "guest");
  const [agree, setAgree] = useState(false);
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

  const guest = !loggedIn && mode === "guest";
  const canSubmit = loggedIn || guest;
  // 付款方式提醒：同樣設定的系列合在一起講
  // 系列裡有要訂金的角色在購物車：這個系列整張走訂金流程
  const catDeposit = (c: string) => (groups.get(c) ?? []).reduce((x, it) => x + (deposits[`${c}|${it.productId}`] ?? 0) * it.qty, 0);
  const payKey = (c: string) => (catDeposit(c) > 0 ? "DEPOSIT|1" : `${status[c].pay!.timing}|${status[c].pay!.hours}`);
  const payNotes = [...new Set([...groups.keys()].filter((c) => status[c]?.pay).map(payKey))].map((k) => {
    const [timing, hours] = k.split("|");
    const cats = [...groups.keys()].filter((c) => status[c]?.pay && payKey(c) === k);
    const deposit = cats.reduce((a, c) => a + catDeposit(c), 0);
    return { timing, hours: Number(hours), names: cats.map((c) => status[c].name), deposit };
  });
  const hasDeposit = payNotes.some((p) => p.timing === "DEPOSIT");
  // 訪客下單、要付訂金的商品都要留 Threads 或 IG 帳號；結帳欄位本身就是帳號時不用再多一格
  const needSocial = (guest || hasDeposit) && field.mode !== "text";

  const submit = () => {
    setErr(null);
    if (gone.length) return setErr("有商品的系列已經停止訂購，請先刪掉");
    if (notOpen.length) return setErr(`「${status[notOpen[0]].name}」還沒開賣，時間到才能送出`);
    if (guest && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return setErr("請填正確的 Email（收訂單通知和查詢碼用）");
    if (needSocial && !f.social.trim()) return setErr(hasDeposit ? "要付訂金的商品，請填 Threads 或 IG 帳號" : "請填 Threads 或 IG 帳號");
    if ((guest || hasDeposit) && field.mode === "text" && !f.phone.trim()) return setErr(`請填${field.label}`);
    if (!agree) return setErr("請先勾選已閱讀交易規則與隱私權政策");
    start(async () => {
      const res = await placeOrderAction(
        cart.items.map((i) => ({ categoryId: i.categoryId, productId: i.productId, qty: i.qty })),
        { name: f.name, phone: f.phone, shipping: f.shipping, note: f.note || null, social: needSocial ? f.social.trim() : null },
        key,
        { guestEmail: guest ? f.email.trim() : null, agree },
      );
      if (res.ok) {
        try {
          sessionStorage.setItem(DONE_KEY, JSON.stringify({ code: res.data.code, ids: res.data.orders.map((o) => o.orderId) }));
        } catch {}
        cart.clear();
        router.push(`/shop/done?o=${res.data.orders.map((o, i) => `${o.orderId}.${res.data.tokens[i]}`).join(",")}`);
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
          <div key={cid} className="overflow-hidden rounded-[20px] border border-shop-line bg-white shadow-lift-1">
            <div className="flex items-center justify-between border-b border-tone-red-200-2 bg-tone-red-50-2 px-4 py-3.5">
              <span className="font-serif text-[17px] font-bold">{list[0].catName}</span>
              <span className="text-[12px] font-bold text-shop-rose-2">{!st ? "已停止訂購" : st.open ? "販售中" : "還沒開賣"}</span>
            </div>
            {list.map((it, i) => (
              <div key={it.productId} className="flex gap-3 border-b border-tone-orange-200-3 px-4 py-3.5 last:border-b-0">
                <Pic src={it.image} alt={it.name} seed={i} className="h-16 w-16 shrink-0 rounded-[14px]" label="" />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex justify-between gap-2">
                    <div>
                      <div className="text-[15px] font-bold">{it.name}</div>
                      <div className="text-[12px] text-shop-mute">
                        {money(it.price)}
                        {deposits[`${it.categoryId}|${it.productId}`] ? <span className="ml-1.5 rounded-full bg-shop-gold-soft px-1.5 py-0.5 text-[11px] font-bold text-shop-gold">訂金 {deposits[`${it.categoryId}|${it.productId}`]}</span> : null}
                      </div>
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

      {!loggedIn && (
        <div role="radiogroup" aria-label="下單方式" className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-tone-orange-300-4 bg-white text-[14px]">
          {(["guest", "line"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`h-11 font-bold ${mode === m ? "bg-shop-ink text-white" : "text-shop-ink-2"}`}>
              {m === "guest" ? "訪客下單" : "LINE 登入下單"}
            </button>
          ))}
        </div>
      )}

      {canSubmit ? (
        <div className="flex flex-col gap-3 rounded-[20px] border border-shop-line bg-white p-4 shadow-lift-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[16px] font-bold">聯絡資料</span>
            <span className="text-[12px] text-shop-mute">{guest ? "不用註冊，填好就能下單" : returning ? "已從上次訂單帶入" : "第一次填，之後自動帶入"}</span>
          </div>
          {loggedIn && lineName && <div className="text-[13px] text-shop-mute">已用 LINE 登入：{lineName}</div>}
          <label className="flex flex-col gap-1.5 text-[13px] text-shop-mute">社群暱稱
            <input className={fieldCls} value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="nickname" />
          </label>
          {guest && (
            <label className="flex flex-col gap-1.5 text-[13px] text-shop-mute">Email（收訂單通知和查詢碼）
              <input className={fieldCls} type="email" inputMode="email" value={f.email} maxLength={254} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@example.com" />
            </label>
          )}
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
          {needSocial && (
            <label className="flex flex-col gap-1.5 text-[13px] text-shop-mute">Threads 或 IG 帳號（聯絡用）
              <input className={fieldCls} value={f.social} maxLength={60} onChange={(e) => setF({ ...f, social: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="@your_id" />
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
          <div className="text-[15px] font-bold">用 LINE 登入下單</div>
          <p className="text-[13px] text-shop-mute">登入後訂單明細、付款提醒、出貨都會傳到 LINE 聊天室；不想登入可以選「訪客下單」</p>
          <a href={`/shop/login?next=${encodeURIComponent("/shop/cart")}`} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-tone-green-800 text-[16px] font-bold text-white">
            <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-tone-green-800">LINE</span>用 LINE 登入
          </a>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-[20px] border border-shop-line bg-white p-4 text-[14px]">
        <div className="flex justify-between"><span className="text-shop-mute">商品小計（{cart.count} 件）</span><span>{money(cart.total)}</span></div>
        <div className="flex justify-between"><span className="text-shop-mute">運費</span><span>到貨後通知</span></div>
        <div className="mt-0.5 flex justify-between border-t border-dashed border-tone-orange-200 pt-2.5"><span className="font-bold">合計</span><span className="text-[20px] font-bold text-shop-rose">{money(cart.total)}</span></div>
      </div>

      {canSubmit && (
        <div className="flex flex-col gap-2.5 rounded-[20px] border border-tone-amber-300 bg-shop-gold-soft p-4 text-[14px] leading-relaxed text-shop-gold">
          {payNotes.map((p) => (
            <p key={`${p.timing}${p.hours}`}>
              {payNotes.length > 1 && <b>{p.names.join("、")}：</b>}
              {p.timing === "DEPOSIT" ? (
                <>有要訂金的商品，訂金 <b>NT$ {p.deposit.toLocaleString("en-US")}</b>：成立後 <b className="text-tone-red-600-2">1 小時</b>內匯款並回傳末五碼，逾時自動取消。確認後會傳賣貨便連結，整張訂單一起在賣貨便下單，尾款取貨時付。</>
              ) : p.timing === "ORDER" ? (
                <>成立後 <b className="text-tone-red-600-2">{p.hours} 小時</b>內，用賣貨便下單。逾期會取消並讓給候補的人。</>
              ) : (
                <>到貨後會通知你，收到通知 <b className="text-tone-red-600-2">{p.hours} 小時</b>內用賣貨便下單。逾期會取消並讓給候補的人。</>
              )}
            </p>
          ))}
          <label className="flex items-start gap-2.5 text-shop-ink">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-shop-rose" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>我已閱讀<a href="/shop/rules" target="_blank" className="mx-0.5 font-bold text-shop-rose-2 underline">交易規則</a>與<a href="/shop/privacy" target="_blank" className="mx-0.5 font-bold text-shop-rose-2 underline">隱私權政策</a></span>
          </label>
        </div>
      )}

      {err && <div role="alert" className="rounded-[14px] border border-tone-red-200 bg-tone-red-50 px-3.5 py-3 text-[14px] font-bold text-shop-rose-2">{err}</div>}

      {guest && (
        <div className="flex flex-col gap-2 pt-1">
          <button type="button" disabled={pending} onClick={submit} className="flex h-14 items-center justify-center rounded-full bg-tone-gray-900 text-[17px] font-bold text-white shadow-lift-5 disabled:opacity-60">
            {pending ? "送出中…" : `送出訂單　${money(cart.total)}`}
          </button>
          <p className="text-center text-[12px] text-shop-mute">{notOpen.length ? "開賣時間到才能送出" : "送出後會顯示訂單編號和查詢碼，也會寄到你的 Email"}</p>
        </div>
      )}

      {loggedIn && (
        <div className="flex flex-col gap-2 pt-1">
          <button type="button" disabled={pending} onClick={submit} className="flex h-14 items-center justify-center gap-2.5 rounded-full bg-tone-green-800 text-[17px] font-bold text-white shadow-lift-6 disabled:opacity-60">
            <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-tone-green-800">LINE</span>
            {pending ? "送出中…" : "送出訂單並回到 LINE"}
          </button>
          <p className="text-center text-[12px] text-shop-mute">{notOpen.length ? "開賣時間到才能送出" : "訂單明細會傳到 LINE 聊天室"}</p>
        </div>
      )}
    </div>
  );
}
