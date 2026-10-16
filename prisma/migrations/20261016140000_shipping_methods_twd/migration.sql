-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "defaultCurrency" SET DEFAULT 'TWD';

-- CreateTable
CREATE TABLE "ShippingMethod" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BatchCostKind" NOT NULL DEFAULT 'TW_DOMESTIC_SHIPPING',
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "amount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingMethod_name_key" ON "ShippingMethod"("name");


-- 使用者確認：所有代購先預設台幣（只改「預設幣別」，已建立的採購團、品項與金額都不變）
UPDATE "Supplier" SET "defaultCurrency" = 'TWD' WHERE "defaultCurrency" <> 'TWD';
