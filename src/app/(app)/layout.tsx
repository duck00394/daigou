import { Suspense } from "react";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { getOrdersEnabled } from "@/server/services/settings";
import { ToastProvider } from "@/components/client";
import { MobileBar, Sidebar } from "@/components/nav";
import { NumberFocusClear } from "@/components/number-focus";
import { SwRegister } from "@/components/sw-register";
import { ViewBanner } from "@/components/view-switch";
import { NavStack } from "@/components/back";
import { getView } from "@/server/view";

export const dynamic = "force-dynamic";
// 大量匯入、還原等操作可能較久（Vercel 免費方案上限 60 秒）
export const maxDuration = 60;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const [ordersOn, view] = await Promise.all([getOrdersEnabled(prisma), getView()]);
  return (
    <ToastProvider>
      <NumberFocusClear />
      <SwRegister />
      <Suspense><NavStack /></Suspense>
      <div className="flex min-h-dvh">
        <Suspense><Sidebar ordersOn={ordersOn} view={view} /></Suspense>
        <div className="min-w-0 flex-1">
          <Suspense><MobileBar ordersOn={ordersOn} view={view} /></Suspense>
          <main className="mx-auto w-full max-w-6xl px-3 pt-4 pb-28 sm:px-5 md:pt-6 md:pb-10"><ViewBanner v={view} />{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
