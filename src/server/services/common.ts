import type { Tx } from "@/server/db";
import { Prisma } from "@prisma/client";

export interface Actor {
  userId: string | null;
}

export const SYSTEM: Actor = { userId: null };

/** 遞增流水號（同一交易內原子更新） */
export async function nextSeq(t: Tx, key: string): Promise<number> {
  const rows = await t.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = "Counter".value + 1
    RETURNING value`;
  return Number(rows[0].value);
}

function ymd(d = new Date()): string {
  // 以台北時區產生日期碼
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "2-digit", month: "2-digit", day: "2-digit" }).format(d);
  return s.replace(/-/g, "");
}

export async function nextCode(t: Tx, kind: "product" | "buyer" | "order" | "groupbuy" | "batch" | "shipment"): Promise<string> {
  switch (kind) {
    case "product":
      return `P${String(await nextSeq(t, "product")).padStart(4, "0")}`;
    case "buyer":
      return `B${String(await nextSeq(t, "buyer")).padStart(4, "0")}`;
    case "groupbuy":
      return `G${String(await nextSeq(t, "groupbuy")).padStart(3, "0")}`;
    case "batch":
      return `PB${String(await nextSeq(t, "batch")).padStart(3, "0")}`;
    case "order": {
      const d = ymd();
      return `O${d}-${String(await nextSeq(t, `order:${d}`)).padStart(3, "0")}`;
    }
    case "shipment": {
      const d = ymd();
      return `S${d}-${String(await nextSeq(t, `shipment:${d}`)).padStart(3, "0")}`;
    }
  }
}

export async function audit(t: Tx, actor: Actor, action: string, entity: string, entityId: string | null, data?: unknown) {
  await t.auditLog.create({
    data: {
      actorId: actor.userId,
      action,
      entity,
      entityId,
      data: data === undefined ? undefined : (JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue),
    },
  });
}

export function emptyToNull(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t === "" ? null : t;
}
