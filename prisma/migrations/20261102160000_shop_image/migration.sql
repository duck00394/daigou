-- 訂購頁上傳的圖片（系列主圖）
CREATE TABLE "ShopImage" (
    "id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopImage_pkey" PRIMARY KEY ("id")
);
