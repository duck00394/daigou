-- AlterTable
ALTER TABLE "PurchaseBatchItem" ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseBatchItem_categoryId_idx" ON "PurchaseBatchItem"("categoryId");

-- AddForeignKey
ALTER TABLE "PurchaseBatchItem" ADD CONSTRAINT "PurchaseBatchItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

