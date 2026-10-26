// 顯示用的小工具：台灣時間的日期、紀錄裡的狀態中文
import { describe, expect, it } from "vitest";
import { flagLabel, fmtMonthDay, toDateInput } from "@/lib/labels";

describe("台灣時間", () => {
  it("台灣凌晨（UTC 前一天下午）下單，月/日要算台灣的那一天", () => {
    const d = new Date("2026-10-26T17:30:00Z"); // 台灣 10/27 01:30
    expect(fmtMonthDay(d)).toBe("10/27");
    expect(toDateInput(d)).toBe("2026-10-27");
    expect(fmtMonthDay(new Date("2026-01-05T03:00:00Z"))).toBe("1/5");
    expect(fmtMonthDay(null)).toBe("");
  });
});

describe("紀錄裡的狀態中文", () => {
  it("採購、備貨狀態顯示中文；不認得的原樣顯示", () => {
    expect(flagLabel("PENDING_PURCHASE")).toBe("待採購");
    expect(flagLabel("ORDERED")).toBe("已向供應商下單");
    expect(flagLabel("READY")).toBe("已備妥");
    expect(flagLabel("其他")).toBe("其他");
    expect(flagLabel(null)).toBe("");
  });
});
