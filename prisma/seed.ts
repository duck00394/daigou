// 預設資料：分類、標籤、商品類型、角色、預設匯率。不建立任何假訂單或假買家。
// 可重複執行，已存在的名稱會略過。
import { PrismaClient } from "@prisma/client";

const raw = process.env.DATABASE_URL ?? "";
const url = /-pooler\./.test(raw) && !/pgbouncer=/.test(raw) ? raw + (raw.includes("?") ? "&" : "?") + "pgbouncer=true" : raw;
const prisma = new PrismaClient({ datasourceUrl: url });

async function main() {
  const categories: [string, "FESTIVAL" | "REGION" | "STORE_LIMITED" | "ICHIBAN" | "SERIES" | "GENERAL"][] = [
    ["萬聖節", "FESTIVAL"],
    ["聖誕節", "FESTIVAL"],
    ["上海限定", "REGION"],
    ["日本限定", "REGION"],
    ["日本店舖限定", "STORE_LIMITED"],
    ["一番賞", "ICHIBAN"],
    ["吉伊樂園", "SERIES"],
  ];
  for (const [name, type] of categories) await prisma.category.upsert({ where: { name }, update: {}, create: { name, type } });

  const types = ["吊娃", "S 娃", "扭蛋", "景品", "一番賞", "壓克力吊飾", "文具", "其他"];
  for (const [i, name] of types.entries()) await prisma.productType.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });

  const chars = ["吉伊", "小八", "兔兔", "栗子饅頭", "飛鼠", "獅薩"];
  for (const [i, name] of chars.entries()) await prisma.character.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });

  const tags: [string, string, "RISK" | "POSITIVE" | "OPERATION", boolean][] = [
    ["奧客", "#b42318", "RISK", true],
    ["問題很多", "#c2410c", "RISK", false],
    ["建議不接", "#7f1d1d", "RISK", true],
    ["經常改單", "#a16207", "RISK", false],
    ["曾逾期付款", "#b45309", "RISK", true],
    ["曾取消訂單", "#92400e", "RISK", false],
    ["退款爭議", "#9f1239", "RISK", true],
    ["優良常客", "#15803d", "POSITIVE", false],
    ["可併單", "#2f4b7c", "OPERATION", false],
    ["只收現貨", "#475569", "OPERATION", true],
    ["急單", "#be185d", "OPERATION", true],
  ];
  for (const [name, color, kind, warnOnOrder] of tags) await prisma.tag.upsert({ where: { name }, update: {}, create: { name, color, kind, warnOnOrder } });

  await prisma.appSetting.upsert({ where: { key: "defaultRateMicro" }, update: {}, create: { key: "defaultRateMicro", value: "210000" } });
  console.log("預設資料已建立");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
