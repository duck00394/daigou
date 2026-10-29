// Server Action 的錯誤訊息：輸入格式不對要說清楚，業務錯誤照原訊息，內部錯誤不外洩
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({
  AuthError: class AuthError extends Error {},
  can: () => true,
  requireActionUser: async () => ({ id: "u1" }),
}));

describe("run() 錯誤訊息", () => {
  it("輸入格式不對、業務錯誤、內部錯誤", async () => {
    const { run } = await import("@/server/action");
    const { BizError } = await import("@/server/db");
    const bad = await run(async () => z.object({ qty: z.number().int() }).parse({ qty: "abc" }));
    expect(bad).toEqual({ ok: false, error: "輸入的資料格式不對（例如數量要整數、文字太長），請檢查後再試" });
    expect(await run(async () => { throw new BizError("數量必須是正整數"); })).toEqual({ ok: false, error: "數量必須是正整數" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = await run(async () => { throw new Error("db password xyz"); });
    expect(boom).toEqual({ ok: false, error: "系統發生錯誤，操作未完成，請稍後再試" });
    spy.mockRestore();
    expect(await run(async () => 5)).toEqual({ ok: true, data: 5 });
  });
});
