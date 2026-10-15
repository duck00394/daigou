"use client";
import { useState } from "react";
import { Button, ConfirmButton, inputCls, useRun } from "@/components/client";
import { addProductAliasAction, archiveProductAction, removeProductAliasAction } from "@/actions/catalog";

export function AliasEditor({ productId, aliases }: { productId: string; aliases: { id: string; alias: string }[] }) {
  const [v, setV] = useState("");
  const { run, pending } = useRun();
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {aliases.length === 0 && <span className="text-sm text-mute">尚未設定別名。</span>}
        {aliases.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-white py-0.5 pr-1 pl-2.5 text-[14px]">
            {a.alias}
            <button type="button" aria-label={`移除別名 ${a.alias}`} className="rounded-full px-1.5 text-mute hover:bg-bad-soft hover:text-bad" onClick={() => run(() => removeProductAliasAction(a.id), { success: "已移除別名" })}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!v.trim()) return;
          await run(() => addProductAliasAction(productId, v), { success: "已新增別名", onOk: () => setV("") });
        }}
      >
        <input className={inputCls} value={v} onChange={(e) => setV(e.target.value)} placeholder="新增別名，例如：吉伊娃娃" aria-label="新增別名" />
        <Button type="submit" loading={pending}>
          新增
        </Button>
      </form>
      <p className="mt-1 text-[12px] text-mute">別名需確認無誤才新增；一個別名只能對應一個商品。</p>
    </div>
  );
}

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const { run } = useRun();
  return archived ? (
    <Button onClick={() => run(() => archiveProductAction(id, false), { success: "已取消封存" })}>取消封存</Button>
  ) : (
    <ConfirmButton
      label="封存商品"
      title="封存商品"
      message="封存後此商品不會出現在新增訂單與 LINE 辨識中；既有訂單與統計不受影響，之後可以取消封存。"
      confirmLabel="封存"
      onConfirm={() => run(() => archiveProductAction(id, true), { success: "已封存商品" })}
    />
  );
}
