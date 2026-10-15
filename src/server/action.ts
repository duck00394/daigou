// Server Action 共用包裝：驗證登入、統一錯誤格式、不把內部錯誤細節回傳到前端
import "server-only";
import { Prisma } from "@prisma/client";
import { BizError } from "@/server/db";
import { AuthError, can, requireActionUser, type Permission } from "@/server/auth";
import type { Actor } from "@/server/services/common";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; auth?: boolean };

export async function run<T>(fn: (actor: Actor) => Promise<T>, perm: Permission = "write"): Promise<ActionResult<T>> {
  try {
    const user = await requireActionUser();
    if (!can(user, perm)) return { ok: false, error: "沒有執行這個操作的權限" };
    const data = await fn({ userId: user.id });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message, auth: true };
    if (e instanceof BizError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return { ok: false, error: "資料重複，可能已經建立過了" };
      if (e.code === "P2025") return { ok: false, error: "找不到資料，可能已被刪除，請重新整理" };
      if (e.code === "P2003") return { ok: false, error: "資料仍被其他紀錄引用，無法執行" };
      if (e.code === "P2028") return { ok: false, error: "處理逾時，請稍後再試" };
    }
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error("[action error]", e);
    return { ok: false, error: "系統發生錯誤，操作未完成，請稍後再試" };
  }
}
