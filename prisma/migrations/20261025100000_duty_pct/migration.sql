-- 關稅 %：整團預設、單件另填，自動算出一筆關稅費用（只新增欄位）
-- AlterTable
ALTER TABLE "BatchCost" ADD COLUMN     "autoDuty" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PurchaseBatch" ADD COLUMN     "dutyBp" INTEGER;

-- AlterTable
ALTER TABLE "PurchaseBatchItem" ADD COLUMN     "dutyBp" INTEGER;

