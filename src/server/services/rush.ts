// 搶購提醒：記下哪個代購、什麼時候開始、搶什麼；開始前幾分鐘推播到手機。
// 排程規則：
// - 每次改時間、改提前幾分鐘、開關通知、標記結束，都把 version +1；排程觸發時版本對不上就不發（舊通知不會響）。
// - 觸發時再查一次資料：已刪除、已取消、已結束、關掉通知的都不發。
// - 同一場同一版只送一次（RushDelivery 唯一鍵）；全部手機都送失敗才讓排程服務重試。
// - 排程服務最多只能預約 7 天：更久的先預約 6 天後「接力」，到時再排下一段。
// - 已經過了通知時間（或已開始）不偷偷補發，畫面顯示「來不及通知」。
import { BizError, isUniqueViolation, type Db, type Tx } from "@/server/db";
import { audit, emptyToNull, type Actor } from "./common";
import { taipeiParts, taipeiToUtc } from "@/lib/taipei";
import type { PushSub, RushDeps } from "@/server/push";

export const LEADS = [5, 10, 15, 30, 60] as const;
export const MAX_HOP_MS = 6 * 864e5; // 排程服務單次最多 7 天，留一天緩衝
const NEAR_MS = 10 * 60000; // 前後 10 分鐘內算「時間衝突」

export interface RushInput {
  supplierId?: string | null;
  supplierName: string;
  categoryId?: string | null;
  seriesName: string;
  date: string; // 台灣時間 YYYY-MM-DD
  time: string; // 台灣時間 HH:MM
  url?: string | null;
  notes?: string | null;
  notify?: boolean;
  leadMinutes?: number;
}

