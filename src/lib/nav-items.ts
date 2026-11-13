// 選單項目與「常用頁面」（每個經營者各自一份）的排法。伺服器、手機選單、電腦側邊欄共用
import type { IconName } from "@/components/icons";

export type NavItem = { href: string; label: string; group: string; hint?: string; orders?: true };

// 選單分三組：每天用、偶爾用、設定與資料
export const NAV: NavItem[] = [
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

export const HOME = "/";
export const PURCHASE = "/purchase";
const DAILY = "每天用";
const SOMETIMES = "偶爾用";

/** 可以自己勾的頁面（首頁、新增採購固定；新手教學不算頁面） */
export const PINNABLE = NAV.filter((n) => n.href !== HOME && n.href !== PURCHASE && !n.href.includes("tour="));
const PIN_HREFS = new Set(PINNABLE.map((n) => n.href));

/** 沒設過時「每天用」的那幾個（跟現在一樣） */
export const DEFAULT_PINS = NAV.filter((n) => n.group === DAILY && PIN_HREFS.has(n.href)).map((n) => n.href);

/** 存進去前整理：只留認得的、不重複 */
export function cleanPins(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter((x): x is string => typeof x === "string" && PIN_HREFS.has(x)))].slice(0, PINNABLE.length);
}

/** 手機底部最多 6 個：首頁＋新增採購固定，其他放勾的前 4 個 */
export const BOTTOM_MAX = 6;

/**
 * 依照勾的頁面重排選單：每天用＝首頁、勾的前兩個、＋新增採購、其餘勾的；
 * 原本在每天用但沒勾的移到「偶爾用」最前面；勾了的從原本那組拿掉（每個頁面都還在，只是換位置）
 */
export function arrangeNav(nav: NavItem[], pins: string[]): NavItem[] {
  const byHref = new Map(nav.map((n) => [n.href, n]));
  const picked = pins.map((h) => byHref.get(h)).filter((n): n is NavItem => !!n);
  const pickedSet = new Set(picked.map((n) => n.href));
  const home = byHref.get(HOME);
  const buy = byHref.get(PURCHASE);
  const daily = [...(home ? [home] : []), ...picked.slice(0, 2), ...(buy ? [buy] : []), ...picked.slice(2)].map((n) => ({ ...n, group: DAILY }));
  const rest = nav.filter((n) => n.href !== HOME && n.href !== PURCHASE && !pickedSet.has(n.href));
  const moved = rest.filter((n) => n.group === DAILY).map((n) => ({ ...n, group: SOMETIMES }));
  const others = rest.filter((n) => n.group !== DAILY);
  return [...daily, ...moved, ...others];
}

export type BottomTab = { href: string; label: string; icon: IconName; main?: true };

// 手機底部的短名字與圖示
const SHORT: Record<string, [string, IconName]> = {
  "/": ["首頁", "home"],
  "/orders": ["訂單", "list"],
  "/shipping": ["出貨", "truck"],
  "/purchase": ["採購", "plus"],
  "/inventory?tab=batches": ["收貨", "inbox"],
  "/inventory?tab=stock": ["庫存", "box"],
  "/sell": ["賣出", "tag"],
  "/sales": ["賺多少", "chart"],
  "/buyers": ["買家", "users"],
  "/categories": ["系列", "layers"],
  "/reconcile": ["對單", "check"],
  "/payments": ["收款", "coin"],
  "/paste": ["貼上", "clip"],
  "/rush": ["搶購", "bell"],
  "/groupbuys": ["開團", "users"],
  "/shop-admin": ["訂購頁", "tag"],
  "/shop-pay": ["訂購付款", "coin"],
  "/products": ["商品", "box"],
  "/suppliers": ["供應商", "users"],
  "/import": ["匯入", "inbox"],
  "/catalog": ["種類", "layers"],
  "/series": ["角色", "star"],
  "/reports": ["報表", "chart"],
  "/tags": ["標籤", "tag"],
  "/settings": ["設定", "gear"],
  "/help": ["說明", "help"],
};

/** 自己設的常用頁面 → 手機底部（首頁、勾的前兩個、＋採購在中間、再兩個） */
export function bottomTabs(pins: string[]): BottomTab[] {
  const tab = (href: string, main?: true): BottomTab => {
    const [label, icon] = SHORT[href] ?? [NAV.find((n) => n.href === href)?.label ?? href, "star"];
    return { href, label, icon, ...(main ? { main } : {}) };
  };
  const p = pins.slice(0, BOTTOM_MAX - 2);
  return [tab(HOME), ...p.slice(0, 2).map((h) => tab(h)), tab(PURCHASE, true), ...p.slice(2).map((h) => tab(h))];
}

export const pinsKey = (operatorId: string) => `navPins:${operatorId}`;
