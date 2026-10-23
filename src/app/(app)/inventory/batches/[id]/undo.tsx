"use client";
// 按錯了的修正：撤回收貨（貨拿出庫存、這團變回還沒到）、刪除已取消的團
import { useRouter } from "next/navigation";
import { ConfirmButton, useRun } from "@/components/client";
import { deleteBatchAction, undoReceivingAction } from "@/actions/batches";

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

export function DeleteBatchButton({ batchId, name }: { batchId: string; name: string }) {
  const { run } = useRun();
  const router = useRouter();
  return (
    <ConfirmButton
      small
      variant="danger"
      label="刪除這團"
      title={`刪除「${name}」`}
      message="這團已取消、沒付過錢，刪掉就不會再出現在任何地方，不能復原。"
      confirmLabel="刪除"
      onConfirm={() => run(() => deleteBatchAction(batchId), { success: "已刪除", refresh: false, onOk: () => router.push("/inventory?tab=batches&open=cancelled") })}
    />
  );
}
