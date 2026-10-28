import { describe, expect, it } from "vitest";
import { countSets } from "@/lib/sets";

describe("countSets", () => {
  const m = ["吉伊", "小八", "兔兔", "栗子", "獅薩", "古本屋", "師傅", "小桃"];
  it("ANA 吊娃：4 套，多出依多到少", () => {
    const q = new Map(Object.entries({ 吉伊: 6, 小八: 4, 兔兔: 6, 栗子: 4, 獅薩: 5, 古本屋: 4, 師傅: 7, 小桃: 5 }));
    expect(countSets(m, q)).toEqual({ sets: 4, extras: [{ id: "師傅", qty: 3 }, { id: "吉伊", qty: 2 }, { id: "兔兔", qty: 2 }, { id: "獅薩", qty: 1 }, { id: "小桃", qty: 1 }] });
  });
  it("缺角色算 0 隻：不成套，有的都算多出", () => {
    expect(countSets(m, new Map([["兔兔", 1]]))).toEqual({ sets: 0, extras: [{ id: "兔兔", qty: 1 }] });
  });
  it("負的（不夠）當 0", () => {
    expect(countSets(["a", "b"], new Map([["a", -2], ["b", 3]]))).toEqual({ sets: 0, extras: [{ id: "b", qty: 3 }] });
  });
  it("少於 2 個角色不算套", () => {
    expect(countSets(["a"], new Map([["a", 5]]))).toEqual({ sets: 0, extras: [] });
  });
});
