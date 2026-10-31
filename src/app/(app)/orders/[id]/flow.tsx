"use client";
// 訂單頁最上面：備齊（勾）→ 出貨 → 客人取貨（可一起記收款）
import { useState } from "react";
import { Button, Modal, TextField, useRun, useIdemKey, DateTimeField, SelectField } from "@/components/client";
import { setPackedAction, shipOrderAction, pickedUpAction } from "@/actions/orders";
import { toDateTimeInput } from "@/lib/labels";

export type FlowLine = { id: string; name: string; pending: number; packed: boolean; canPack: boolean; short: number };
type Shipped = { method: string | null; tracking: string | null; at: string; qty: number };

const md = (iso: string) => {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }).formatToParts(d);
  return `${p.find((x) => x.type === "month")?.value}/${p.find((x) => x.type === "day")?.value}`;
};

export function OrderFlow({ orderId, lines, open, delivered, balance, methods }: { orderId: string; lines: FlowLine[]; open: Shipped[]; delivered: string | null; balance: number; methods: string[] }) {
  const { run, pending } = useRun();
  const [mode, setMode] = useState<null | "ship" | "pick">(null);
  const shipIdem = useIdemKey();
  const pickIdem = useIdemKey();
  const [ship, setShip] = useState({ method: methods[0] ?? "", tracking: "", at: "" });
  const [pick, setPick] = useState({ at: "", collect: true });

  const total = lines.length;
  const packed = lines.filter((l) => l.packed).length;
  const allPacked = total > 0 && packed === total;
  const qty = lines.reduce((a, l) => a + l.pending, 0);
  const lastShip = open.at(-1);
  const step = total > 0 ? (allPacked ? 1 : 0) : open.length ? 2 : 3;
  if (step === 3 && !delivered) return null; // 沒有要出、也沒出過（例如整單取消）

  const pill = (i: number, text: string) => (
    <div key={i} className={`flex-1 rounded-lg py-1.5 text-center text-[13px] ${step === i ? "bg-ai text-white" : step > i ? "bg-good-soft text-good" : "bg-line-2 text-mute"}`}>{text}</div>
  );
  const toggle = (l: FlowLine) => run(() => setPackedAction(orderId, [l.id], !l.packed));
  const canAll = lines.filter((l) => !l.packed && l.canPack);

  return (
    <section className="rounded-xl border border-line bg-card p-3.5" data-testid="order-flow">
      <div className="mb-3 flex gap-1.5">
        {pill(0, total ? (allPacked ? `備齊 ${packed}/${total}` : `備貨 ${packed}/${total}`) : "備齊")}
        {pill(1, step >= 2 && lastShip ? `已出貨 ${md(lastShip.at)}` : "出貨")}
        {pill(2, delivered && step === 3 ? `已取貨 ${md(delivered)}` : "客人取貨")}
      </div>

      {total > 0 && (
        <>
          <ul className="divide-y divide-line-2" aria-label="貨齊了沒">
            {lines.map((l) => {
              const dis = pending || (!l.packed && !l.canPack);
              return (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-[15px]">
                  <span className="min-w-0">
                    {l.name}
                    {l.pending > 1 && <span className="num text-mute"> ×{l.pending}</span>}
                    {!l.packed && !l.canPack && <span className="ml-1.5 text-[13px] text-bad">還差 {l.short} 件</span>}
                  </span>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={l.packed}
                    aria-label={`${l.name} 備齊`}
                    disabled={dis}
                    onClick={() => toggle(l)}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-[1.5px] text-white ${l.packed ? "border-ai bg-ai" : "border-[#c9ccd4] bg-white"} ${dis && !l.packed ? "opacity-40" : ""}`}
                  >
                    {l.packed ? "✓" : ""}
                  </button>
                </li>
              );
            })}
          </ul>
          {allPacked ? (
            <Button variant="primary" className="mt-2 w-full" onClick={() => setMode("ship")}>出貨 {qty} 件</Button>
          ) : (
            canAll.length > 1 && <Button className="mt-2 w-full" loading={pending} onClick={() => run(() => setPackedAction(orderId, canAll.map((l) => l.id), true))}>有貨的全勾</Button>
          )}
        </>
      )}

      {open.length > 0 && (
        <div className={`${total ? "mt-3 border-t border-line-2 pt-3" : ""}`}>
          {open.map((s, i) => (
            <div key={i} className="flex justify-between py-1 text-[15px]">
              <span>{s.method ?? "已出貨"}{s.tracking ? `・${s.tracking}` : ""}</span>
              <span className="num text-mute">{s.qty} 件</span>
            </div>
          ))}
          <Button variant="primary" className="mt-2 w-full" onClick={() => setMode("pick")}>客人取貨了</Button>
        </div>
      )}

      <Modal
        open={mode === "ship"}
        onClose={() => setMode(null)}
        title={`出貨 ${qty} 件`}
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              run(() => shipOrderAction({ orderId, method: ship.method || null, trackingNo: ship.tracking.trim() || null, shippedAt: ship.at || null, dedupeKey: shipIdem.key }), {
                success: "已出貨",
                onOk: () => {
                  setMode(null);
                  shipIdem.renew();
                },
              })
            }
          >
            確定出貨
          </Button>
        }
      >
        <div className="grid gap-3">
          {methods.length > 0 ? (
            <SelectField label="寄送方式" value={ship.method} onChange={(e) => setShip({ ...ship, method: e.target.value })} options={[...methods.map((m) => [m, m] as [string, string]), ["", "其他／不填"]]} />
          ) : (
            <TextField label="寄送方式（選填）" value={ship.method} onChange={(e) => setShip({ ...ship, method: e.target.value })} placeholder="例：賣貨便" />
          )}
          <TextField label="寄件單號（選填）" value={ship.tracking} onChange={(e) => setShip({ ...ship, tracking: e.target.value })} placeholder="例：F12345678" />
          <DateTimeField label="出貨時間" value={ship.at || toDateTimeInput(new Date())} onChange={(v) => setShip({ ...ship, at: v })} />
        </div>
      </Modal>

      <Modal
        open={mode === "pick"}
        onClose={() => setMode(null)}
        title="客人取貨了"
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              run(() => pickedUpAction({ orderId, at: pick.at || null, collect: balance > 0 && pick.collect, dedupeKey: pickIdem.key }), {
                success: (d) => (d.paid ? `已取貨，收款 ${d.paid.toLocaleString()} 元` : "已取貨"),
                onOk: () => {
                  setMode(null);
                  pickIdem.renew();
                },
              })
            }
          >
            確定
          </Button>
        }
      >
        <div className="grid gap-3">
          <DateTimeField label="取貨時間" value={pick.at || toDateTimeInput(new Date())} onChange={(v) => setPick({ ...pick, at: v })} />
          {balance > 0 && (
            <label className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[15px] ${pick.collect ? "bg-good-soft" : "bg-line-2"}`}>
              <input type="checkbox" className="h-5 w-5" checked={pick.collect} onChange={(e) => setPick({ ...pick, collect: e.target.checked })} />
              <span>
                同時記收款 <b className="num">NT${balance.toLocaleString()}</b>
                <span className="block text-[13px] text-mute">取貨付款，錢跟著進來</span>
              </span>
            </label>
          )}
        </div>
      </Modal>
    </section>
  );
}
