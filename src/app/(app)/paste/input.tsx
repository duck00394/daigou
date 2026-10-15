"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, inputCls, useRun, useIdemKey } from "@/components/client";
import { stageLineAction } from "@/actions/imports";

const EXAMPLE = `小美 吉伊吊娃 2、小八 S 娃 1
阿婷 兔兔扭蛋 3
小美再加吉伊一番賞 1
小王 +1 吉伊吊娃

小林
吉伊 2
小八 1`;

export function PasteInput({ groupBuys, initialText = "", replaceBatchId = null }: { groupBuys: { id: string; name: string }[]; initialText?: string; replaceBatchId?: string | null }) {
  const [text, setText] = useState(initialText);
  const [gb, setGb] = useState("");
  const { run, pending } = useRun();
  const idem = useIdemKey();
  const router = useRouter();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        run(() => stageLineAction({ text, groupBuyId: gb || null, idempotencyKey: idem.key, replaceBatchId }), {
          refresh: false,
          onOk: (d) => {
            idem.renew();
            router.push(`/paste?batch=${d.id}`);
          },
        });
      }}
    >
      <label htmlFor="line-text" className="block text-[13px] font-medium text-ink-2">
        從 LINE 複製的訊息
      </label>
      <textarea
        id="line-text"
        className={`${inputCls} round min-h-[14rem] leading-7`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        spellCheck={false}
      />
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[13px] text-ink-2">
          這批訊息屬於
          <select className={`${inputCls} mt-1`} value={gb} onChange={(e) => setGb(e.target.value)}>
            <option value="">不指定代購團</option>
            {groupBuys.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" loading={pending} disabled={!text.trim()}>
          解析訊息
        </Button>
        {!text && (
          <Button variant="ghost" onClick={() => setText(EXAMPLE)}>
            填入範例
          </Button>
        )}
      </div>
      <p className="text-[12px] text-mute">解析只會建立預覽，不會寫入正式訂單；確認後才建立。</p>
    </form>
  );
}
