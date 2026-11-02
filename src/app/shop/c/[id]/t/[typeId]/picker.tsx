"use client";
// 品項頁：每個角色一列，各自選數量，最後按一次「加入購物車」全部放進去
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { money, Stepper, useCart } from "../../../../cart";
import { joinWaitAction } from "../../../../actions";

type Row = { productId: string; name: string; label: string; image: string | null; price: number | null; left: number; waiting: number; mine: number; inWait: boolean; seed: number };

export function Picker({ categoryId, catName, open, loggedIn, loginHref, limit, rows }: { categoryId: string; catName: string; open: boolean; loggedIn: boolean; loginHref: string; limit: number | null; rows: Row[] }) {
  const cart = useCart();
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(() => (rows.length === 1 && rows[0].left > 0 ? { [rows[0].productId]: 1 } : {}));
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();
  const inCart = (pid: string) => cart.items.find((x) => x.categoryId === categoryId && x.productId === pid)?.qty ?? 0;
  // 最多能選幾個：剩下的名額、每人限購（扣掉已經訂的和購物車裡的）
  const maxOf = (r: Row) => Math.max(0, Math.min(r.left, limit ? limit - r.mine : 99) - inCart(r.productId));
  const picked = rows.filter((r) => (qty[r.productId] ?? 0) > 0 && r.price !== null);
  const count = picked.reduce((a, r) => a + qty[r.productId], 0);
  const total = picked.reduce((a, r) => a + qty[r.productId] * (r.price ?? 0), 0);
  const summary = useMemo(() => (count ? picked.map((r) => `${r.label}×${qty[r.productId]}`).join("、") : "還沒選角色"), [count, picked, qty]);
  const available = rows.filter((r) => r.left > 0 && r.price !== null);

  const addAll = () => {
    if (!count) return;
    cart.add(picked.map((r) => ({ categoryId, productId: r.productId, qty: qty[r.productId], name: r.name, price: r.price!, image: r.image, catName, max: Math.min(r.left, limit ? limit - r.mine : 99) })));
    setMsg({ text: `已加入購物車：${summary}`, ok: true });
    setQty({});
  };
  const wait = (r: Row) => {
    if (!loggedIn) {
      location.href = loginHref;
      return;
    }
    start(async () => {
      const res = await joinWaitAction(categoryId, r.productId, 1);
      if (res.ok) {
        setMsg({ text: `${r.label} 已排候補，目前第 ${res.data.position} 順位。遞補成功會自動成立訂單並用 LINE 通知你。`, ok: true });
        router.refresh();
      } else if (res.login) location.href = loginHref;
      else setMsg({ text: res.error, ok: false });
    });
  };

  return (
    <>
      <div className="overflow-hidden rounded-[20px] border border-shop-line bg-white shadow-[0_6px_18px_rgba(120,70,60,0.08)]">
        <div className="flex items-center justify-between border-b border-[#f1e9e0] px-4 py-3.5">
          <div className="text-[16px] font-bold">{rows.length > 1 ? "選擇角色與數量" : "選擇數量"}</div>
          {available.length > 1 && (
            <button
              type="button"
              onClick={() => setQty(Object.fromEntries(available.filter((r) => maxOf(r) > 0).map((r) => [r.productId, 1])))}
              className="h-9 rounded-full border border-[#ddd0c3] bg-white px-3 text-[13px] font-bold"
            >
              每款各 1 個
            </button>
          )}
        </div>
        <ul>
          {rows.map((r) => {
            const sold = r.left <= 0;
            const max = maxOf(r);
            const ic = inCart(r.productId);
            const note = r.price === null ? "價格待定" : sold ? `已售完${r.waiting ? `・${r.waiting} 人候補` : ""}` : `剩 ${r.left} 個${ic ? `・購物車已有 ${ic}` : ""}${r.mine ? `・你已訂 ${r.mine}` : ""}`;
            return (
              <li key={r.productId} className="flex items-center gap-3 border-b border-[#f1e9e0] px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-bold">{r.label}</div>
                  <div className={`text-[12px] ${sold ? "text-shop-rose-2" : "text-shop-mute"}`}>{note}</div>
                </div>
                {sold ? (
                  r.inWait ? (
                    <span className="flex h-11 w-[128px] items-center justify-center rounded-full bg-shop-rose text-[14px] font-bold text-white">已排候補</span>
                  ) : open ? (
                    <button type="button" disabled={pending} onClick={() => wait(r)} className="h-11 w-[128px] rounded-full border-[1.5px] border-shop-rose bg-white text-[14px] font-bold text-shop-rose-2 disabled:opacity-50">排候補</button>
                  ) : null
                ) : r.price === null ? null : max === 0 ? (
                  <span className="w-[128px] text-center text-[12px] text-shop-mute">{limit && r.mine + ic >= limit ? "已達限購" : "已全部放進購物車"}</span>
                ) : (
                  <Stepper label={r.label} value={qty[r.productId] ?? 0} max={max} onChange={(n) => setQty((q) => ({ ...q, [r.productId]: n }))} />
                )}
              </li>
            );
          })}
        </ul>
        <p className="px-4 py-3 text-[12px] leading-relaxed text-shop-mute">可以按 ＋／－，也可以點數字直接輸入。{open ? "售完的可以排候補，有人取消會依序遞補並用 LINE 通知。" : "開賣後售完的可以排候補。"}</p>
      </div>

      {msg && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(12px,env(safe-area-inset-bottom))+72px)] z-30 px-3">
          <div role="status" className={`pointer-events-auto mx-auto flex max-w-md items-center justify-between gap-3 rounded-[14px] border px-3.5 py-3 text-[14px] font-bold shadow-[0_6px_18px_rgba(59,47,42,0.15)] ${msg.ok ? "border-[#cfe9d4] bg-[#eaf6ec] text-shop-good" : "border-[#f1c9cc] bg-[#fdf0f1] text-shop-rose-2"}`}>
            <span>{msg.text}</span>
            <span className="flex shrink-0 items-center gap-3">
              {msg.ok && cart.count > 0 && <Link href="/shop/cart" className="underline">去結帳</Link>}
              <button type="button" aria-label="關閉" onClick={() => setMsg(null)} className="text-[18px] leading-none">×</button>
            </span>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-between gap-3 rounded-[26px] bg-shop-ink py-2 pr-2 pl-5 text-white shadow-[0_10px_24px_rgba(59,47,42,0.3)]">
          <div className="min-w-0">
            <div className="truncate text-[12px] opacity-85">{summary}</div>
            <div className="text-[18px] font-bold">{count ? `共 ${count} 件・${money(total)}` : cart.count ? `購物車 ${cart.count} 件` : "NT$ 0"}</div>
          </div>
          {count ? (
            <button type="button" onClick={addAll} className="h-12 shrink-0 rounded-full bg-shop-rose px-[18px] text-[15px] font-bold text-white">加入購物車</button>
          ) : cart.count ? (
            <Link href="/shop/cart" className="flex h-12 shrink-0 items-center rounded-full bg-shop-rose px-[18px] text-[15px] font-bold text-white">前往結帳 →</Link>
          ) : (
            <span className="flex h-12 shrink-0 items-center rounded-full bg-[#8a7a70] px-[18px] text-[15px] font-bold text-white">請先選數量</span>
          )}
        </div>
      </div>
    </>
  );
}
