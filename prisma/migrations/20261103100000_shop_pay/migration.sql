-- 訂購頁：訪客下單（Email）、查詢碼、賣貨便付款期限、Email 通知
CREATE TYPE "ShopPayTiming" AS ENUM ('ORDER', 'ARRIVAL');

ALTER TABLE "Buyer" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "Buyer_email_key" ON "Buyer"("email");

ALTER TABLE "Order" ADD COLUMN "lookupHash" TEXT,
ADD COLUMN "payDueAt" TIMESTAMP(3),
ADD COLUMN "payNoticeAt" TIMESTAMP(3),
ADD COLUMN "myshipAt" TIMESTAMP(3),
ADD COLUMN "myshipRef" TEXT;
CREATE INDEX "Order_payDueAt_idx" ON "Order"("payDueAt");

ALTER TABLE "ShopCategory" ADD COLUMN "payUrl" TEXT,
ADD COLUMN "payTiming" "ShopPayTiming" NOT NULL DEFAULT 'ORDER',
ADD COLUMN "payHours" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "LineOutbox" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "LineOutbox_dedupeKey_key" ON "LineOutbox"("dedupeKey");

CREATE TABLE "MailOutbox" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailOutbox_dedupeKey_key" ON "MailOutbox"("dedupeKey");
CREATE INDEX "MailOutbox_sentAt_createdAt_idx" ON "MailOutbox"("sentAt", "createdAt");
