import Link from "next/link";
import { prisma } from "@/server/db";
import { currentCustomer } from "@/server/shop-auth";
import { customerOrders, customerWaits, type CustomerOrder } from "@/server/services/shop";
import { taipeiParts } from "@/lib/taipei";
import { Pic } from "../cart";
import { BackCircle, Eyebrow, SerifTitle } from "../ui";
import { CancelWait, OrderFilter } from "./parts";

export const metadata = { title: "我的訂單" };

const STEPS = ["已成立", "採購中", "已到貨", "已出貨"];
const STAGE: Record<CustomerOrder["stage"], { label: string; step: number; cls: string }> = {
  PLACED: { label: "已成立", step: 0, cls: "bg-shop-rose text-white" },
  BUYING: { label: "採購中", step: 1, cls: "bg-shop-rose text-white" },
  ARRIVED: { label: "已到貨", step: 2, cls: "bg-shop-gold-soft text-shop-gold" },
  SHIPPED: { label: "已出貨", step: 3, cls: "bg-shop-good-soft text-shop-good" },
  DONE: { label: "已完成", step: 3, cls: "bg-shop-good-soft text-shop-good" },
  CANCELLED: { label: "已取消", step: -1, cls: "bg-[#ece5dd] text-shop-ink-2" },
};

export default async function MyOrders({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show = "open" } = await searchParams;
  const customer = await currentCustomer();
  if (!customer)
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <SerifTitle>我的訂單</SerifTitle>
        <p className="text-[14px] text-shop-mute">用 LINE 登入就能看到你的訂單</p>
        <a href="/shop/login?next=/shop/orders" className="flex h-12 items-center gap-2 rounded-full bg-[#078a3e] px-6 text-[16px] font-bold text-white">
          <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#078a3e]">LINE</span>用 LINE 登入
        </a>
        <Link href="/shop" className="text-[14px] text-shop-rose-2 underline">回商店</Link>
      </div>
    );
  const [orders, waits] = await Promise.all([customerOrders(prisma, customer.id), customerWaits(prisma, customer.id)]);
  const groups = {
    open: orders.filter((o) => ["PLACED", "BUYING", "ARRIVED", "SHIPPED"].includes(o.stage)),
    done: orders.filter((o) => o.stage === "DONE"),
    cancelled: orders.filter((o) => o.stage === "CANCELLED"),
  };
  const list = show === "wait" ? [] : (groups[show as keyof typeof groups] ?? groups.open);

  return (
    <>
      <header className="flex items-center gap-3 px-4 py-3">
        <BackCircle href="/shop" label="回商店" />
        <div className="flex-1">
          <Eyebrow>MY ORDERS</Eyebrow>
          <SerifTitle size={22}>我的訂單</SerifTitle>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {customer.picture && <img src={customer.picture} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" />}
      </header>
      <div className="flex flex-col gap-4 px-4 pt-2">
        <OrderFilter value={show} counts={{ open: groups.open.length, wait: waits.length, done: groups.done.length, cancelled: groups.cancelled.length }} />

        {show === "wait" ? (
          waits.length === 0 ? (
            <p className="rounded-[18px] border border-shop-line bg-white p-5 text-center text-[14px] text-shop-mute">沒有候補中的商品</p>
          ) : (
            waits.map((w, i) => (
              <div key={w.id} className="flex flex-col gap-2.5 rounded-[20px] border-[1.5px] border-dashed border-[#d9c8b8] bg-white p-4">
                <div className="flex items-center justify-between">
                  <Eyebrow>WAITING LIST</Eyebrow>
                  <span className="rounded-[14px] bg-shop-rose-soft px-3 py-1 text-[13px] font-bold text-shop-rose-2">第 {w.position} 順位</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Pic src={w.image} alt={w.name} seed={i} className="h-11 w-11 shrink-0 rounded-xl" label="" />
                  <div className="flex-1 text-[15px] font-bold">{w.name} × {w.qty}</div>
                </div>
                <div className="flex items-center justify-between gap-2.5">
                  <span className="text-[12px] leading-relaxed text-shop-mute">遞補成功會自動成立訂單，並用 LINE 通知你</span>
                  <CancelWait id={w.id} />
                </div>
              </div>
            ))
          )
        ) : list.length === 0 ? (
          <p className="rounded-[18px] border border-shop-line bg-white p-5 text-center text-[14px] text-shop-mute">沒有訂單</p>
        ) : (
          list.map((o) => {
            const st = STAGE[o.stage];
            const at = taipeiParts(o.at);
            return (
              <div key={o.id} className="overflow-hidden rounded-[20px] border border-shop-line bg-white shadow-[0_6px_18px_rgba(120,70,60,0.08)]">
                <div className="flex items-center justify-between border-b border-[#f1e9e0] px-4 py-3.5">
                  <div>
                    <div className="text-[12px] text-shop-mute">{at.date.slice(5).replace("-", "/")} {at.time}</div>
                    <div className="text-[15px] font-bold">訂單 {o.orderNo}</div>
                  </div>
                  <span className={`rounded-[14px] px-3 py-1 text-[13px] font-bold ${st.cls}`}>{st.label}</span>
                </div>
                <div className="flex flex-col gap-2.5 px-4 py-3.5">
                  {o.lines.map((l, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <Pic src={l.image} alt={l.name} seed={i} className="h-11 w-11 shrink-0 rounded-xl" label="" />
                      <div className={`flex-1 text-[14px] ${l.cancelled >= l.qty ? "text-shop-mute line-through" : ""}`}>
                        {l.name} × {l.qty}
                        {l.cancelled > 0 && l.cancelled < l.qty && <span className="ml-1 text-[12px] text-shop-rose-2">（取消 {l.cancelled}）</span>}
                      </div>
                      <div className="text-[14px]">{l.amount.toLocaleString("en-US")}</div>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between border-t border-dashed border-[#e6dace] pt-2.5">
                    <span className="text-[14px] text-shop-mute">合計</span>
                    <span className="text-[19px] font-bold text-shop-rose">NT$ {o.total.toLocaleString("en-US")}</span>
                  </div>
                </div>
                {st.step >= 0 && (
                  <div className="bg-[#fdfaf6] px-4 pt-3.5 pb-4">
                    <div className="flex items-center">
                      {STEPS.map((s, i) => (
                        <span key={s} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
                          <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${i <= st.step ? "bg-shop-rose" : "border-[3px] border-shop-line bg-white"}`} />
                          {i < STEPS.length - 1 && <span className={`h-[3px] flex-1 ${i < st.step ? "bg-shop-rose" : "bg-shop-line"}`} />}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1.5 flex justify-between text-[12px] text-shop-mute">
                      {STEPS.map((s, i) => <span key={s} className={i === st.step ? "font-bold text-shop-rose-2" : ""}>{s}</span>)}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
        <p className="pb-4 text-center text-[12px] leading-relaxed text-shop-mute">要取消已成立的訂單，請在 LINE 聊天室告訴我們</p>
      </div>
    </>
  );
}
