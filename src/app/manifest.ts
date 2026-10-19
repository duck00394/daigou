import type { MetadataRoute } from "next";

// 可以加到 iPhone 主畫面的網頁 App（PWA）：iPhone 要從主畫面打開才能收到通知
export default function manifest(): MetadataRoute.Manifest {
  return {
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
  };
}
