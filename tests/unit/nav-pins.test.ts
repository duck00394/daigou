import { describe, expect, it } from "vitest";
import { NAV, GROUPS, DEFAULT_PINS, PINNABLE, arrangeNav, bottomDefault, bottomTabs, cleanPins } from "@/lib/nav-items";

const daily = (nav: typeof NAV) => nav.filter((n) => n.group === "每天用").map((n) => n.href);

describe("常用頁面", () => {
  it("沒設過：每天用＝首頁、採購、接單、收貨、庫存、出貨、賣給客人", () => {
    expect(daily(arrangeNav(NAV, DEFAULT_PINS))).toEqual(["/", "/purchase", "/orders", "/inventory?tab=batches", "/inventory?tab=stock", "/shipping", "/sell"]);
  });

  it("每個頁面只出現一次、分組照固定順序", () => {
    const nav = arrangeNav(NAV, DEFAULT_PINS);
    expect(new Set(nav.map((n) => n.href)).size).toBe(NAV.length);
    expect([...new Set(nav.map((n) => n.group))]).toEqual([...GROUPS]);
  });

  it("首頁第一、採購第二，再來是勾的（照順序）", () => {
    const nav = arrangeNav(NAV, ["/sales", "/buyers", "/orders", "/categories"]);
    expect(daily(nav)).toEqual(["/", "/purchase", "/sales", "/buyers", "/orders", "/categories"]);
  });

  it("沒有任何頁面不見：沒勾的回到自己那一組，勾了的從原本那組拿掉", () => {
    const nav = arrangeNav(NAV, ["/buyers"]);
    expect(nav.map((n) => n.href).sort()).toEqual(NAV.map((n) => n.href).sort());
    expect(nav.find((n) => n.href === "/shipping")?.group).toBe("客人訂購");
    expect(nav.find((n) => n.href === "/inventory?tab=stock")?.group).toBe("商品與客人");
    expect(nav.find((n) => n.href === "/buyers")?.group).toBe("每天用");
    expect(nav.find((n) => n.href === "/settings")?.group).toBe("分析與系統");
    expect(nav.find((n) => n.href === "/sales")?.group).toBe("帳務管理");
  });

  it("手機底部：首頁、＋採購、勾的前 3 個（最後再加「更多」）", () => {
    const b = bottomTabs(["/orders", "/shipping", "/inventory?tab=stock", "/sales", "/buyers", "/categories"]);
    expect(b.map((x) => x.label)).toEqual(["首頁", "採購", "接單", "出貨", "庫存"]);
    expect(b.find((x) => x.main)?.href).toBe("/purchase");
    expect(bottomTabs([]).map((x) => x.href)).toEqual(["/", "/purchase"]);
    expect(bottomDefault(true).map((x) => x.label)).toEqual(["首頁", "採購", "接單", "出貨", "庫存"]);
    expect(bottomDefault(false).map((x) => x.label)).toEqual(["首頁", "採購", "系列", "庫存", "賺多少"]);
  });

  it("存之前只留認得的頁面、不重複；首頁和採購不能勾", () => {
    expect(cleanPins(["/orders", "/orders", "/nope", "/", "/purchase", 3, "/sales"])).toEqual(["/orders", "/sales"]);
    expect(cleanPins("x")).toBeNull();
    expect(PINNABLE.some((n) => n.href === "/" || n.href === "/purchase" || n.href.includes("tour="))).toBe(false);
  });
});
