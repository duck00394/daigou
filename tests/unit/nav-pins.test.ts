import { describe, expect, it } from "vitest";
import { NAV, DEFAULT_PINS, PINNABLE, arrangeNav, bottomTabs, cleanPins } from "@/lib/nav-items";

const daily = (nav: typeof NAV) => nav.filter((n) => n.group === "每天用").map((n) => n.href);

describe("常用頁面", () => {
  it("用預設排出來的「每天用」跟原本一模一樣", () => {
    expect(daily(arrangeNav(NAV, DEFAULT_PINS))).toEqual(daily(NAV));
  });

  it("首頁第一、勾的前兩個、＋新增採購、其餘勾的", () => {
    const nav = arrangeNav(NAV, ["/sales", "/buyers", "/orders", "/categories"]);
    expect(daily(nav)).toEqual(["/", "/sales", "/buyers", "/purchase", "/orders", "/categories"]);
  });

  it("沒有任何頁面不見：沒勾的原本每天用移到偶爾用，勾了的從原本那組拿掉", () => {
    const nav = arrangeNav(NAV, ["/buyers"]);
    expect(nav.map((n) => n.href).sort()).toEqual(NAV.map((n) => n.href).sort());
    expect(nav.find((n) => n.href === "/shipping")?.group).toBe("偶爾用");
    expect(nav.filter((n) => n.href === "/buyers")).toHaveLength(1);
    expect(nav.find((n) => n.href === "/settings")?.group).toBe("設定與資料");
  });

  it("手機底部最多 6 個，＋採購在中間", () => {
    const b = bottomTabs(["/orders", "/shipping", "/inventory?tab=stock", "/sales", "/buyers", "/categories"]);
    expect(b.map((x) => x.label)).toEqual(["首頁", "訂單", "出貨", "採購", "庫存", "賺多少"]);
    expect(b.find((x) => x.main)?.href).toBe("/purchase");
    expect(bottomTabs([]).map((x) => x.href)).toEqual(["/", "/purchase"]);
  });

  it("存之前只留認得的頁面、不重複；首頁和採購不能勾", () => {
    expect(cleanPins(["/orders", "/orders", "/nope", "/", "/purchase", 3, "/sales"])).toEqual(["/orders", "/sales"]);
    expect(cleanPins("x")).toBeNull();
    expect(PINNABLE.some((n) => n.href === "/" || n.href === "/purchase" || n.href.includes("tour="))).toBe(false);
  });
});
