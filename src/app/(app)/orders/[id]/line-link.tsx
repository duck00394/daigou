"use client";
// 傳 LINE 給客人：貼賣貨便連結，客人會收到一張「請到賣貨便下單」的卡片
import { useState } from "react";
import { Button, inputCls, useRun } from "@/components/client";
import { sendSaleLinkAction } from "@/actions/shop";

export function SendLineLink({ orderId, buyer }: { orderId: string; buyer: string }) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const { run, pending } = useRun();
  const ok = /^https:\/\/\S+$/.test(url.trim());
  if (!open)
    return (
      <Button onClick={() => setOpen(true)} className="w-full sm:w-auto">
        <span className="mr-1 rounded bg-[#078a3e] px-1 text-[10px] font-bold text-white">LINE</span>傳賣貨便連結給 {buyer}
      </Button>
    );
  return (
    <section className="space-y-2 rounded-xl border border-line bg-card p-3" data-testid="send-line-link">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">傳 LINE 給 {buyer}</h2>
        <button type="button" className="text-[13px] text-mute underline" onClick={() => setOpen(false)}>收起來</button>
      </div>
      <label className="block text-[13px] font-medium text-ink-2">
        賣貨便連結
        <input type="url" className={`${inputCls} mt-1`} placeholder="https://myship.7-11.com.tw/…" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="block text-[13px] font-medium text-ink-2">
        備註（選填，沒填會寫「點下面的按鈕到賣貨便下單付款，完成後我們就會寄出～」）
        <input className={`${inputCls} mt-1`} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-[12px] text-mute">客人會收到「請到賣貨便下單」卡片：預訂系列、商品明細、應付金額，和「前往賣貨便下單」按鈕。每傳一次算一則 LINE 推播。</p>
      <Button
        variant="primary"
        className="w-full"
        loading={pending}
        disabled={!ok}
        onClick={() => run(() => sendSaleLinkAction(orderId, url.trim(), note.trim() || null), { success: (d) => `已傳給 ${d.buyer}`, onOk: () => { setUrl(""); setNote(""); setOpen(false); } })}
      >
        傳送
      </Button>
    </section>
  );
}