function parse(input: RushInput) {
  const supplierName = input.supplierName?.trim();
  const seriesName = input.seriesName?.trim();
  if (!supplierName) throw new BizError("請填代購團（選一個或直接打字）");
  if (!seriesName) throw new BizError("請填要搶的系列或商品");
  if (supplierName.length > 100 || seriesName.length > 200) throw new BizError("名稱太長");
  const startAt = taipeiToUtc(input.date, input.time);
  if (!startAt) throw new BizError("請填正確的日期和開始時間");
  const url = emptyToNull(input.url);
  if (url && !/^https?:\/\//i.test(url)) throw new BizError("搶購網址請以 http:// 或 https:// 開頭");
  const lead = input.leadMinutes ?? 5;
  if (!(LEADS as readonly number[]).includes(lead)) throw new BizError("提前通知的時間不正確");
  return { supplierId: input.supplierId || null, supplierName, categoryId: input.categoryId || null, seriesName, startAt, url, notes: emptyToNull(input.notes), notify: input.notify ?? true, leadMinutes: lead };
}

export async function createRush(t: Tx, actor: Actor, input: RushInput) {
  const data = parse(input);
  const ev = await t.rushEvent.create({ data: { ...data, notifyAt: data.notify ? new Date(data.startAt.getTime() - data.leadMinutes * 60000) : null } });
  await audit(t, actor, "rush.create", "RushEvent", ev.id, { start: data.startAt, supplier: data.supplierName });
  return ev;
}

export async function updateRush(t: Tx, actor: Actor, id: string, input: RushInput) {
  const before = await t.rushEvent.findUnique({ where: { id } });
  if (!before) throw new BizError("找不到這筆搶購提醒");
  const data = parse(input);
  const timingChanged = before.startAt.getTime() !== data.startAt.getTime() || before.notify !== data.notify || before.leadMinutes !== data.leadMinutes;
  const ev = await t.rushEvent.update({
    where: { id },
    data: { ...data, ...(timingChanged ? { version: { increment: 1 }, sentAt: null } : {}), notifyAt: data.notify ? new Date(data.startAt.getTime() - data.leadMinutes * 60000) : null },
  });
  await audit(t, actor, "rush.update", "RushEvent", id, { timingChanged });
  return { ev, timingChanged };
}

export async function setRushStatus(t: Tx, actor: Actor, id: string, status: "UPCOMING" | "BOUGHT" | "MISSED" | "CANCELLED") {
  const ev = await t.rushEvent.update({ where: { id }, data: { status, version: { increment: 1 } } });
  await audit(t, actor, "rush.status", "RushEvent", id, { status });
  return ev;
}

/** 刪除前先記下排程編號，刪完再取消排程（就算取消失敗，觸發時也找不到這筆，不會發） */
export async function deleteRush(t: Tx, actor: Actor, id: string) {
  const ev = await t.rushEvent.findUnique({ where: { id } });
  if (!ev) return { messageId: null };
  await t.rushEvent.delete({ where: { id } });
  await audit(t, actor, "rush.delete", "RushEvent", id, { supplier: ev.supplierName, series: ev.seriesName });
  return { messageId: ev.messageId };
}

export async function cancelMessage(deps: RushDeps, messageId: string | null | undefined) {
  if (!messageId || !deps.scheduler.configured) return;
  try {
    await deps.scheduler.cancel(messageId);
  } catch {
    // 已經送出或不存在：沒關係，觸發時會因為版本或狀態對不上而不發
  }
}

/** 依目前資料重新排程（新增、修改、標記後都呼叫）；回傳最新狀態 */
export async function scheduleRush(db: Db, deps: RushDeps, id: string, now = new Date()) {
  const ev = await db.rushEvent.findUnique({ where: { id } });
  if (!ev) return null;
  if (ev.messageId) await cancelMessage(deps, ev.messageId);
  const set = (data: { scheduleState: string; scheduleError?: string | null; messageId?: string | null; notifyAt?: Date | null }) =>
    db.rushEvent.update({ where: { id }, data: { scheduleError: null, messageId: null, ...data } });
  if (ev.status !== "UPCOMING" || !ev.notify) return set({ scheduleState: "NONE" });
  const notifyAt = new Date(ev.startAt.getTime() - ev.leadMinutes * 60000);
  if (notifyAt.getTime() <= now.getTime()) {
    return set({
      scheduleState: "TOO_LATE",
      notifyAt,
      scheduleError: ev.startAt.getTime() <= now.getTime() ? "開始時間已經過了，不會通知" : `離開始不到 ${ev.leadMinutes} 分鐘，來不及提前通知`,
    });
  }
  if (!deps.scheduler.configured || !deps.pusher.configured) return set({ scheduleState: "NOT_CONFIGURED", notifyAt, scheduleError: "推播服務還沒設定好（要在 Vercel 加環境變數）" });
  const at = new Date(Math.min(notifyAt.getTime(), now.getTime() + MAX_HOP_MS));
  try {
    const messageId = await deps.scheduler.publish({ eventId: id, version: ev.version, at });
    return set({ scheduleState: "SCHEDULED", notifyAt, messageId });
  } catch (e) {
    return set({ scheduleState: "FAILED", notifyAt, scheduleError: `排程失敗：${(e as Error).message || "排程服務沒有回應"}` });
  }
}

export class RetryableError extends Error {}

const hhmm = (d: Date) => taipeiParts(d).time;

export function rushPayload(ev: { id: string; supplierName: string; seriesName: string; startAt: Date; leadMinutes: number }) {
  return {
    title: `【搶購提醒】再過 ${ev.leadMinutes} 分鐘開始`,
    body: `${ev.supplierName}｜${ev.seriesName}\n開始時間：${hhmm(ev.startAt)}`,
    url: `/rush/${ev.id}`,
    tag: `rush-${ev.id}`,
  };
}

async function sendAll(db: Db, deps: RushDeps, payload: ReturnType<typeof rushPayload>) {
  const subs = await db.pushSubscription.findMany();
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const s of subs) {
    const r = await deps.pusher.send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
    if (r.ok) {
      ok++;
      await db.pushSubscription.update({ where: { id: s.id }, data: { lastOkAt: new Date(), failCount: 0 } });
    } else if (r.gone) {
      await db.pushSubscription.delete({ where: { id: s.id } });
    } else {
      failed++;
      errors.push(r.error);
      await db.pushSubscription.update({ where: { id: s.id }, data: { failCount: { increment: 1 } } });
    }
  }
  return { subs: subs.length, ok, failed, errors };
}

