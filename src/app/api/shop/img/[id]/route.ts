// 訂購頁上傳的圖片：公開讀取（客人看得到），內容不會變，可以長時間快取
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const img = await prisma.shopImage.findUnique({ where: { id } });
  if (!img) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
