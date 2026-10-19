// 搶購提醒：排程、改時間、取消刪除、重複觸發、來不及、推播失敗重試（用假的排程與推播服務，不會真的發通知）
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb } from "../helpers";
import { createRush, deleteRush, fireRush, scheduleRush, setRushStatus, updateRush, cancelMessage, conflicts, RetryableError, saveSubscription, rushPayload, testPush, MAX_HOP_MS } from "@/server/services/rush";
import type { RushDeps, PushResult } from "@/server/push";
import { taipeiParts, taipeiToUtc, untilText } from "@/lib/taipei";

type Sent = { endpoint: string; title: string; body: string; url: string };
function fakeDeps(opts: { fail?: (endpoint: string) => PushResult | null; configured?: boolean } = {}) {
  const published: { id: string; eventId: string; version: number; at: Date }[] = [];
  const cancelled: string[] = [];
  const sent: Sent[] = [];
  let n = 0;
  const deps: RushDeps = {
    scheduler: {
      configured: opts.configured ?? true,
      publish: async (o) => {
        const id = `msg-${++n}`;
        published.push({ id, ...o });
        return id;
      },
      cancel: async (id) => {
        cancelled.push(id);
      },
    },
    pusher: {
      configured: opts.configured ?? true,
      send: async (sub, p) => {
        const f = opts.fail?.(sub.endpoint);
        if (f) return f;
        sent.push({ endpoint: sub.endpoint, ...p });
        return { ok: true };
      },
    },
  };
  return { deps, published, cancelled, sent };
}

const NOW = new Date("2026-10-19T04:00:00Z"); // 台灣 12:00
const NEAR = new Date("2026-10-24T04:00:00Z"); // 開始前一天多（7 天內，直接排到通知時間）
const base = { supplierName: "A 代購團", seriesName: "吉伊卡哇聖誕節系列", date: "2026-10-25", time: "20:00" };
const sub = (k: string) => saveSubscription(prisma, { endpoint: `https://push.example.com/${k}`, p256dh: "p", auth: "a" });

