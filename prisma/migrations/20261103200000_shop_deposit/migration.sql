-- 訂購頁：訂金（匯款、回傳末五碼、確認後才傳賣貨便連結）
ALTER TABLE "ShopCategory" ADD COLUMN "depositPerItem" INTEGER;

ALTER TABLE "Order" ADD COLUMN "depositAmount" INTEGER,
ADD COLUMN "depositDueAt" TIMESTAMP(3),
ADD COLUMN "depositRef" TEXT,
ADD COLUMN "depositReportedAt" TIMESTAMP(3),
ADD COLUMN "depositConfirmedAt" TIMESTAMP(3);
CREATE INDEX "Order_depositDueAt_idx" ON "Order"("depositDueAt");
