"use server";
import { run } from "@/server/action";
import { BizError } from "@/server/db";
import { restoreBackup, verifyBackup } from "@/server/services/backup";
import { logoutAllSessions, requireActionUser } from "@/server/auth";

const MAX_BACKUP = 200 * 1024 * 1024;

async function readBackup(fd: FormData) {
  const f = fd.get("file");
  if (!(f instanceof File)) throw new BizError("請選擇備份檔");
  if (f.size > MAX_BACKUP) throw new BizError("備份檔過大");
  if (!f.name.toLowerCase().endsWith(".json")) throw new BizError("備份檔必須是 .json");
  try {
    return JSON.parse(await f.text());
  } catch {
    throw new BizError("備份檔不是有效的 JSON");
  }
}

export async function verifyBackupAction(fd: FormData) {
  return run(async () => {
    const b = verifyBackup(await readBackup(fd));
    return { createdAt: b.createdAt, counts: b.counts, schemaVersion: b.schemaVersion };
  }, "admin");
}

export async function restoreBackupAction(fd: FormData) {
  return run(async (a) => {
    const wipe = fd.get("wipe") === "1";
    if (wipe && fd.get("confirm") !== "清空後還原") throw new BizError("請輸入確認文字");
    return restoreBackup(a, await readBackup(fd), { wipe });
  }, "admin");
}

export async function logoutAllAction() {
  return run(async () => {
    const u = await requireActionUser();
    await logoutAllSessions(u.id);
  }, "admin");
}

/** 資料健康檢查（唯讀） */
export async function checkIntegrityAction() {
  return run(async () => {
    const { checkIntegrity } = await import("@/server/services/integrity");
    const { prisma } = await import("@/server/db");
    return checkIntegrity(prisma);
  }, "read");
}

/** 重算衍生欄位（採購團狀態、訂單快取），不改動流水；之後再檢查一次 */
export async function recomputeDerivedAction() {
  return run(async (a) => {
    const { recomputeDerived, checkIntegrity } = await import("@/server/services/integrity");
    const { prisma, tx } = await import("@/server/db");
    const { audit } = await import("@/server/services/common");
    const r = await tx(async (t) => {
      const res = await recomputeDerived(t);
      await audit(t, a, "system.recomputeDerived", "System", null, res);
      return res;
    }, { timeout: 120_000 });
    return { ...r, issues: await checkIntegrity(prisma) };
  }, "admin");
}