describe("搶購提醒", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("台灣時間：輸入 20:00 存成 UTC 12:00，顯示回來還是 20:00；不存在的日期擋下來", () => {
    const d = taipeiToUtc("2026-10-25", "20:00")!;
    expect(d.toISOString()).toBe("2026-10-25T12:00:00.000Z");
    expect(taipeiParts(d)).toEqual({ date: "2026-10-25", time: "20:00" });
    expect(taipeiToUtc("2026-02-30", "20:00")).toBeNull();
    expect(taipeiToUtc("2026-10-25", "24:00")).toBeNull();
    expect(untilText(new Date(NOW.getTime() + 85 * 60000), NOW)).toBe("還有 1 小時 25 分");
  });

  it("必填欄位：代購、系列、日期時間；網址要 http(s)", async () => {
    await expect(tx((t) => createRush(t, actor, { ...base, supplierName: " " }))).rejects.toThrow("代購團");
    await expect(tx((t) => createRush(t, actor, { ...base, seriesName: "" }))).rejects.toThrow("系列");
    await expect(tx((t) => createRush(t, actor, { ...base, time: "" }))).rejects.toThrow("日期");
    await expect(tx((t) => createRush(t, actor, { ...base, url: "line://x" }))).rejects.toThrow("網址");
  });

  it("開始前 5 分鐘排程；觸發後推播到每支手機，內容正確、點了打開那一筆", async () => {
    const f = fakeDeps();
    await sub("a");
    await sub("b");
    const ev = await tx((t) => createRush(t, actor, base));
    const s = await scheduleRush(prisma, f.deps, ev.id, NEAR);
    expect(s!.scheduleState).toBe("SCHEDULED");
    expect(f.published[0].at.toISOString()).toBe("2026-10-25T11:55:00.000Z"); // 台灣 19:55
    const r = await fireRush(prisma, f.deps, { eventId: ev.id, version: 1 }, new Date("2026-10-25T11:55:00Z"));
    expect(r).toBe("sent");
    expect(f.sent).toHaveLength(2);
    expect(f.sent[0]).toMatchObject({ title: "【搶購提醒】再過 5 分鐘開始", body: "A 代購團｜吉伊卡哇聖誕節系列\n開始時間：20:00", url: `/rush/${ev.id}` });
    expect((await prisma.rushEvent.findUniqueOrThrow({ where: { id: ev.id } })).scheduleState).toBe("SENT");
  });

  it("同一場重複觸發只送一次", async () => {
    const f = fakeDeps();
    await sub("a");
    const ev = await tx((t) => createRush(t, actor, base));
    await scheduleRush(prisma, f.deps, ev.id, NOW);
    const at = new Date("2026-10-25T11:55:00Z");
    const [a, b] = await Promise.all([fireRush(prisma, f.deps, { eventId: ev.id, version: 1 }, at), fireRush(prisma, f.deps, { eventId: ev.id, version: 1 }, at)]);
    expect([a, b].sort()).toEqual(["duplicate", "sent"]);
    expect(await fireRush(prisma, f.deps, { eventId: ev.id, version: 1 }, at)).toBe("duplicate");
    expect(f.sent).toHaveLength(1);
  });

  it("改時間：舊排程取消、舊的觸發不會發，新時間重新排程", async () => {
    const f = fakeDeps();
    await sub("a");
    const ev = await tx((t) => createRush(t, actor, base));
    await scheduleRush(prisma, f.deps, ev.id, NEAR);
    await tx((t) => updateRush(t, actor, ev.id, { ...base, time: "21:00" }));
    await scheduleRush(prisma, f.deps, ev.id, NEAR);
    expect(f.cancelled).toEqual(["msg-1"]);
    expect(f.published[1]).toMatchObject({ version: 2 });
    expect(f.published[1].at.toISOString()).toBe("2026-10-25T12:55:00.000Z");
    // 舊的排程（版本 1）就算還是被觸發，也不會發
    expect(await fireRush(prisma, f.deps, { eventId: ev.id, version: 1 }, new Date("2026-10-25T11:55:00Z"))).toBe("stale");
    expect(f.sent).toHaveLength(0);
    // 只改備註不重新排程版本
    const { timingChanged } = await tx((t) => updateRush(t, actor, ev.id, { ...base, time: "21:00", notes: "限購 2" }));
    expect(timingChanged).toBe(false);
  });

  it("取消、標記結束、關掉這筆通知、刪除：都不會發", async () => {
    const f = fakeDeps();
    await sub("a");
    const at = new Date("2026-10-25T11:55:00Z");
    const a = await tx((t) => createRush(t, actor, base));
    await tx((t) => setRushStatus(t, actor, a.id, "CANCELLED"));
    expect((await scheduleRush(prisma, f.deps, a.id, NOW))!.scheduleState).toBe("NONE");
    expect(await fireRush(prisma, f.deps, { eventId: a.id, version: 1 }, at)).toBe("stale");
    const b = await tx((t) => createRush(t, actor, { ...base, notify: false }));
    expect((await scheduleRush(prisma, f.deps, b.id, NOW))!.scheduleState).toBe("NONE");
    expect(await fireRush(prisma, f.deps, { eventId: b.id, version: 1 }, at)).toBe("stale");
    const c = await tx((t) => createRush(t, actor, base));
    await scheduleRush(prisma, f.deps, c.id, NOW);
    const { messageId } = await tx((t) => deleteRush(t, actor, c.id));
    await cancelMessage(f.deps, messageId);
    expect(f.cancelled).toContain(messageId);
    expect(await fireRush(prisma, f.deps, { eventId: c.id, version: 1 }, at)).toBe("gone");
    expect(f.sent).toHaveLength(0);
  });

  it("來不及：已經過了或不到 5 分鐘，不排程、不偷偷補發；排程延遲到開始後才觸發也不發", async () => {
    const f = fakeDeps();
    await sub("a");
    const past = await tx((t) => createRush(t, actor, { ...base, date: "2026-10-19", time: "11:00" }));
    expect(await scheduleRush(prisma, f.deps, past.id, NOW)).toMatchObject({ scheduleState: "TOO_LATE", scheduleError: "開始時間已經過了，不會通知" });
    const soon = await tx((t) => createRush(t, actor, { ...base, date: "2026-10-19", time: "12:03" }));
    expect(await scheduleRush(prisma, f.deps, soon.id, NOW)).toMatchObject({ scheduleState: "TOO_LATE" });
    expect(f.published).toHaveLength(0);
    const ev = await tx((t) => createRush(t, actor, base));
    await scheduleRush(prisma, f.deps, ev.id, NOW);
    expect(await fireRush(prisma, f.deps, { eventId: ev.id, version: 1 }, new Date("2026-10-25T12:01:00Z"))).toBe("late");
    expect(f.sent).toHaveLength(0);
  });

  it("超過 7 天：先預約 6 天後接力，到時再排下一段，最後準時發", async () => {
    const f = fakeDeps();
    await sub("a");
    const ev = await tx((t) => createRush(t, actor, { ...base, date: "2026-11-20" }));
    await scheduleRush(prisma, f.deps, ev.id, NOW);
    expect(f.published[0].at.getTime()).toBe(NOW.getTime() + MAX_HOP_MS);
    const hop = f.published[0].at;
    expect(await fireRush(prisma, f.deps, { eventId: ev.id, version: 1 }, hop)).toBe("rescheduled");
    expect(f.published).toHaveLength(2);
    expect(f.sent).toHaveLength(0);
  });

  it("推播失敗：全部失敗讓排程重試、重試成功只送一次；失效的手機自動移除", async () => {
    let down = true;
    const f = fakeDeps({ fail: (e) => (e.endsWith("/gone") ? { ok: false, gone: true, error: "410" } : down ? { ok: false, gone: false, error: "推播失敗（500）" } : null) });
    await sub("a");
    await sub("gone");
    const ev = await tx((t) => createRush(t, actor, base));
    await scheduleRush(prisma, f.deps, ev.id, NOW);
    const at = new Date("2026-10-25T11:55:00Z");
    await expect(fireRush(prisma, f.deps, { eventId: ev.id, version: 1 }, at)).rejects.toBeInstanceOf(RetryableError);
    expect(await prisma.pushSubscription.count()).toBe(1); // 失效的被移除
    expect((await prisma.rushEvent.findUniqueOrThrow({ where: { id: ev.id } })).scheduleState).toBe("FAILED");
    down = false;
    expect(await fireRush(prisma, f.deps, { eventId: ev.id, version: 1 }, new Date(at.getTime() + 30000))).toBe("sent");
    expect(f.sent).toHaveLength(1);
  });

  it("沒設定推播服務：顯示還沒設定，不假裝排好；排程服務壞掉顯示失敗", async () => {
    const off = fakeDeps({ configured: false });
    const ev = await tx((t) => createRush(t, actor, base));
    expect((await scheduleRush(prisma, off.deps, ev.id, NOW))!.scheduleState).toBe("NOT_CONFIGURED");
    const broken = fakeDeps();
    broken.deps.scheduler.publish = async () => Promise.reject(new Error("連不上"));
    expect(await scheduleRush(prisma, broken.deps, ev.id, NOW)).toMatchObject({ scheduleState: "FAILED", scheduleError: "排程失敗：連不上" });
    await expect(testPush(prisma, broken.deps)).rejects.toThrow("還沒有手機");
  });

  it("時間衝突：前後 10 分鐘內有別場就標出來", async () => {
    const a = await tx((t) => createRush(t, actor, base));
    const b = await tx((t) => createRush(t, actor, { ...base, supplierName: "頑皮喵", time: "20:05" }));
    await tx((t) => createRush(t, actor, { ...base, supplierName: "砂糖", time: "21:00" }));
    const m = conflicts(await prisma.rushEvent.findMany());
    expect([...m.keys()].sort()).toEqual([a.id, b.id].sort());
    expect(rushPayload(a).url).toBe(`/rush/${a.id}`);
  });
});
