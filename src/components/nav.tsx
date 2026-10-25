"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ViewChip, ViewSwitch, type ViewInfo } from "./view-switch";

// 常用：收藏轉售每天會用到的；其他：接單（LINE／訂單）與資料設定
export const NAV: { href: string; label: string; group: string; hint?: string }[] = [
  { href: "/", label: "首頁", group: "常用", hint: "今天要做什麼、還要付多少" },
  { href: "/purchase", label: "＋ 新增採購", group: "常用", hint: "買了什麼、哪一團" },
  { href: "/sell", label: "賣給客人", group: "常用", hint: "選系列、填數量，沒貨記預訂" },
  { href: "/rush", label: "搶購提醒", group: "常用", hint: "什麼時候開搶，開始前通知手機" },
  { href: "/categories", label: "系列", group: "常用", hint: "每個系列買了什麼、花多少、品項售價" },
  { href: "/inventory?tab=batches", label: "採購團・收貨", group: "常用", hint: "東西到了沒、登記收到" },
  { href: "/reconcile", label: "對單", group: "常用", hint: "跟代購確認買到多少、砍了哪些" },
  { href: "/inventory?tab=stock", label: "庫存・賣出・自留", group: "常用", hint: "手上有什麼、成本多少" },
  { href: "/sales", label: "賺多少", group: "常用", hint: "賣出的收入、成本、毛利" },
  { href: "/?tour=1", label: "新手教學", group: "幫助", hint: "一步一步帶你走一次" },
  { href: "/help", label: "名詞說明", group: "幫助", hint: "有幾隻、每隻成本、對單是什麼" },
  { href: "/paste", label: "貼上加單", group: "接單" },
  { href: "/orders", label: "訂單", group: "接單" },
  { href: "/payments", label: "收款與退款", group: "接單" },
  { href: "/shipping", label: "出貨", group: "接單" },
  { href: "/buyers", label: "買家", group: "接單" },
  { href: "/groupbuys", label: "開團（接單用）", group: "接單" },
  { href: "/import", label: "Excel 匯入", group: "接單" },
  { href: "/catalog", label: "種類與系列管理", group: "資料與設定" },
  { href: "/products", label: "商品", group: "資料與設定" },
  { href: "/series", label: "系列與角色", group: "資料與設定" },
  { href: "/suppliers", label: "供應商・代購", group: "資料與設定" },
  { href: "/reports", label: "完整報表", group: "資料與設定" },
  { href: "/tags", label: "標籤", group: "資料與設定" },
  { href: "/settings", label: "匯出、備份與設定", group: "資料與設定" },
];

const BOTTOM = [
  { href: "/", label: "首頁" },
  { href: "/categories", label: "系列" },
  { href: "/purchase", label: "＋ 採購", main: true },
  { href: "/inventory?tab=stock", label: "庫存" },
  { href: "/sales", label: "賺多少" },
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

const visible = (ordersOn: boolean) => NAV.filter((n) => ordersOn || n.group !== "接單");

export function Sidebar({ ordersOn = true, view }: { ordersOn?: boolean; view?: ViewInfo }) {
  const path = usePathname();
  const tab = useTab();
  const nav = visible(ordersOn);
  const groups = [...new Set(nav.map((n) => n.group))];
  return (
    <nav aria-label="主要功能" className="no-print sticky top-0 hidden h-dvh w-52 shrink-0 flex-col overflow-y-auto border-r border-line bg-white px-3 py-4 md:flex">
      <Link href="/" className="round mb-5 flex items-center gap-2 px-2 text-[17px] font-semibold">
        <span aria-hidden className="inline-block h-6 w-6 rounded-md bg-ai" />
        代購帳房
      </Link>
      <form action="/search" method="get" role="search" className="mb-4 px-1">
        <input type="search" name="q" placeholder="🔍 搜尋角色、商品" aria-label="搜尋" className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[14px]" />
      </form>
      {view && <div className="px-1"><ViewSwitch v={view} /></div>}
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <div className="mb-1 px-2 text-[12px] text-mute">{g}</div>
          {nav.filter((n) => n.group === g).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(path, n.href, tab) ? "page" : undefined}
              className={`block rounded-lg px-2.5 py-1.5 text-[14px] ${active(path, n.href, tab) ? "bg-peach font-semibold text-peach-ink" : "text-ink-2 hover:bg-line-2"}`}
            >
              {n.label}
            </Link>
          ))}
        </div>
      ))}
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
      <header className="no-print sticky top-0 z-40 flex items-center justify-between border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur md:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <Link href="/" className="round text-[16px] font-semibold whitespace-nowrap">
            代購帳房
          </Link>
          {view && view.me && <button type="button" onClick={() => setOpen(true)} aria-label={`現在看：${view.name}，按這裡切換`}><ViewChip v={view} /></button>}
        </span>
        <span className="flex items-center gap-2">
          <Link href="/search" aria-label="搜尋" className="rounded-lg border border-line px-2.5 py-1 text-[14px]">🔍 搜尋</Link>
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line px-3 py-1 text-[14px]" aria-expanded={open}>
            全部功能
          </button>
        </span>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-x-0 top-0 max-h-dvh overflow-y-auto rounded-b-2xl bg-white px-4 pt-3 pb-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
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
                      className={`rounded-lg border px-3 ${n.hint ? "py-2" : "py-2"} text-[15px] ${active(path, n.href, tab) ? "border-peach bg-peach text-peach-ink" : "border-line"} ${g === "常用" ? "font-medium" : "text-ink-2"}`}
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
      <nav aria-label="常用功能" className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-white md:hidden">
        {BOTTOM.map((b) => (
          <Link
            key={b.href}
            href={b.href}
            aria-current={active(path, b.href, tab) ? "page" : undefined}
            className={`flex flex-col items-center justify-center py-2.5 text-[12.5px] ${b.main ? "font-semibold" : ""} ${active(path, b.href, tab) ? "text-ai" : "text-ink-2"}`}
          >
            {b.main ? <span className={`rounded-full px-3 py-1 ${active(path, b.href, tab) ? "bg-ai text-white" : "bg-peach text-peach-ink"}`}>{b.label}</span> : b.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
