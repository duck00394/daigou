import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "登入" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6">
        <div className="round mb-1 flex items-center gap-2 text-xl font-semibold">
          <span aria-hidden className="inline-block h-6 w-6 rounded-md bg-ai" />
          代購帳房
        </div>
        <p className="mb-5 text-sm text-mute">請輸入管理者密碼</p>
        <LoginForm />
      </div>
    </main>
  );
}
