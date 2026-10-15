// 對測試資料庫套用 migration：npm run db:test:prepare
import { execSync } from "node:child_process";
const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";
if (!/test/.test(url)) {
  console.error("TEST_DATABASE_URL 的資料庫名稱必須含有 test，避免誤用正式資料庫");
  process.exit(1);
}
execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
