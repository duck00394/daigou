-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('PENDING', 'PAID', 'VOIDED');

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "receivingLineId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseBatch" ADD COLUMN     "orderedById" TEXT,
ADD COLUMN     "paymentResponsibleById" TEXT,
ADD COLUMN     "receivingResponsibleById" TEXT,
ADD COLUMN     "responsibilityNote" TEXT;

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "rateMicro" INTEGER,
    "method" TEXT,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'PAID',
    "reference" TEXT,
    "purpose" TEXT,
    "note" TEXT,
    "dedupeKey" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivingRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceivingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivingLine" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "batchItemId" TEXT NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "defectQty" INTEGER NOT NULL DEFAULT 0,
    "missingQty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "ReceivingLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Operator_code_key" ON "Operator"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_dedupeKey_key" ON "SupplierPayment"("dedupeKey");

-- CreateIndex
CREATE INDEX "SupplierPayment_batchId_idx" ON "SupplierPayment"("batchId");

-- CreateIndex
CREATE INDEX "SupplierPayment_paidById_idx" ON "SupplierPayment"("paidById");

-- CreateIndex
CREATE INDEX "SupplierPayment_paidAt_idx" ON "SupplierPayment"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivingRecord_dedupeKey_key" ON "ReceivingRecord"("dedupeKey");

-- CreateIndex
CREATE INDEX "ReceivingRecord_batchId_idx" ON "ReceivingRecord"("batchId");

-- CreateIndex
CREATE INDEX "ReceivingRecord_receivedById_idx" ON "ReceivingRecord"("receivedById");

-- CreateIndex
CREATE INDEX "ReceivingLine_recordId_idx" ON "ReceivingLine"("recordId");

-- CreateIndex
CREATE INDEX "ReceivingLine_batchItemId_idx" ON "ReceivingLine"("batchItemId");

-- AddForeignKey
ALTER TABLE "PurchaseBatch" ADD CONSTRAINT "PurchaseBatch_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBatch" ADD CONSTRAINT "PurchaseBatch_paymentResponsibleById_fkey" FOREIGN KEY ("paymentResponsibleById") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBatch" ADD CONSTRAINT "PurchaseBatch_receivingResponsibleById_fkey" FOREIGN KEY ("receivingResponsibleById") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingRecord" ADD CONSTRAINT "ReceivingRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingRecord" ADD CONSTRAINT "ReceivingRecord_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingLine" ADD CONSTRAINT "ReceivingLine_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ReceivingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingLine" ADD CONSTRAINT "ReceivingLine_batchItemId_fkey" FOREIGN KEY ("batchItemId") REFERENCES "PurchaseBatchItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_receivingLineId_fkey" FOREIGN KEY ("receivingLineId") REFERENCES "ReceivingLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 預設兩位經營者（名稱可在設定頁修改；識別碼固定，改名不影響歷史紀錄）
INSERT INTO "Operator" ("id", "code", "name", "sortOrder", "updatedAt")
VALUES ('op_a', 'A', '經營者 A', 1, CURRENT_TIMESTAMP), ('op_b', 'B', '經營者 B', 2, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
