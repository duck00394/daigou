-- 候補可以在後台手動調整順位：排隊順序改用 sortAt（原本的排入時間保留在 createdAt）
ALTER TABLE "ShopWait" ADD COLUMN "sortAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "ShopWait" SET "sortAt" = "createdAt";
DROP INDEX IF EXISTS "ShopWait_categoryId_productId_status_createdAt_idx";
CREATE INDEX "ShopWait_categoryId_productId_status_sortAt_idx" ON "ShopWait"("categoryId", "productId", "status", "sortAt");
