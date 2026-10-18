-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "favorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CategoryTypePrice" (
    "categoryId" TEXT NOT NULL,
    "productTypeId" TEXT NOT NULL,
    "salePriceTwd" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryTypePrice_pkey" PRIMARY KEY ("categoryId","productTypeId")
);

-- AddForeignKey
ALTER TABLE "CategoryTypePrice" ADD CONSTRAINT "CategoryTypePrice_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryTypePrice" ADD CONSTRAINT "CategoryTypePrice_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

