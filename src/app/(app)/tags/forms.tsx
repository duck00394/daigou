"use client";
import { useState } from "react";
import { Button, Modal, TextField, SelectField, TextArea, useRun, ConfirmButton } from "@/components/client";
import { saveTagAction, deleteTagAction } from "@/actions/buyers";
import { tagKind } from "@/lib/labels";

type T = { id: string; name: string; color: string; description: string | null; kind: string; warnOnOrder: boolean; active: boolean };

export function TagEditButton({ tag }: { tag?: T }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<T>(tag ?? { id: "", name: "", color: "#64748b", description: null, kind: "CUSTOM", warnOnOrder: false, active: true });
  const { run, pending } = useRun();
  return (
    <>
      <Button small={!!tag} variant={tag ? "default" : "primary"} onClick={() => setOpen(true)}>
        {tag ? "編輯" : "新增標籤"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={tag ? "編輯標籤" : "新增標籤"}
        footer={
          <Button variant="primary" loading={pending} onClick={() => run(() => saveTagAction(tag?.id ?? null, { ...f, kind: f.kind as never }), { success: tag ? "已儲存標籤" : "已新增標籤", onOk: () => setOpen(false) })}>
            {tag ? "儲存標籤" : "新增標籤"}
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="標籤名稱" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <SelectField label="標籤類型" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={Object.entries(tagKind)} />
          <label className="text-[13px] font-medium text-ink-2">
            顏色
            <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="mt-1 block h-10 w-20 rounded-lg border border-line" />
          </label>
          <div className="space-y-2 pt-5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.warnOnOrder} onChange={(e) => setF({ ...f, warnOnOrder: e.target.checked })} className="h-4 w-4" />
              新增訂單時顯示提醒（不會阻擋建單）
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4" />
              啟用
            </label>
          </div>
          <TextArea label="說明" rows={2} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} className="sm:col-span-2" />
        </div>
      </Modal>
    </>
  );
}

export function TagDeleteButton({ id, name, refs }: { id: string; name: string; refs: number }) {
  const { run } = useRun();
  return (
    <ConfirmButton
      small
      variant="danger"
      label="刪除"
      title={`刪除標籤「${name}」`}
      message={
        refs > 0 ? (
          <>
            這個標籤目前與 <b>{refs}</b> 筆買家紀錄（含已移除的歷史）有關聯。刪除後這些關聯會一併移除，只保留在稽核紀錄中。若只是不想再使用，建議改為「停用」，歷史紀錄會完整保留。
          </>
        ) : (
          "這個標籤沒有任何關聯，可以安全刪除。"
        )
      }
      confirmText={refs > 0 ? name : undefined}
      confirmLabel="刪除標籤"
      onConfirm={() => run(() => deleteTagAction(id, true), { success: "已刪除標籤" })}
    />
  );
}
