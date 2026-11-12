-- 訂金改成每個角色自己設：原本整個系列的每件訂金，搬到這個系列每個角色
ALTER TABLE "ShopQuota" ADD COLUMN "deposit" INTEGER;
UPDATE "ShopQuota" q SET "deposit" = c."depositPerItem" FROM "ShopCategory" c WHERE c."categoryId" = q."categoryId" AND c."depositPerItem" IS NOT NULL;
ALTER TABLE "ShopCategory" DROP COLUMN "depositPerItem";
