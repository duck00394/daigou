// 背景程式（public/sw.js）：收到推播會顯示通知；點通知打開那一筆
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadSw() {
  const code = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; opts: { data: { url: string } } }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://daigou.example" },
    addEventListener: (k: string, f: (e: unknown) => void) => (listeners[k] = f),
    skipWaiting: vi.fn(),
    registration: { showNotification: async (title: string, opts: { data: { url: string } }) => void shown.push({ title, opts }) },
    clients: { claim: vi.fn(), matchAll: async () => [], openWindow: async (u: string) => void opened.push(u) },
  };
  new Function("self", code)(self);
  return { listeners, shown, opened };
}

describe("背景程式", () => {
  it("收到推播就顯示通知，點了打開那一筆搶購提醒", async () => {
    const sw = loadSw();
    let wait: Promise<unknown> = Promise.resolve();
    sw.listeners.push({ data: { json: () => ({ title: "【搶購提醒】再過 5 分鐘開始", body: "A 代購團｜聖誕", url: "/rush/abc" }) }, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
    expect(sw.shown[0].title).toBe("【搶購提醒】再過 5 分鐘開始");
    expect(sw.shown[0].opts.data.url).toBe("/rush/abc");
    sw.listeners.notificationclick({ notification: { close: vi.fn(), data: { url: "/rush/abc" } }, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
    expect(sw.opened).toEqual(["https://daigou.example/rush/abc"]);
  });
});
