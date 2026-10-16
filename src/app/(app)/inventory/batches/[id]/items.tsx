"use client";
// 採購團品項：一打開只看清單（角色、單價 × 數量、小計、合計）；按「編輯」才能修改，按「加商品」才出現新增表格
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Modal, useIdemKey, useRun } from "@/components/client";
import { OperatorPicker, type OperatorOption } from "@/components/operator-picker";
import { BulkEditTable, type EditItem } from "./bulk-edit";
import { BulkAddGrid } from "./bulk-add";
import { payRemainingAction, receiveAllAction } from "@/actions/batches";
import { formatJpy, formatTwd } from "@/lib/money";

type Opt = { id: string; name: string };
const money = (v: number, c: string) => (c === "JPY" ? formatJpy(v) : formatTwd(v));

export function ItemsPanel(props: {
  batchId: string;
  items: EditItem[];
  editable: boolean;
  initialMode: "view" | "add";
  supplierId: string | null;
  supplierCurrency: "JPY" | "TWD";
  rateMicro: number;
  series: Opt[];
  types: Opt[];
  copyButton?: React.ReactNode;
  category?: { id: string; name: string } | null;
}) {
  const { items, editable } = props;
  const [mode, setMode] = useState<"view" | "edit" | "add">(props.initialMode);
  // 「?bulk=1」只用來第一次打開新增表格；之後重新整理就回到清單
  const router = useRouter();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("bulk")) router.replace(window.location.pathname, { scroll: false });
  }, [router]);
  const live = items.filter((i) => i.qty > 0 || i.cancelledQty > 0);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const goods = items.reduce((s, i) => s + i.goodsTwd, 0);
  const fees = items.reduce((s, i) => s + i.feesTwd, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-2.5">
        <h2 className="text-[15px] font-semibold">品項（{items.length}）</h2>
        {editable && (
          <div className="flex flex-wrap gap-1.5">
            {mode === "view" ? (
              <>
                <Button small variant="primary" onClick={() => setMode("add")}>＋ 加商品</Button>
                {items.length > 0 && <Button small onClick={() => setMode("edit")}>編輯</Button>}
                {props.copyButton}
              </>
            ) : (
              <>
                {mode === "add" && props.copyButton}
                <Button small variant="primary" onClick={() => setMode("view")}>{mode === "edit" ? "完成編輯" : "收起"}</Button>
              </>
            )}
          </div>
        )}
      </div>

      {mode === "add" && (
        <div className="border-b border-line-2 p-4">
          <BulkAddGrid category={props.category ?? null} batchId={props.batchId} supplierId={props.supplierId} supplierCurrency={props.supplierCurrency} rateMicro={props.rateMicro} series={props.series} types={props.types} onClosed={(allOk) => allOk && setMode("view")} />
        </div>
      )}

      {mode === "edit" ? (
        <BulkEditTable batchId={props.batchId} items={items} editable={editable} />
      ) : live.length === 0 ? (
        mode === "view" && <p className="px-4 py-8 text-center text-sm text-mute">還沒有品項。{editable && <>按「＋ 加商品」開始加入。</>}</p>
      ) : (
        <ul className="divide-y divide-line-2" aria-label="品項清單">
          {live.map((i) => {
            const unit = i.actualUnitCost ?? i.estUnitCost;
            return (
              <li key={i.id} className={`flex items-start justify-between gap-3 px-4 py-2.5 ${i.qty === 0 ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <Link href={`/products/${i.productId}`} className="font-medium hover:underline">{i.name}</Link>
                  {i.specNote && <span className="ml-1 text-[12px] text-mute">{i.specNote}</span>}
                  <div className="text-[13px] text-ink-2">
                    {money(unit, i.currency)} × {i.qty}
                    {i.actualUnitCost == null && <span className="ml-1 text-[11px] text-mute">（預估）</span>}
                  </div>
                  <div className="text-[12px] text-mute">
                    {i.received > 0 ? `已到 ${i.received}` : "還沒到"}
                    {i.cancelledQty > 0 && <span className="text-bad">・已砍 {i.cancelledQty}{i.cancelReason ? `（${i.cancelReason}）` : ""}</span>}
                  </div>
                </div>
                <div className="num shrink-0 text-right">
                  <div className="font-semibold">{money(unit * i.qty, i.currency)}</div>
                  {i.currency === "JPY" && <div className="text-[11px] text-mute">≈ {formatTwd(i.goodsTwd)}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {mode !== "edit" && items.length > 0 && (
        <div className="flex items-baseline justify-between border-t border-line px-4 py-2.5">
          <span className="text-sm text-ink-2">合計 {totalQty} 件{fees ? `（含運費等 ${formatTwd(fees)}）` : ""}</span>
          <span className="num text-[18px] font-semibold" data-testid="items-total">{formatTwd(goods + fees)}</span>
        </div>
      )}
    </div>
  );
}

/** 一鍵付清：把還要付的金額登記成一筆付款 */
export function PayOffButton({ batchId, due, operators, defaultPayer, big }: { batchId: string; due: number; operators: OperatorOption[]; defaultPayer: string | null; big?: boolean }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string | null>(defaultPayer);
  const idem = useIdemKey();
  const { run, pending } = useRun();
  if (due <= 0) return null;
  return (
    <>
      <Button small={!big} variant="primary" className={big ? "w-full" : undefined} onClick={() => { setWho(defaultPayer); setOpen(true); }}>付清</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="付清這一團"
        footer={<Button variant="primary" loading={pending} onClick={() => run(() => payRemainingAction(batchId, who, idem.key), { success: `已登記付款 ${formatTwd(due)}`, onOk: () => { idem.renew(); setOpen(false); } })}>登記已付 {formatTwd(due)}</Button>}
      >
        <OperatorPicker label="誰付的？" operators={operators} value={who} onChange={setWho} />
        <p className="mt-3 text-[13px] text-mute">會新增一筆台幣付款（今天）。之後要改金額、日期或付款方式，到下方「付款」修改即可。</p>
      </Modal>
    </>
  );
}

/** 全部到了：還沒收到的一次入庫，收貨的人預設這團的收貨負責人或主人 */
export function ReceiveAllButton({ batchId, outstanding, operators, defaultReceiver }: { batchId: string; outstanding: number; operators: OperatorOption[]; defaultReceiver: string | null }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string | null>(defaultReceiver);
  const idem = useIdemKey();
  const { run, pending } = useRun();
  const go = () =>
    run(() => receiveAllAction(batchId, who, idem.key), {
      success: (r) => (r.received ? `${r.received} 件已進庫存` : "沒有還沒到的了"),
      onOk: () => { idem.renew(); setOpen(false); },
    });
  if (outstanding <= 0) return <span className="flex items-center justify-center rounded-lg bg-good-soft px-3 py-2 text-[14px] text-good">全部到手了</span>;
  return (
    <>
      <Button variant="primary" className="w-full" loading={pending && !open} onClick={() => (defaultReceiver ? go() : setOpen(true))}>全部到了</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="誰收到的？" footer={<Button variant="primary" loading={pending} disabled={!who} onClick={go}>{outstanding} 件全部入庫</Button>}>
        <OperatorPicker label="收貨的人" operators={operators} value={who} onChange={setWho} />
      </Modal>
    </>
  );
}
