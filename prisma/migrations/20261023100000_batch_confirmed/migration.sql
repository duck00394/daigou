-- AlterTable
ALTER TABLE "PurchaseBatch" ADD COLUMN     "confirmed" BOOLEAN NOT NULL DEFAULT false;


-- 既有的團都已經在進行中，先當作已確認；之後新開的團預設未確認
UPDATE "PurchaseBatch" SET "confirmed" = true;
