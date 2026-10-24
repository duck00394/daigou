-- 合資：每件是誰的、一起的怎麼分、運費怎麼分、兩人之間轉過的錢（舊的合資團：全部算一起的、平均分）
-- AlterTable
ALTER TABLE "PurchaseBatch" ADD COLUMN     "feeSplit" TEXT NOT NULL DEFAULT 'HALF',
ADD COLUMN     "jointSplit" JSONB,
ADD COLUMN     "jointTransfers" JSONB;

-- AlterTable
ALTER TABLE "PurchaseBatchItem" ADD COLUMN     "ownerId" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseBatchItem" ADD CONSTRAINT "PurchaseBatchItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

