// 以 pg_dump 備份資料庫到 backups/（需要電腦上有安裝 PostgreSQL 用戶端工具）
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

let url = process.env.DATABASE_URL;
if (!url && existsSync(".env")) {
  const m = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(".env", "utf8"));
  url = m?.[1];
}
if (!url) {
  console.error("找不到 DATABASE_URL");
  process.exit(1);
}
mkdirSync("backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const file = `backups/daigou-${stamp}.dump`;
try {
  execFileSync("pg_dump", [url, "-Fc", "-f", file], { stdio: "inherit" });
  console.log(`已備份到 ${file}`);
} catch {
  console.error("pg_dump 執行失敗。請確認已安裝 PostgreSQL 用戶端工具，或改用 APP 內的「下載完整備份」。");
  process.exit(1);
}
