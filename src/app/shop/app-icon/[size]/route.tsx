import { SHOP_ROSE, ICON_TEXT } from "@/lib/brand";
// 訂購頁的主畫面圖示：玫瑰色底＋店名第一個字（跟訂購頁左上角一樣）
import { ImageResponse } from "next/og";
import { prisma } from "@/server/db";
import { getShopName } from "@/server/services/shop";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const size = [180, 192, 512].includes(Number(raw)) ? Number(raw) : 512;
  const name = await getShopName(prisma);
  const first = [...name][0] ?? "";
  // 內建字型只有英文字；店名開頭是中文時，改從 Google Fonts 抓那一個字的字型
  let fonts: { name: string; data: ArrayBuffer; weight: 700 }[] | undefined;
  if (!/^[\x20-\x7e]$/.test(first)) {
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@700&text=${encodeURIComponent(first)}`)).text();
      const url = css.match(/src: url\((.+?)\) format/)?.[1];
      if (url) fonts = [{ name: "Noto Serif TC", data: await (await fetch(url)).arrayBuffer(), weight: 700 }];
    } catch {}
  }
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: SHOP_ROSE, color: ICON_TEXT, fontSize: size * 0.56, fontWeight: 700, fontFamily: fonts ? "Noto Serif TC" : "serif" }}>
        {first}
      </div>
    ),
    { width: size, height: size, fonts, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
