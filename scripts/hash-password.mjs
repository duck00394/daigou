// 產生管理者密碼的雜湊值：node scripts/hash-password.mjs "你的密碼"
import bcrypt from "bcryptjs";
const pw = process.argv[2];
if (!pw || pw.length < 8) {
  console.error("請提供至少 8 個字元的密碼：node scripts/hash-password.mjs \"你的密碼\"");
  process.exit(1);
}
const hash = await bcrypt.hash(pw, 12);
console.log(hash);
console.log("\n本機 .env 請貼上這一行（$ 需要加反斜線，否則會被當成變數）：");
console.log(`ADMIN_PASSWORD_HASH="${hash.replace(/\$/g, "\\$")}"`);
console.log("\n在 Vercel 等平台的環境變數設定畫面，直接貼上原始雜湊值即可（不需要反斜線）。");
