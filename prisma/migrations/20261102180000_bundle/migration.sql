-- 訂購頁：不能單買（每買 1 個要搭配幾個同品項的其他角色）
ALTER TABLE "ShopQuota" ADD COLUMN "bundleNeed" INTEGER;
