-- 訂購頁：每個角色可以另外設售價（空白＝用品項售價）
ALTER TABLE "ShopQuota" ADD COLUMN "price" INTEGER;