/** 排程時間到：檢查還要不要發，要的話推播到所有開了通知的手機 */
export async function fireRush(db: Db, deps: RushDeps, msg: { eventId: string; version: number }, now = new Date()) {
  const ev = await db.rushEvent.findUnique({ where: { id: msg.eventId } });
  if (!ev) return "gone" as const;
  if (ev.status !== "UPCOMING" || !ev.notify || ev.version !== msg.version) return "stale" as const;
  const notifyAt = new Date(ev.startAt.getTime() - ev.leadMinutes * 60000);
  // 接力：還沒到通知時間（超過 7 天的會分段預約）
  if (notifyAt.getTime() > now.getTime() + 60000) {
    await db.rushEvent.update({ where: { id: ev.id }, data: { messageId: null } });
    await scheduleRush(db, deps, ev.id, now);
    return "rescheduled" as const;
  }
  // 已經開始了：不補發過期的提醒
  if (ev.startAt.getTime() <= now.getTime()) {
    await db.rushEvent.update({ where: { id: ev.id }, data: { scheduleState: "TOO_LATE", scheduleError: "排程延遲，到開始時間才觸發，所以沒有通知" } });
    return "late" as const;
  }
  try {
    await db.rushDelivery.create({ data: { eventId: ev.id, version: ev.version } });
  } catch (e) {
    if (isUniqueViolation(e)) return "duplicate" as const;
    throw e;
  }
  const r = await sendAll(db, deps, rushPayload(ev));
  if (r.subs === 0) {
    await db.rushEvent.update({ where: { id: ev.id }, data: { scheduleState: "FAILED", scheduleError: "沒有任何手機開啟通知" } });
    return "no-subscribers" as const;
  }
  if (r.ok > 0) {
    await db.rushDelivery.update({ where: { eventId_version: { eventId: ev.id, version: ev.version } }, data: { sentOk: r.ok, failed: r.failed } });
    await db.rushEvent.update({ where: { id: ev.id }, data: { scheduleState: "SENT", sentAt: now, scheduleError: r.failed ? `${r.failed} 支手機沒送到` : null, messageId: null } });
    return "sent" as const;
  }
  // 全部失敗：拿掉送出紀錄，讓排程服務重試
  await db.rushDelivery.delete({ where: { eventId_version: { eventId: ev.id, version: ev.version } } });
  await db.rushEvent.update({ where: { id: ev.id }, data: { scheduleState: "FAILED", scheduleError: r.errors[0] ?? "推播失敗" } });
  throw new RetryableError(r.errors[0] ?? "推播失敗");
}

/** 傳一則測試通知到所有開了通知的手機 */
export async function testPush(db: Db, deps: RushDeps) {
  if (!deps.pusher.configured) throw new BizError("推播金鑰還沒設定（要在 Vercel 加環境變數）");
  const r = await sendAll(db, deps, { title: "【測試】搶購提醒", body: "收到這則就代表這支手機的通知設定好了 🎉", url: "/rush", tag: "rush-test" });
  if (!r.subs) throw new BizError("還沒有手機開啟通知");
  return r;
}

export async function saveSubscription(db: Db, sub: PushSub & { userAgent?: string | null }) {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.p256dh || !sub.auth) throw new BizError("通知訂閱資料不完整");
  return db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent ?? null, failCount: 0 },
    create: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent ?? null },
  });
}

export async function removeSubscription(db: Db, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { endpoint } });
}

/** 列表：接下來（還沒開始或今天的）／歷史（已結束、已標記） */
export async function listRush(db: Db, mode: "upcoming" | "history", now = new Date()) {
  const cut = new Date(now.getTime() - 3 * 3600_000); // 開始後 3 小時內還放在「接下來」，方便標記搶到了沒
  const rows = await db.rushEvent.findMany({
    where: mode === "upcoming" ? { status: "UPCOMING", startAt: { gte: cut } } : { OR: [{ status: { not: "UPCOMING" } }, { startAt: { lt: cut } }] },
    orderBy: { startAt: mode === "upcoming" ? "asc" : "desc" },
    take: mode === "upcoming" ? 200 : 100,
  });
  return rows;
}

/** 時間衝突：前後 10 分鐘內還有別場（只看還沒結束的） */
export function conflicts<T extends { id: string; startAt: Date; status: string }>(rows: T[]) {
  const live = rows.filter((r) => r.status === "UPCOMING");
  const out = new Map<string, T[]>();
  for (const a of live) {
    const near = live.filter((b) => b.id !== a.id && Math.abs(b.startAt.getTime() - a.startAt.getTime()) <= NEAR_MS);
    if (near.length) out.set(a.id, near);
  }
  return out;
}

export async function findConflicts(db: Db, startAt: Date, excludeId?: string | null) {
  return db.rushEvent.findMany({
    where: { status: "UPCOMING", id: excludeId ? { not: excludeId } : undefined, startAt: { gte: new Date(startAt.getTime() - NEAR_MS), lte: new Date(startAt.getTime() + NEAR_MS) } },
    select: { id: true, supplierName: true, seriesName: true, startAt: true },
  });
}
