// 選單項目與「常用頁面」（每個經營者各自一份）的排法。伺服器、手機選單、電腦側邊欄共用
import type { IconName } from "@/components/icons";

export type NavItem = { href: string; label: string; group: string; hint?: string; orders?: true; daily?: true };

// 分組：每天用（直接看得到，可以在設定裡自己選）→ 帳務管理 → 商品與客人 → 客人訂購 → 分析與系統
// 每個頁面都有自己的「家」那一組；daily＝沒自己設過時放在「每天用」（不在每天用時回到自己那組）
export const DAILY = "每天用";
export const GROUPS = [DAILY, "帳務管理", "商品與客人", "客人訂購", "分析與系統"] as const;
/** 電腦側邊欄：前三組直接列，後兩組收在「更多功能」 */
export const OPEN_GROUPS = 3;
export const NAV: NavItem[] = [
  { href: "/", label: "首頁", group: DAILY, hint: "今天要做什麼、還要付多少" },
  { href: "/purchase", label: "採購", group: DAILY, hint: "新增採購：買了什麼、哪一團" },
  { href: "/orders", label: "接單", group: "客人訂購", daily: true, hint: "客人的訂單；多選一次出貨、收款" },
  { href: "/inventory?tab=batches", label: "收貨", group: "商品與客人", daily: true, hint: "採購團：東西到了沒、付款、登記收到" },
  { href: "/inventory?tab=stock", label: "庫存", group: "商品與客人", daily: true, hint: "可以賣幾個、自留、成本" },
  { href: "/shipping", label: "出貨", group: "客人訂購", daily: true, hint: "預訂到貨了交給客人、改出貨人" },
  { href: "/sell", label: "賣給客人", group: "客人訂購", daily: true, hint: "選系列、填數量，沒貨記預訂" },
  // 帳務管理：錢進錢出
  { href: "/payments", label: "收款與退款", group: "帳務管理", orders: true, hint: "客人付了多少、要退多少" },
  { href: "/reconcile", label: "對單", group: "帳務管理", hint: "跟代購確認買到多少、砍了哪些、要退多少" },
  { href: "/inventory?tab=batches&open=0&pay=due", label: "付代購", group: "帳務管理", hint: "還沒付清的團，每一團還要付多少" },
  { href: "/sales", label: "賺多少", group: "帳務管理", hint: "照系列看已出貨＋預訂賺多少" },
  { href: "/operators", label: "經營者對帳", group: "帳務管理", hint: "合資、誰付了誰的錢、互相要給多少" },
  // 商品與客人
  { href: "/products", label: "商品", group: "商品與客人" },
  { href: "/categories", label: "系列", group: "商品與客人", hint: "每個系列買了什麼、花多少、品項售價" },
  { href: "/categories?view=cost", label: "系列成本比較", group: "商品與客人", hint: "同一個角色、同一個品項在不同系列每隻多少" },
  { href: "/series", label: "系列與角色", group: "商品與客人" },
  { href: "/catalog", label: "種類與系列管理", group: "商品與客人" },
  { href: "/buyers", label: "買家", group: "商品與客人", orders: true },
  { href: "/tags", label: "標籤", group: "商品與客人" },
  { href: "/suppliers", label: "供應商、代購", group: "商品與客人" },
  // 客人訂購：接單的其他方式
  { href: "/paste", label: "貼上加單", group: "客人訂購", orders: true, hint: "把客人 LINE 傳的文字貼上，一次加好幾張單" },
  { href: "/groupbuys", label: "開團（接單用）", group: "客人訂購", orders: true },
  { href: "/shop-admin", label: "訂購頁（客人下單）", group: "客人訂購", hint: "開放系列給客人下單（訪客或 LINE）、限量、候補" },
  { href: "/shop-pay", label: "訂購頁付款", group: "客人訂購", hint: "客人用賣貨便下單了沒、逾期、補發通知" },
  // 分析與系統
  { href: "/reports", label: "完整報表", group: "分析與系統" },
  { href: "/rush", label: "搶購提醒", group: "分析與系統", hint: "什麼時候開搶，開始前通知手機" },
  { href: "/import", label: "Excel 匯入", group: "分析與系統", orders: true },
  { href: "/settings", label: "匯出、備份與設定", group: "分析與系統", hint: "也有資料健康檢查、操作紀錄、常用頁面" },
  { href: "/?tour=1", label: "新手教學", group: "分析與系統", hint: "一步一步帶你走一次" },
  { href: "/help", label: "名詞說明", group: "分析與系統", hint: "有幾隻、每隻成本、對單是什麼" },
];

