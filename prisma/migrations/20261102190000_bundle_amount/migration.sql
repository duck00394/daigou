-- 訂購頁：不能單買也可以用「其他角色要買滿多少錢」
ALTER TABLE "ShopQuota" ADD COLUMN "bundleAmount" INTEGER;
