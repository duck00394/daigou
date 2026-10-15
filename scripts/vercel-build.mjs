// Vercel 建置：產生 Prisma Client → 套用 migration → 建立預設資料（可重複執行）→ 建置 Next.js
// Neon 整合會提供 DATABASE_URL（連線池）與 DATABASE_URL_UNPOOLED（直連），migration 使用直連網址。
import { execSync } from "node:child_process";
const env = { ...process.env, DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL };
if (!env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL，請先在 Vercel 連接資料庫");
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });
run("npx prisma generate");
run("npx prisma migrate deploy");
run("npx tsx prisma/seed.ts");
run("npx next build");
