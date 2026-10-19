"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmButton, useRun } from "@/components/client";
import { deleteRushAction, setRushStatusAction } from "@/actions/rush";
import { untilText } from "@/lib/taipei";

/** 倒數（每 30 秒更新）：只是畫面上的顯示，真正的通知由伺服器送 */
export function Countdown({ at }: { at: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const h = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(h);
  }, []);
  return <div className="text-[24px] font-extrabold text-[#c2410c]" data-testid="rush-countdown">{untilText(new Date(at), now)}</div>;
}

export function RushActions({ id, status, name }: { id: string; status: string; name: string }) {
  const { run, pending } = useRun();
  const router = useRouter();
  const set = (s: "UPCOMING" | "BOUGHT" | "MISSED" | "CANCELLED", msg: string) => run(() => setRushStatusAction(id, s), { success: msg });
  return (
    <div className="space-y-2">
      {status === "UPCOMING" ? (
        <>
          <div className="text-[13px] font-semibold text-ink-2">搶完了？</div>
          <div className="grid grid-cols-3 gap-2">
            <Button loading={pending} onClick={() => set("BOUGHT", "記成已搶購")}>✓ 已搶購</Button>
            <Button loading={pending} onClick={() => set("MISSED", "記成未搶到")}>✗ 未搶到</Button>
            <Button loading={pending} onClick={() => set("CANCELLED", "已取消，不會再通知")}>取消搶購</Button>
          </div>
        </>
      ) : (
        <Button onClick={() => set("UPCOMING", "改回還沒開始，會重新排程通知")}>改回「還沒開始」</Button>
      )}
      <div className="flex justify-end">
        <ConfirmButton
          small
          variant="danger"
          label="🗑 刪除"
          title="刪除這筆搶購提醒"
          message={<>刪除「{name}」，排好的通知也會一起取消。</>}
          confirmLabel="刪除"
          onConfirm={() => run(() => deleteRushAction(id), { success: "已刪除", onOk: () => router.push("/rush") })}
        />
      </div>
    </div>
  );
}
