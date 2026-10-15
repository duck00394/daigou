import { currentUser, can } from "@/server/auth";
import { createBackup } from "@/server/services/backup";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const user = await currentUser();
  if (!user || !can(user, "admin")) return new Response("未登入", { status: 401 });
  const b = await createBackup();
  await prisma.auditLog.create({ data: { actorId: user.id, action: "backup.download", entity: "System", data: { counts: b.counts } } });
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(/[^\d]/g, "");
  return new Response(JSON.stringify(b), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="daigou-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