export const HOME = "/";
export const PURCHASE = "/purchase";

/** 可以自己勾的頁面（首頁、新增採購固定；新手教學不算頁面） */
export const PINNABLE = NAV.filter((n) => n.href !== HOME && n.href !== PURCHASE && !n.href.includes("tour="));
const PIN_HREFS = new Set(PINNABLE.map((n) => n.href));

/** 沒設過時「每天用」的那幾個 */
export const DEFAULT_PINS = NAV.filter((n) => n.daily && PIN_HREFS.has(n.href)).map((n) => n.href);

/** 存進去前整理：只留認得的、不重複 */
export function cleanPins(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter((x): x is string => typeof x === "string" && PIN_HREFS.has(x)))].slice(0, PINNABLE.length);
}

/** 手機底部：首頁、採購固定，再放勾的前 3 個，最後一格是「更多」（全部功能） */
export const BOTTOM_PINS = 3;

/**
 * 依照勾的頁面重排選單：每天用＝首頁、採購、勾的頁面（照順序）；
 * 沒勾的回到自己那一組；勾了的從自己那組拿掉（每個頁面都還在，只是換位置）。分組照 GROUPS 的順序
 */
export function arrangeNav(nav: NavItem[], pins: string[]): NavItem[] {
  const byHref = new Map(nav.map((n) => [n.href, n]));
  const picked = pins.map((h) => byHref.get(h)).filter((n): n is NavItem => !!n);
  const pickedSet = new Set(picked.map((n) => n.href));
  const home = byHref.get(HOME);
  const buy = byHref.get(PURCHASE);
  const daily = [...(home ? [home] : []), ...(buy ? [buy] : []), ...picked].map((n) => ({ ...n, group: DAILY }));
  const rest = nav.filter((n) => n.href !== HOME && n.href !== PURCHASE && !pickedSet.has(n.href));
  const order = (g: string) => { const i = (GROUPS as readonly string[]).indexOf(g); return i < 0 ? GROUPS.length : i; };
  return [...daily, ...rest.map((n, i) => ({ n, i })).sort((a, b) => order(a.n.group) - order(b.n.group) || a.i - b.i).map((x) => x.n)];
}

export type BottomTab = { href: string; label: string; icon: IconName; main?: true };

// 手機底部的短名字與圖示
const SHORT: Record<string, [string, IconName]> = {
  "/": ["首頁", "home"],
  "/orders": ["接單", "list"],
  "/shipping": ["出貨", "truck"],
  "/purchase": ["採購", "plus"],
  "/inventory?tab=batches": ["收貨", "inbox"],
  "/inventory?tab=stock": ["庫存", "box"],
  "/sell": ["賣出", "tag"],
  "/sales": ["賺多少", "chart"],
  "/inventory?tab=batches&open=0&pay=due": ["付代購", "coin"],
  "/categories?view=cost": ["成本比較", "chart"],
  "/operators": ["經營者", "users"],
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

/** 手機底部：首頁、＋採購、勾的前 3 個（「更多」在畫面上另外加） */
export function bottomTabs(pins: string[]): BottomTab[] {
  const tab = (href: string, main?: true): BottomTab => {
    const [label, icon] = SHORT[href] ?? [NAV.find((n) => n.href === href)?.label ?? href, "star"];
    return { href, label, icon, ...(main ? { main } : {}) };
  };
  return [tab(HOME), tab(PURCHASE, true), ...pins.slice(0, BOTTOM_PINS).map((h) => tab(h))];
}

/** 沒設過常用頁面時的手機底部 */
export const bottomDefault = (ordersOn: boolean) => bottomTabs(ordersOn ? ["/orders", "/shipping", "/inventory?tab=stock"] : ["/categories", "/inventory?tab=stock", "/sales"]);

export const pinsKey = (operatorId: string) => `navPins:${operatorId}`;
