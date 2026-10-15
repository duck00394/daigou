-- AlterEnum
ALTER TYPE "MovementKind" ADD VALUE 'KEEP';

-- AlterTable
ALTER TABLE "PurchaseBatch" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "expectedAt" DATE,
ADD COLUMN     "orderUrl" TEXT,
ADD COLUMN     "supplierOrderNo" TEXT;

-- AlterTable
ALTER TABLE "PurchaseBatchItem" ADD COLUMN     "cancelReason" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "kind" TEXT,
ADD COLUMN     "orderUrl" TEXT,
ADD COLUMN     "paymentMethod" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseBatch" ADD CONSTRAINT "PurchaseBatch_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

