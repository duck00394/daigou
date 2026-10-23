-- 代購退款（砍單、取消後退回的錢）
ALTER TABLE "PurchaseBatch" ADD COLUMN "refundedTwd" INTEGER NOT NULL DEFAULT 0;
