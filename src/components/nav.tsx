"use client";
import { Icon, type IconName } from "@/components/icons";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ViewChip, ViewSwitch, type ViewInfo } from "./view-switch";

// 選單分三組：每天用、偶爾用、設定與資料
export const NAV: { href: string; label: string; group: string; hint?: string; orders?: true }[] = [
  // 三組：每天用（直接看得到）→ 偶爾用 → 設定與資料（電腦版收起來，點開才看；每個頁面都還在）
  { href: "/", label: "首頁", group: "每天用", hint: "今天要做什麼、還要付多少" },
  { href: "/orders", label: "訂單", group: "每天用", hint: "客人的訂單、預訂；可以多選一次出貨、收款" },
  { href: "/shipping", label: "出貨", group: "每天用", hint: "預訂到貨了交給客人、改出貨人" },
  { href: "/purchase", label: "＋ 新增採購", group: "每天用", hint: "買了什麼、哪一團" },
  { href: "/inventory?tab=batches", label: "採購團、收貨", group: "每天用", hint: "東西到了沒、登記收到" },
  { href: "/inventory?tab=stock", label: "庫存、賣出、自留", group: "每天用", hint: "手上有什麼、成本多少" },
  { href: "/sell", label: "賣給客人", group: "每天用", hint: "選系列、填數量，沒貨記預訂" },
  { href: "/sales", label: "賺多少", group: "每天用", hint: "照系列看已出貨＋預訂賺多少" },
  { href: "/buyers", label: "買家", group: "偶爾用", orders: true },
  { href: "/categories", label: "系列", group: "偶爾用", hint: "每個系列買了什麼、花多少、品項售價" },
  { href: "/reconcile", label: "對單", group: "偶爾用", hint: "跟代購確認買到多少、砍了哪些" },
  { href: "/payments", label: "收款與退款", group: "偶爾用", orders: true },
  { href: "/paste", label: "貼上加單", group: "偶爾用", orders: true },
  { href: "/rush", label: "搶購提醒", group: "偶爾用", hint: "什麼時候開搶，開始前通知手機" },
  { href: "/groupbuys", label: "開團（接單用）", group: "偶爾用", orders: true },
  { href: "/shop-admin", label: "訂購頁（客人下單）", group: "偶爾用", hint: "開放系列給客人下單（訪客或 LINE）、限量、候補" },
  { href: "/shop-pay", label: "訂購頁付款", group: "偶爾用", hint: "客人用賣貨便下單了沒、逾期、補發通知" },
  { href: "/products", label: "商品", group: "設定與資料" },
  { href: "/suppliers", label: "供應商、代購", group: "設定與資料" },
  { href: "/import", label: "Excel 匯入", group: "設定與資料", orders: true },
  { href: "/catalog", label: "種類與系列管理", group: "設定與資料" },
  { href: "/series", label: "系列與角色", group: "設定與資料" },
  { href: "/reports", label: "完整報表", group: "設定與資料" },
  { href: "/tags", label: "標籤", group: "設定與資料" },
  { href: "/settings", label: "匯出、備份與設定", group: "設定與資料" },
  { href: "/?tour=1", label: "新手教學", group: "設定與資料", hint: "一步一步帶你走一次" },
  { href: "/help", label: "名詞說明", group: "設定與資料", hint: "有幾隻、每隻成本、對單是什麼" },
];

type Tab = { href: string; label: string; icon: IconName; main?: true };
// 手機底部：每天最常用的直接一下到。有接單時多放「訂單」「出貨」（賺多少在首頁的數字點進去、或「全部功能」）
const BOTTOM_ORDERS: Tab[] = [
  { href: "/", label: "首頁", icon: "home" },
  { href: "/orders", label: "訂單", icon: "list" },
  { href: "/shipping", label: "出貨", icon: "truck" },
  { href: "/purchase", label: "採購", icon: "plus", main: true },
  { href: "/inventory?tab=stock", label: "庫存", icon: "box" },
  { href: "/categories", label: "系列", icon: "layers" },
];
const BOTTOM_PLAIN: Tab[] = [
  { href: "/", label: "首頁", icon: "home" },
  { href: "/categories", label: "系列", icon: "layers" },
  { href: "/purchase", label: "採購", icon: "plus", main: true },
  { href: "/inventory?tab=stock", label: "庫存", icon: "box" },
  { href: "/sales", label: "賺多少", icon: "chart" },
];

function active(path: string, href: string, tab?: string | null) {
  const [base, q] = href.split("?");
  if (q?.includes("tour=")) return false;
  if (base === "/") return path === "/";
  if (!(path === base || path.startsWith(base + "/"))) return false;
  if (!q) return true;
  const want = new URLSearchParams(q).get("tab");
  // 採購團頁（/inventory/batches/…）算在「採購團・收貨」
  if (path.startsWith("/inventory/batches")) return want === "batches";
  return (tab ?? "stock") === want;
}

function useTab() {
  const sp = useSearchParams();
  return sp.get("tab");
}

const visible = (ordersOn: boolean) => NAV.filter((n) => ordersOn || !n.orders);

