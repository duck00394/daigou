import { BizError, type Tx } from "@/server/db";
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

/**
 * 一次性請求識別碼：在同一個交易內登記，成功提交後同一碼不能再執行。
 * 兩個相同請求同時送出時，第二個會等第一個交易結束；第一個成功就判定為重複，失敗則可重新執行。
 */
export async function claimRequest(t: Tx, key: string | null | undefined, scope: string) {
  if (!key) return;
  if (key.length < 8 || key.length > 120) throw new BizError("送出識別碼格式不正確");
  const rows = await t.$queryRaw<{ key: string }[]>`
    INSERT INTO "RequestKey" ("key") VALUES (${`${scope}:${key}`}) ON CONFLICT DO NOTHING RETURNING "key"`;
  if (rows.length === 0) throw new BizError("這個操作剛剛已經完成，沒有重複執行");
}
