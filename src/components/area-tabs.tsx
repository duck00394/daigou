// 同一類的頁面放在一排小分頁，切換不用回選單：接單、帳務、系列與商品
// 每個頁面都還在，只是入口放在一起（不多一步：點一下就到）
import Link from "next/link";
import { prisma } from "@/server/db";
import { getOrdersEnabled } from "@/server/services/settings";

type Tab = { href: string; label: string; orders?: true; hint?: string };

export const AREAS = {
  take: {
    label: "接單",
    tabs: [
      { href: "/orders", label: "訂單" },
      { href: "/orders/new", label: "新增訂單", orders: true, hint: "一張一張手動建：選客人、選商品" },
      { href: "/sell", label: "賣給客人", hint: "最快的方式：選系列填數量，有現貨直接賣，沒貨自動記成預訂" },
      { href: "/paste", label: "貼上加單", orders: true, hint: "把客人 LINE 傳的訊息整段貼上，一次建好幾張單（確認後才建立）" },
      { href: "/groupbuys", label: "開團", orders: true, hint: "開一個團收單（有截止日），訂單可以照團篩選" },
      { href: "/shop-admin", label: "訂購頁", hint: "開放系列讓客人自己上網下單，訂單會直接進來" },
    ],
  },
  money: {
    label: "帳務",
    tabs: [
      { href: "/payments", label: "收款與退款", orders: true },
      { href: "/inventory?tab=batches&open=0&pay=due", label: "付代購" },
      { href: "/reconcile", label: "對單" },
      { href: "/sales", label: "賺多少" },
      { href: "/operators", label: "經營者對帳" },
    ],
  },
  catalog: {
    label: "系列與商品",
    tabs: [
      { href: "/categories", label: "系列" },
      { href: "/categories?view=cost", label: "成本比較" },
      { href: "/products", label: "商品" },
      { href: "/series", label: "系列與角色" },
      { href: "/catalog", label: "種類與系列管理" },
    ],
  },
} satisfies Record<string, { label: string; tabs: Tab[] }>;

export async function AreaTabs({ area, current }: { area: keyof typeof AREAS; current: string }) {
  const ordersOn = await getOrdersEnabled(prisma);
  const a = AREAS[area];
  const tabs = (a.tabs as Tab[]).filter((t) => ordersOn || !t.orders);
  const hint = tabs.find((t) => t.href === current)?.hint;
  return (
    <div className="no-print mb-3">
    <nav aria-label={a.label} className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5" data-testid={`area-${area}`}>
      <span className="shrink-0 pr-1 text-[12.5px] text-mute">{a.label}</span>
      {tabs.map((t) => {
        const on = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-9 shrink-0 items-center rounded-full border px-3 text-[13.5px] whitespace-nowrap transition-colors duration-150 ${on ? "border-ai bg-ai-soft font-medium text-ink" : "border-line bg-card text-ink-2 hover:bg-line-2"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
    {/* 這種方式是做什麼的：一句話，讓第一次用的人分得出差別 */}
    {hint && <p className="mt-1.5 text-[12.5px] text-mute" data-testid="area-hint">{hint}</p>}
    </div>
  );
}
