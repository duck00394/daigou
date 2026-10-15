"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, inputCls } from "@/components/client";
import { loginAction } from "./actions";

export function LoginForm() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setErr(null);
        try {
          const r = await loginAction(pw);
          if (r.ok) router.replace("/");
          else setErr(r.error);
        } catch {
          setErr("伺服器沒有回應，請稍後再試");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="pw">
        密碼
      </label>
      <input id="pw" type="password" autoComplete="current-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      {err && (
        <p role="alert" className="mt-2 text-sm text-bad">
          {err}
        </p>
      )}
      <Button type="submit" variant="primary" loading={busy} className="mt-4 w-full">
        登入
      </Button>
    </form>
  );
}
