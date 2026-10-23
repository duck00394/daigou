"use client";
// 按錯了的修正：撤回收貨（貨拿出庫存、這團變回還沒到）、刪除整團
import { useRouter } from "next/navigation";
import { ConfirmButton, useRun } from "@/components/client";
import { deleteBatchAction, undoReceivingAction } from "@/actions/batches";
import { formatTwd } from "@/lib/money";

export function UndoReceivingButton({ batchId, recordId, qty, label }: { batchId: string; recordId: string | null; qty: number; label: string }) {
  const { run } = useRun();
  return (
    <ConfirmButton
      small
      label={label}
      title={recordId ? "撤回這次收貨" : "撤回這團全部的收貨"}
      message={`這${recordId ? "次" : "團"}收進庫存的 ${qty} 件會從庫存拿掉，這團變回「還沒到」。已經賣出、自留或留給買家的，要先作廢或取消才能撤回。`}
      confirmLabel="撤回收貨"
      onConfirm={() => run(() => undoReceivingAction(batchId, recordId), { success: (d) => `已撤回 ${d.qty} 件，從庫存拿掉了` })}
    />
  );
}

/** 刪除整團：品項、付款、退款、運費、收貨、自留一起刪（在採購團列表、團頁面都能按） */
export function DeleteBatchButton({ batchId, name, paid = 0, received = 0, items = 0, goTo }: { batchId: string; name: string; paid?: number; received?: number; items?: number; goTo?: string }) {
  const { run } = useRun();
  const router = useRouter();
  const parts = [items ? `${items} 個品項` : null, paid ? `付款紀錄（已付 ${formatTwd(paid)}）` : null, received ? `已收進庫存的 ${received} 件` : null, "運費、收貨、自留紀錄"].filter(Boolean);
  return (
    <ConfirmButton
      small
      variant="danger"
      label="刪除"
      title={`刪除整團「${name}」`}
      message={`會一起刪掉：${parts.join("、")}。刪了不能復原。這團的貨如果已經賣出或留給客人，要先作廢那筆出售才能刪。`}
      confirmLabel="刪除整團"
      onConfirm={() => run(() => deleteBatchAction(batchId), { success: `已刪除「${name}」`, refresh: !goTo, onOk: () => goTo && router.push(goTo) })}
    />
  );
}
