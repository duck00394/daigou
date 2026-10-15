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
