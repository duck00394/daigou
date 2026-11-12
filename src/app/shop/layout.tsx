import type { Metadata, Viewport } from "next";
import { prisma } from "@/server/db";
import { getShopName } from "@/server/services/shop";
import { CartProvider } from "./cart";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const name = await getShopName(prisma);
  return { title: { absolute: name, template: `%s｜${name}` }, description: `${name}，預購與現貨訂購`, robots: { index: false, follow: false }, manifest: "/shop/manifest.webmanifest", appleWebApp: { capable: true, title: name, statusBarStyle: "default" }, icons: { apple: "/shop/app-icon/180" } };
}

export const viewport: Viewport = { themeColor: "#fbf6f0", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@600;700&display=swap" />
      <CartProvider>
        <div className="light-page min-h-dvh bg-shop-bg text-shop-ink">
          <div className="mx-auto min-h-dvh max-w-md bg-shop-bg pb-28 sm:shadow-lift-4">{children}</div>
        </div>
      </CartProvider>
    </>
  );
}
