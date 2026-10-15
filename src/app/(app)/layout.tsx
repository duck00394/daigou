import { requireUser } from "@/server/auth";
import { ToastProvider } from "@/components/client";
import { MobileBar, Sidebar } from "@/components/nav";

export const dynamic = "force-dynamic";
// 大量匯入、還原等操作可能較久（Vercel 免費方案上限 60 秒）
export const maxDuration = 60;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <ToastProvider>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <MobileBar />
          <main className="mx-auto w-full max-w-6xl px-3 pt-4 pb-28 sm:px-5 md:pt-6 md:pb-10">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
