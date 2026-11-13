"use client";
// 二補運費（只有日本官網買的團才有）：每個品項各自設定每隻幾元，直接算出「10 隻 × 30 ＋ 2 隻 × 50」
// 每隻幾元會記住（下次同品項自動帶）；一開始沒有預設值。要算進成本再按「記到這團的運費」（照品項分到每一隻）
import { useState } from "react";
import { Button, useIdemKey, useRun } from "@/components/client";
import { addBatchCostAction, setSecondShipFeeAction } from "@/actions/ops";
import { formatTwd } from "@/lib/money";

type Row = { typeId: string; typeName: string; qty: number; items: { id: string; qty: number }[] };

export function SecondShip({ batchId, rows, saved, recorded, open }: { batchId: string; rows: Row[]; saved: Record<string, number>; recorded: number | null; open: boolean }) {
  const [fee, setFee] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.typeId, saved[r.typeId] != null ? String(saved[r.typeId]) : ""])));
  const { run, pending } = useRun();
  const idem = useIdemKey();
  const n = (id: string) => (fee[id] && /^\d+$/.test(fee[id]) ? Number(fee[id]) : null);
  const used = rows.filter((r) => n(r.typeId) != null && r.qty > 0);
  const total = used.reduce((a, r) => a + r.qty * n(r.typeId)!, 0);
  const remember = (r: Row) => {
    const v = n(r.typeId);
    if ((saved[r.typeId] ?? null) === v) return;
    void run(() => setSecondShipFeeAction(r.typeId, v), { success: v == null ? `${r.typeName} 不算二補運費` : `已記住：${r.typeName} 每隻 ${v} 元`, refresh: false });
  };
  return (
    <section className="rounded-xl border border-line bg-card" aria-label="二補運費" data-testid="second-ship">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-2 px-4 py-2.5">
        <h2 className="text-[15px] font-semibold">二補運費</h2>
        <span className="text-[12.5px] text-mute">官網買的，從集運寄回台灣；每個品項填每隻幾元</span>
      </div>
      <div className="divide-y divide-line-2">
        {rows.map((r) => {
          const v = n(r.typeId);
          return (
            <div key={r.typeId} className="flex items-center gap-3 px-4 py-2.5 text-[15px]">
              <span className="min-w-0 flex-1">{r.typeName}<span className="num ml-2 text-[13px] text-mute">{r.qty} 隻</span></span>
              <label className="flex items-center gap-1.5 text-[13px] text-mute">
                每隻
                <input
                  aria-label={`${r.typeName} 每隻二補運費`}
                  inputMode="numeric"
                  placeholder="不算"
                  value={fee[r.typeId] ?? ""}
                  onChange={(e) => setFee({ ...fee, [r.typeId]: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                  onBlur={() => remember(r)}
                  className="num min-h-10 w-20 rounded-lg border border-field bg-card px-2 text-right text-[15px] text-ink placeholder:text-mute"
                />
                元
              </label>
              <span className="num w-20 shrink-0 text-right font-medium">{v != null ? formatTwd(r.qty * v) : <span className="text-mute">—</span>}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
        <div className="min-w-0">
          <div className="num text-[13px] text-mute" data-testid="second-ship-formula">{used.length ? used.map((r) => `${r.qty} 隻 × ${n(r.typeId)}`).join(" ＋ ") : "填了每隻幾元就會算"}</div>
          <div className="text-[15px]">合計 <b className="num text-[18px]" data-testid="second-ship-total">{formatTwd(total)}</b></div>
          {recorded != null && <div className="text-[12.5px] text-mute">這團已經記過二補運費 {formatTwd(recorded)}（在下面「運費、代購費」）</div>}
        </div>
        {open && (
          <Button
            variant="primary"
            disabled={total <= 0}
            loading={pending}
            onClick={() =>
              run(
                () =>
                  addBatchCostAction({
                    batchId,
                    kind: "INTL_SHIPPING",
                    currency: "TWD",
                    amount: total,
                    method: "MANUAL",
                    // 照品項分到每一隻：吊娃每隻 30、S 娃每隻 50…
                    manualSplit: Object.fromEntries(used.flatMap((r) => r.items.map((i) => [i.id, i.qty * n(r.typeId)!]))),
                    note: "二補運費",
                    requestKey: idem.key,
                  }),
                { success: `已記到這團的運費 ${formatTwd(total)}`, onOk: () => idem.renew() },
              )
            }
          >
            記到這團的運費
          </Button>
        )}
      </div>
    </section>
  );
}
