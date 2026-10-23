-- 對單：每個品項記「代購確認買到幾件」
ALTER TABLE "PurchaseBatchItem" ADD COLUMN "confirmedQty" INTEGER NOT NULL DEFAULT 0;
-- 已確認的團：沒砍的全部算買到；未確認的團：維持待確認
UPDATE "PurchaseBatchItem" i SET "confirmedQty" = GREATEST(0, i."qty" - i."cancelledQty")
FROM "PurchaseBatch" b WHERE b."id" = i."batchId" AND b."confirmed" = true;
