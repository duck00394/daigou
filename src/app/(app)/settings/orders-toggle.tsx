"use client";
// 「我有在接單」開關：關掉後，貼上加單、收款、買家、開團、Excel 匯入從選單藏起來（訂單、出貨一直都在）（資料不會刪）
import { useRun } from "@/components/client";
import { setOrdersEnabledAction } from "@/actions/ops";

export function OrdersToggle({ on }: { on: boolean }) {
  const { run, pending } = useRun();
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="font-medium">我有在接單</div>
        <p className="text-[13px] text-mute">關掉：貼上加單、收款、買家、開團、Excel 匯入會從選單藏起來（訂單、出貨一直都在），資料不會刪，之後打開就回來。</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="我有在接單"
        disabled={pending}
        onClick={() => run(() => setOrdersEnabledAction(!on), { success: on ? "已藏起接單功能" : "已打開接單功能" })}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-ai" : "bg-line"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
      </button>
    </div>
  );
}
