-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BatchCostKind" ADD VALUE 'AGENT_FEE';
ALTER TYPE "BatchCostKind" ADD VALUE 'TW_DOMESTIC_SHIPPING';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "variantKey" TEXT;

-- AlterTable
ALTER TABLE "PurchaseBatch" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
-- 保留既有日幣成本：改名為預估單價，幣別預設 JPY
ALTER TABLE "PurchaseBatchItem" RENAME COLUMN "unitCostJpy" TO "estUnitCost";
ALTER TABLE "PurchaseBatchItem" ADD COLUMN     "actualUnitCost" INTEGER,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'JPY',
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "salePriceTwd" INTEGER,
ADD COLUMN     "specNote" TEXT;

-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeriesCharacter" (
    "seriesId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SeriesCharacter_pkey" PRIMARY KEY ("seriesId","characterId")
);

-- CreateTable
CREATE TABLE "SeriesTemplate" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productTypeId" TEXT,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeriesTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'JPY',
    "contact" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Series_name_key" ON "Series"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesTemplate_seriesId_name_key" ON "SeriesTemplate"("seriesId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_variantKey_key" ON "Product"("variantKey");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseBatchItem_dedupeKey_key" ON "PurchaseBatchItem"("dedupeKey");

-- AddForeignKey
ALTER TABLE "SeriesCharacter" ADD CONSTRAINT "SeriesCharacter_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesCharacter" ADD CONSTRAINT "SeriesCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesTemplate" ADD CONSTRAINT "SeriesTemplate_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBatch" ADD CONSTRAINT "PurchaseBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 把舊版文字欄位轉成正式資料（系列、供應商）
INSERT INTO "Series" ("id", "name", "updatedAt")
SELECT 'sr_' || md5("series"), "series", CURRENT_TIMESTAMP FROM "Product"
WHERE "series" IS NOT NULL AND btrim("series") <> '' GROUP BY "series"
ON CONFLICT ("name") DO NOTHING;
UPDATE "Product" p SET "seriesId" = s."id" FROM "Series" s WHERE p."series" = s."name" AND p."seriesId" IS NULL;

INSERT INTO "Supplier" ("id", "name", "updatedAt")
SELECT 'sp_' || md5("supplier"), "supplier", CURRENT_TIMESTAMP FROM "PurchaseBatch"
WHERE "supplier" IS NOT NULL AND btrim("supplier") <> '' GROUP BY "supplier"
ON CONFLICT ("name") DO NOTHING;
UPDATE "PurchaseBatch" b SET "supplierId" = s."id" FROM "Supplier" s WHERE b."supplier" = s."name" AND b."supplierId" IS NULL;
