"use client";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ViewChip, ViewSwitch, type ViewInfo } from "./view-switch";
import { DAILY, DEFAULT_PINS, NAV, OPEN_GROUPS, arrangeNav, bottomDefault, bottomTabs } from "@/lib/nav-items";

export { NAV };

/** 這個連結跟現在的網址配得多好：-1＝不是；數字越大越準（網址上的條件都對上的那個才算「現在這頁」） */
function score(path: string, sp: URLSearchParams, href: string) {
  const [base, q] = href.split("?");
  if (q?.includes("tour=")) return -1;
  if (base === "/") return path === "/" ? 0 : -1;
  const want = new URLSearchParams(q ?? "");
  // 採購團頁（/inventory/batches/…）算在「採購團、收貨」
  if (path.startsWith("/inventory/batches")) return href === "/inventory?tab=batches" ? 1 : -1;
  if (!(path === base || path.startsWith(base + "/"))) return -1;
  let n = 0;
  for (const [k, v] of want) {
    const now = sp.get(k) ?? (base === "/inventory" && k === "tab" ? "stock" : null);
    if (now !== v) return -1;
    n++;
  }
  return n;
}
/** 現在這頁對應哪個連結（同一頁有好幾個入口時，挑條件最符合的那個） */
function currentHref(path: string, sp: URLSearchParams, hrefs: string[]) {
  let best: string | null = null;
  let top = -1;
  for (const h of hrefs) {
    const s = score(path, sp, h);
    if (s > top) { top = s; best = h; }
  }
  return best;
}

function useParams() {
  return useSearchParams();
}

const visible = (ordersOn: boolean) => NAV.filter((n) => ordersOn || !n.orders);
// 自己設過常用頁面就照他的排；沒設過用預設那幾個
const arranged = (ordersOn: boolean, pins?: string[] | null) => arrangeNav(visible(ordersOn), pins ?? DEFAULT_PINS);

export function Sidebar({ ordersOn = true, view, pins }: { ordersOn?: boolean; view?: ViewInfo; pins?: string[] | null }) {
  const path = usePathname();
  const sp = useParams();
  const nav = arranged(ordersOn, pins);
  const cur = currentHref(path, sp, nav.map((n) => n.href));
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
      {(() => {
        const list = (g: string) => (
          <div key={g} className="mb-3">
            {g !== DAILY && <div className="px-2.5 pb-0.5 text-[12.5px] text-mute">{g}</div>}
            {nav.filter((n) => n.group === g).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={cur === n.href ? "page" : undefined}
                className={`block rounded-lg px-2.5 py-1.5 text-[14px] transition-colors duration-150 ${cur === n.href ? "bg-ai-soft font-medium text-ink" : "text-ink-2 hover:bg-line-2 hover:text-ink"}`}
              >
                {n.label}
              </Link>
            ))}
          </div>
        );
        // 每天用、帳務管理、商品與客人直接列；客人訂購、分析與系統收在「更多功能」（正在看的頁在裡面就自動打開）
        const shown = groups.slice(0, OPEN_GROUPS);
        const more = groups.slice(OPEN_GROUPS);
        const here = nav.some((n) => more.includes(n.group) && cur === n.href);
        return (
          <>
            {shown.map(list)}
            {more.length > 0 && (
              <details open={here} className="group mb-1">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] text-mute hover:bg-line-2 [&::-webkit-details-marker]:hidden">
                  更多功能
                  <span aria-hidden className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none">›</span>
                </summary>
                <div className="mt-1">{more.map(list)}</div>
              </details>
            )}
          </>
        );
      })()}
      <form action="/logout" method="post" className="mt-auto px-2">
        <button className="text-[13px] text-mute hover:text-ink">登出</button>
      </form>
    </nav>
  );
}

