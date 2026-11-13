import { Suspense } from "react";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { getNavPins, getOrdersEnabled } from "@/server/services/settings";
import { ToastProvider } from "@/components/client";
import { MobileBar, Sidebar } from "@/components/nav";
import { NumberFocusClear } from "@/components/number-focus";
import { SwRegister } from "@/components/sw-register";
import { ViewBanner } from "@/components/view-switch";
import { NavStack } from "@/components/back";
import { Tour } from "@/components/tour";
import { getView } from "@/server/view";
import { MODE_SCRIPT } from "@/lib/mode-script";
import { ModeSync } from "@/components/mode";

export const dynamic = "force-dynamic";
// 大量匯入、還原等操作可能較久（Vercel 免費方案上限 60 秒）
export const maxDuration = 60;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const [ordersOn, view] = await Promise.all([getOrdersEnabled(prisma), getView()]);
  // 常用頁面跟著「這台裝置是誰在用」
  const pins = await getNavPins(prisma, view.me);
  return (
    <ToastProvider>
      {/* 外觀（深色預設）：畫面出來前先設定，不會閃一下淺色 */}
      <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
      <ModeSync />
      <NumberFocusClear />
      <SwRegister />
      <Suspense><NavStack /></Suspense>
      <Suspense><Tour /></Suspense>
      <div className="flex min-h-dvh">
        <Suspense><Sidebar ordersOn={ordersOn} view={view} pins={pins} /></Suspense>
        <div className="min-w-0 flex-1">
          <Suspense><MobileBar ordersOn={ordersOn} view={view} pins={pins} /></Suspense>
          <main className="mx-auto w-full max-w-6xl px-3 pt-4 pb-28 sm:px-5 md:pt-6 md:pb-10"><ViewBanner v={view} />{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
