"use client";
// 已確認／未確認：在列表上直接點就切換（不用點進去那一團）
import { useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/client";
import { setBatchConfirmedAction } from "@/actions/batches";

export function ConfirmToggle({ batchId, confirmed: initial, name }: { batchId: string; confirmed: boolean; name: string }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${name}：${on ? "已確認" : "未確認"}`}
      disabled={busy}
      data-testid="confirm-toggle"
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[12px] whitespace-nowrap ${on ? "border-[#b7e2c9] bg-good-soft text-good" : "border-dashed border-line bg-white text-mute"}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !on;
        setOn(next);
        setBusy(true);
        const r = await setBatchConfirmedAction(batchId, next).catch(() => ({ ok: false as const, error: "沒有存到，請重新整理再試" }));
        setBusy(false);
        if (!r.ok) {
          setOn(!next);
          notify(r.error);
        } else router.refresh();
      }}
    >
      {on ? "✓ 已確認" : "未確認"}
    </button>
  );
}