export function Sidebar({ ordersOn = true, view }: { ordersOn?: boolean; view?: ViewInfo }) {
  const path = usePathname();
  const tab = useTab();
  const nav = visible(ordersOn);
  const groups = [...new Set(nav.map((n) => n.group))];
  return (
    <nav aria-label="主要功能" className="no-print sticky top-0 hidden h-dvh w-52 shrink-0 flex-col overflow-y-auto border-r border-line bg-paper px-3 py-4 md:flex">
      <Link href="/" className="mb-5 flex items-center gap-2 px-2 text-[16px] font-semibold">
        <span aria-hidden className="inline-block h-5 w-5 rounded-[5px] bg-ai" />
        代購帳房
      </Link>
      <form action="/search" method="get" role="search" className="mb-4 px-1">
        <input type="search" name="q" placeholder="搜尋客人、訂單、商品" aria-label="搜尋" className="w-full rounded-lg border border-field bg-card px-2.5 py-1.5 text-[14px] text-ink placeholder:text-mute" />
      </form>
      {view && <div className="px-1"><ViewSwitch v={view} /></div>}
      {groups.map((g, gi) => {
        const links = nav.filter((n) => n.group === g).map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active(path, n.href, tab) ? "page" : undefined}
            className={`block rounded-lg px-2.5 py-1.5 text-[14px] transition-colors duration-150 ${active(path, n.href, tab) ? "bg-ai-soft font-medium text-ink" : "text-ink-2 hover:bg-line-2 hover:text-ink"}`}
          >
            {n.label}
          </Link>
        ));
        // 每天用的直接列；偶爾用、設定與資料收起來（正在看的頁在裡面就自動打開）
        if (gi === 0) return <div key={g} className="mb-3">{links}</div>;
        const here = nav.some((n) => n.group === g && active(path, n.href, tab));
        return (
          <details key={g} open={here} className="group mb-1">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] text-mute hover:bg-line-2 [&::-webkit-details-marker]:hidden">
              {g}
              <span aria-hidden className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none">›</span>
            </summary>
            <div className="mt-0.5 mb-2">{links}</div>
          </details>
        );
      })}
      <form action="/logout" method="post" className="mt-auto px-2">
        <button className="text-[13px] text-mute hover:text-ink">登出</button>
      </form>
    </nav>
  );
}

export function MobileBar({ ordersOn = true, view }: { ordersOn?: boolean; view?: ViewInfo }) {
  const path = usePathname();
  const tab = useTab();
  const nav = visible(ordersOn);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const current = NAV.find((n) => active(path, n.href, tab) && n.href !== "/") ?? NAV[0];
  return (
    <>
      <header className="no-print sticky top-0 z-40 flex items-center justify-between border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur md:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <Link href="/" className="text-[16px] font-semibold whitespace-nowrap">
            代購帳房
          </Link>
          {view && view.me && <button type="button" onClick={() => setOpen(true)} aria-label={`現在看：${view.name}，按這裡切換`}><ViewChip v={view} /></button>}
        </span>
        <span className="flex items-center gap-2">
          <Link href="/search" aria-label="搜尋" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line bg-card px-2.5 text-[14px]"><Icon name="search" /> 搜尋</Link>
          <button type="button" onClick={() => setOpen(true)} className="min-h-9 rounded-lg border border-line bg-card px-3 text-[14px]" aria-expanded={open}>
            全部功能
          </button>
        </span>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 bg-scrim md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-x-0 top-0 max-h-dvh overflow-y-auto rounded-b-2xl bg-card px-4 pt-3 pb-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-mute">目前：{current.label}</span>
              <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-mute" aria-label="關閉">
                ✕
              </button>
            </div>
            {view && <ViewSwitch v={view} onDone={() => setOpen(false)} />}
            {[...new Set(nav.map((n) => n.group))].map((g) => (
              <div key={g} className="mb-3">
                <div className="mb-1 text-[12px] text-mute">{g}</div>
                <div className="grid grid-cols-2 gap-2">
                  {nav.filter((n) => n.group === g).map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={`rounded-lg border px-3 py-2 text-[15px] ${active(path, n.href, tab) ? "border-ai-soft bg-ai-soft text-ink" : "border-line"} ${g === "每天用" ? "font-medium" : "text-ink-2"}`}
                    >
                      {n.label}
                      {n.hint && <span className="block text-[11.5px] font-normal text-mute">{n.hint}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <form action="/logout" method="post" className="mt-4 text-right">
              <button className="text-sm text-mute">登出</button>
            </form>
          </div>
        </div>
      )}
      <nav aria-label="常用功能" className={`no-print safe-bottom fixed inset-x-0 bottom-0 z-40 grid ${ordersOn ? "grid-cols-6" : "grid-cols-5"} border-t border-line bg-paper/95 backdrop-blur md:hidden`}>
        {(ordersOn ? BOTTOM_ORDERS : BOTTOM_PLAIN).map((b) => (
          <Link
            key={b.href}
            href={b.href}
            aria-current={active(path, b.href, tab) ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] ${active(path, b.href, tab) ? "font-medium text-ai" : "text-mute"}`}
          >
            {b.main ? (
              <span className="flex h-7 w-11 items-center justify-center rounded-full bg-ai text-[17px] text-on-fill"><Icon name={b.icon} /></span>
            ) : (
              <span className="text-[20px] leading-none"><Icon name={b.icon} /></span>
            )}
            <span className={b.main ? "font-medium text-ink" : ""}>{b.main ? `＋ ${b.label}` : b.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
