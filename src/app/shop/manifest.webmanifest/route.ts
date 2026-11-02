// 訂購頁（客人用）的主畫面設定：名稱用店名、打開直接進訂購頁，不會跑到後台
import { prisma } from "@/server/db";
import { getShopName } from "@/server/services/shop";

export const dynamic = "force-dynamic";

export async function GET() {
  const name = await getShopName(prisma);
  return Response.json(
    {
      id: "/shop",
      name,
      short_name: name,
      description: `${name}・預購與現貨訂購`,
      start_url: "/shop",
      scope: "/shop",
      display: "standalone",
      background_color: "#fbf6f0",
      theme_color: "#fbf6f0",
      lang: "zh-Hant-TW",
      icons: [
        { src: "/shop/app-icon/192", sizes: "192x192", type: "image/png" },
        { src: "/shop/app-icon/512", sizes: "512x512", type: "image/png" },
        { src: "/shop/app-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" } },
  );
}
