"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { prisma, tx } from "@/server/db";
import { rushDeps } from "@/server/push";
import * as rs from "@/server/services/rush";

const input = z.object({
  supplierId: z.string().nullish(),
  supplierName: z.string().max(100),
  categoryId: z.string().nullish(),
  seriesName: z.string().max(200),
  date: z.string().max(10),
  time: z.string().max(5),
  url: z.string().max(1000).nullish(),
  notes: z.string().max(2000).nullish(),
  notify: z.boolean(),
  leadMinutes: z.number().int(),
});

const view = (e: { id: string; scheduleState: string; scheduleError: string | null; notifyAt: Date | null }) => ({ id: e.id, scheduleState: e.scheduleState, scheduleError: e.scheduleError, notifyAt: e.notifyAt?.toISOString() ?? null });

export async function saveRushAction(id: string | null, form: z.infer<typeof input>) {
  return run(async (a) => {
    const f = input.parse(form);
    const deps = rushDeps();
    const ev = id ? (await tx((t) => rs.updateRush(t, a, id, f))).ev : await tx((t) => rs.createRush(t, a, f));
    const s = await rs.scheduleRush(prisma, deps, ev.id);
    return view(s!);
  });
}

export async function setRushStatusAction(id: string, status: "UPCOMING" | "BOUGHT" | "MISSED" | "CANCELLED") {
  return run(async (a) => {
    await tx((t) => rs.setRushStatus(t, a, z.string().parse(id), z.enum(["UPCOMING", "BOUGHT", "MISSED", "CANCELLED"]).parse(status)));
    const s = await rs.scheduleRush(prisma, rushDeps(), id);
    return view(s!);
  });
}

export async function deleteRushAction(id: string) {
  return run(async (a) => {
    const { messageId } = await tx((t) => rs.deleteRush(t, a, z.string().parse(id)));
    await rs.cancelMessage(rushDeps(), messageId);
  });
}

/** 新增前先看同時間有沒有別場 */
export async function rushConflictsAction(date: string, time: string, excludeId: string | null) {
  return run(async () => {
    const { taipeiToUtc } = await import("@/lib/taipei");
    const at = taipeiToUtc(date, time);
    if (!at) return [];
    return (await rs.findConflicts(prisma, at, excludeId)).map((c) => ({ id: c.id, label: `${c.supplierName}・${c.seriesName}`, startAt: c.startAt.toISOString() }));
  }, "read");
}

const subSchema = z.object({ endpoint: z.string().url().max(2000), p256dh: z.string().max(500), auth: z.string().max(200), userAgent: z.string().max(500).nullish() });
export async function savePushSubscriptionAction(sub: z.infer<typeof subSchema>) {
  return run(async () => {
    await rs.saveSubscription(prisma, subSchema.parse(sub));
  });
}
export async function removePushSubscriptionAction(endpoint: string) {
  return run(async () => rs.removeSubscription(prisma, z.string().max(2000).parse(endpoint)));
}
/** 這個網址（這支手機）有沒有在伺服器登記：只回答有沒有，不回傳任何訂閱資料 */
export async function hasPushSubscriptionAction(endpoint: string) {
  return run(async () => !!(await prisma.pushSubscription.findUnique({ where: { endpoint: z.string().max(2000).parse(endpoint) }, select: { id: true } })), "read");
}
export async function testPushAction() {
  return run(async () => {
    const r = await rs.testPush(prisma, rushDeps());
    return { ok: r.ok, failed: r.failed, subs: r.subs, error: r.errors[0] ?? null };
  });
}
