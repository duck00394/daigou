"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const NAV: { href: string; label: string; group: string }[] = [
  { href: "/", label: "首頁", group: "日常" },
  { href: "/paste", label: "貼上加單", group: "日常" },
  { href: "/import", label: "Excel 匯入", group: "日常" },
  { href: "/orders", label: "訂單", group: "日常" },
  { href: "/payments", label: "收款與退款", group: "日常" },
  { href: "/shipping", label: "出貨", group: "日常" },
  { href: "/buyers", label: "買家", group: "資料" },
  { href: "/products", label: "商品", group: "資料" },
  { href: "/series", label: "系列與角色", group: "資料" },
  { href: "/categories", label: "活動與分類", group: "資料" },
  { href: "/groupbuys", label: "代購團", group: "資料" },
  { href: "/tags", label: "標籤", group: "資料" },
  { href: "/inventory", label: "庫存與採購", group: "營運" },
  { href: "/suppliers", label: "供應商", group: "營運" },
  { href: "/operators", label: "經營者對帳", group: "營運" },
  { href: "/reports", label: "成本與利潤", group: "營運" },
  { href: "/settings", label: "匯出、備份與設定", group: "營運" },
];

const BOTTOM = [
  { href: "/", label: "首頁" },
  { href: "/orders", label: "訂單" },
  { href: "/paste", label: "貼上加單", main: true },
  { href: "/shipping", label: "出貨" },
  { href: "/buyers", label: "買家" },
];

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function Sidebar() {
  const path = usePathname();
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <nav aria-label="主要功能" className="no-print sticky top-0 hidden h-dvh w-52 shrink-0 flex-col overflow-y-auto border-r border-line bg-white px-3 py-4 md:flex">
      <Link href="/" className="round mb-5 flex items-center gap-2 px-2 text-[17px] font-semibold">
        <span aria-hidden className="inline-block h-6 w-6 rounded-md bg-ai" />
        代購帳房
      </Link>
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <div className="mb-1 px-2 text-[12px] text-mute">{g}</div>
          {NAV.filter((n) => n.group === g).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(path, n.href) ? "page" : undefined}
              className={`block rounded-lg px-2.5 py-1.5 text-[14px] ${active(path, n.href) ? "bg-peach font-semibold text-peach-ink" : "text-ink-2 hover:bg-line-2"}`}
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

export function MobileBar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const current = NAV.find((n) => active(path, n.href) && n.href !== "/") ?? NAV[0];
  return (
    <>
      <header className="no-print sticky top-0 z-40 flex items-center justify-between border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur md:hidden">
        <Link href="/" className="round text-[16px] font-semibold">
          代購帳房
        </Link>
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line px-3 py-1 text-[14px]" aria-expanded={open}>
          全部功能
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-x-0 top-0 rounded-b-2xl bg-white px-4 pt-3 pb-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-mute">目前：{current.label}</span>
              <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-mute" aria-label="關閉">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className={`rounded-lg border px-3 py-2.5 text-[15px] ${active(path, n.href) ? "border-peach bg-peach text-peach-ink" : "border-line"}`}>
                  {n.label}
                </Link>
              ))}
            </div>
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
            aria-current={active(path, b.href) ? "page" : undefined}
            className={`flex flex-col items-center justify-center py-2.5 text-[12.5px] ${b.main ? "font-semibold" : ""} ${active(path, b.href) ? "text-ai" : "text-ink-2"}`}
          >
            {b.main ? <span className={`rounded-full px-3 py-1 ${active(path, b.href) ? "bg-ai text-white" : "bg-peach text-peach-ink"}`}>{b.label}</span> : b.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
