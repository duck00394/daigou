-- CreateEnum
CREATE TYPE "ShopWaitStatus" AS ENUM ('WAITING', 'FILLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Buyer" ADD COLUMN     "linePicture" TEXT,
ADD COLUMN     "lineUserId" TEXT;

-- AlterTable
ALTER TABLE "Operator" ADD COLUMN     "lineUserId" TEXT;

-- CreateTable
CREATE TABLE "ShopCategory" (
    "categoryId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "openAt" TIMESTAMP(3),
    "perPersonLimit" INTEGER,
    "ownerId" TEXT,
    "imageUrl" TEXT,
    "intro" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCategory_pkey" PRIMARY KEY ("categoryId")
);

-- CreateTable
CREATE TABLE "ShopQuota" (
    "categoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quota" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopQuota_pkey" PRIMARY KEY ("categoryId","productId")
);

-- CreateTable
CREATE TABLE "ShopWait" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" "ShopWaitStatus" NOT NULL DEFAULT 'WAITING',
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopWait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineOutbox" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopQuota_productId_idx" ON "ShopQuota"("productId");

-- CreateIndex
CREATE INDEX "ShopWait_categoryId_productId_status_createdAt_idx" ON "ShopWait"("categoryId", "productId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ShopWait_buyerId_idx" ON "ShopWait"("buyerId");

-- CreateIndex
CREATE INDEX "LineOutbox_sentAt_createdAt_idx" ON "LineOutbox"("sentAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_lineUserId_key" ON "Buyer"("lineUserId");

-- AddForeignKey
ALTER TABLE "ShopCategory" ADD CONSTRAINT "ShopCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopCategory" ADD CONSTRAINT "ShopCategory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopQuota" ADD CONSTRAINT "ShopQuota_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopQuota" ADD CONSTRAINT "ShopQuota_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopWait" ADD CONSTRAINT "ShopWait_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopWait" ADD CONSTRAINT "ShopWait_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

