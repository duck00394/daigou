-- 客人的販售平台；用他最近一筆有填平台的單帶入
ALTER TABLE "Buyer" ADD COLUMN "salesChannel" TEXT;
UPDATE "Buyer" b SET "salesChannel" = o."salesChannel"
FROM (SELECT DISTINCT ON ("buyerId") "buyerId", "salesChannel" FROM "Order" WHERE "salesChannel" IS NOT NULL ORDER BY "buyerId", "createdAt" DESC) o
WHERE o."buyerId" = b."id";