export function MobileBar({ ordersOn = true, view, pins }: { ordersOn?: boolean; view?: ViewInfo; pins?: string[] | null }) {
  const path = usePathname();
  const sp = useParams();
  const nav = arranged(ordersOn, pins);
  const visibleSet = new Set(nav.map((n) => n.href));
  const bottom = pins ? bottomTabs(pins.filter((h) => visibleSet.has(h))) : bottomDefault(ordersOn);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const cur = currentHref(path, sp, nav.map((n) => n.href));
  const curBottom = currentHref(path, sp, bottom.map((b) => b.href));
  const current = NAV.find((n) => n.href === cur) ?? NAV[0];
  return (
    <>
      <header className="no-print sticky top-0 z-40 flex h-(--mobile-header-h) items-center justify-between border-b border-line bg-paper/95 px-4 backdrop-blur md:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <Link href="/" className="text-[16px] font-semibold whitespace-nowrap">
            代購帳房
          </Link>
          {view && view.me && <button type="button" onClick={() => setOpen(true)} aria-label={`現在看：${view.name}，按這裡切換`}><ViewChip v={view} /></button>}
        </span>
        <span className="flex items-center gap-2">
          <Link href="/search" aria-label="搜尋" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line bg-card px-2.5 text-[14px]"><Icon name="search" /> 搜尋</Link>
        </span>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 bg-scrim md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-x-0 top-0 max-h-dvh overflow-y-auto rounded-b-2xl bg-card px-4 pt-3 pb-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-mute">全部功能（目前：{current.label}）</span>
              <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-mute" aria-label="關閉">
                ✕
              </button>
            </div>
            {view && <ViewSwitch v={view} onDone={() => setOpen(false)} />}
            {[...new Set(nav.map((n) => n.group))].map((g) => (
              <div key={g} className="mb-3">
                <div className={`mb-1 text-mute ${g === DAILY ? "text-[12.5px] font-medium text-ink-2" : "text-[12px]"}`}>{g}</div>
                {/* 一組一個外框、細線分格（不是一顆顆卡片） */}
                <ul className="stat-grid grid grid-cols-2">
                  {nav.filter((n) => n.group === g).map((n) => (
                    <li key={n.href}>
                      <Link
                        href={n.href}
                        aria-current={cur === n.href ? "page" : undefined}
                        className={`flex h-full flex-col justify-center px-3 text-[15px] ${g === DAILY ? "min-h-14 py-2.5 font-medium" : "min-h-11 py-2 text-ink-2"} ${cur === n.href ? "bg-ai-soft text-ink" : ""}`}
                      >
                        {n.label}
                        {/* 每天用的寫一句是做什麼的；其他組只列名字，比較短、好找 */}
                        {g === DAILY && n.hint && <span className="block text-[11.5px] font-normal text-mute">{n.hint}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <form action="/logout" method="post" className="mt-4 text-right">
              <button className="text-sm text-mute">登出</button>
            </form>
          </div>
        </div>
      )}
      <nav aria-label="常用功能" className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 grid border-t border-line bg-paper/95 backdrop-blur md:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }}>
        {bottom.map((b) => {
          const on = curBottom === b.href;
          return (
            <Link
              key={b.href}
              href={b.href}
              aria-current={on ? "page" : undefined}
              aria-label={b.main ? `＋ ${b.label}（新增採購）` : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] ${on ? "font-medium text-ink" : "text-mute"}`}
            >
              {b.main ? (
                <span className="flex h-7 w-11 items-center justify-center rounded-full bg-ai text-[17px] text-on-fill"><Icon name={b.icon} /></span>
              ) : (
                <span className={`flex h-7 w-11 items-center justify-center rounded-full text-[20px] leading-none ${on ? "bg-ai-soft text-ai" : ""}`}><Icon name={b.icon} /></span>
              )}
              <span className={b.main ? "font-medium text-ink" : ""}>{b.main ? `＋ ${b.label}` : b.label}</span>
            </Link>
          );
        })}
        {/* 更多＝全部功能（每個頁面都在裡面，照分組排） */}
        <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-label="更多（全部功能）" className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] ${open ? "font-medium text-ink" : "text-mute"}`}>
          <span className="flex h-7 w-11 items-center justify-center rounded-full text-[20px] leading-none"><Icon name="more" /></span>
          <span>更多</span>
        </button>
      </nav>
    </>
  );
}
