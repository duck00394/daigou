// 後台「代購帳房」的主畫面設定（PWA）：iPhone 要從主畫面打開才能收到通知
// 不用 app/manifest.ts，因為那會套到所有頁面；訂購頁有自己的 /shop/manifest.webmanifest
export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      id: "/",
      name: "代購帳房",
      short_name: "代購帳房",
      description: "日本角色周邊代購管理",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#f6f7f9",
      theme_color: "#f6f7f9",
      lang: "zh-Hant-TW",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
