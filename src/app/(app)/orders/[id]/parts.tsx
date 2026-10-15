"use client";
import { useState } from "react";
import { Button, ConfirmButton, Modal, TextField, SelectField, TextArea, useRun, useIdemKey, notify } from "@/components/client";
import {
  addPaymentAction,
  cancelItemAction,
  cancelOrderAction,
  completeRefundAction,
  createRefundAction,
  updateItemAction,
  updateOrderMetaAction,
  voidPaymentAction,
  voidRefundAction,
} from "@/actions/orders";
import { reserveAction, unreserveAction } from "@/actions/ops";
import { formatTwd } from "@/lib/money";
import { packFlag, purchaseFlag, toDateTimeInput } from "@/lib/labels";

const int = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/[,\s]/g, "")));

export function CancelOrderButton({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  const [reason, setReason] = useState("");
  const { run } = useRun();
  return (
    <ConfirmButton
      variant="danger"
      label="取消整張訂單"
      title={`取消訂單 ${orderNo}`}
      message={
        <div className="space-y-3">
          <p>會取消所有尚未出貨的數量，並釋放已保留的庫存。已出貨的商品不受影響。若買家已付款，取消後請到下方建立退款紀錄。</p>
          <TextField label="取消原因" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      }
      confirmLabel="確認取消訂單"
      onConfirm={() =>
        run(() => cancelOrderAction(orderId, reason || null), {
          success: (d) => (d.refundUnscheduled > 0 ? `已取消訂單，需退款 ${formatTwd(d.refundUnscheduled)}` : "已取消訂單"),
        })
      }
    />
  );
}

export function ConfirmOrderButton({ orderId }: { orderId: string }) {
  const { run, pending } = useRun();
  return (
    <Button variant="primary" loading={pending} onClick={() => run(() => updateOrderMetaAction(orderId, { confirmation: "CONFIRMED" }), { success: "已確認訂單" })}>
      確認訂單
    </Button>
  );
}

export function EditMetaButton({ orderId, shippingFee, orderDiscount, notes, groupBuyId, groupBuys }: { orderId: string; shippingFee: number; orderDiscount: number; notes: string | null; groupBuyId: string | null; groupBuys: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ shippingFee: String(shippingFee), orderDiscount: String(orderDiscount), notes: notes ?? "", groupBuyId: groupBuyId ?? "" });
  const { run, pending } = useRun();
  return (
    <>
      <Button small onClick={() => setOpen(true)}>
        修改運費、折扣與備註
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="修改訂單"
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              const sf = int(f.shippingFee);
              const od = int(f.orderDiscount || "0");
              if (!Number.isInteger(sf) || sf < 0 || !Number.isInteger(od)) return notify("運費與折扣必須是整數");
              run(() => updateOrderMetaAction(orderId, { shippingFee: sf, orderDiscount: od, notes: f.notes, groupBuyId: f.groupBuyId || null }), { success: "已儲存訂單", onOk: () => setOpen(false) });
            }}
          >
            儲存
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="運費" inputMode="numeric" value={f.shippingFee} onChange={(e) => setF({ ...f, shippingFee: e.target.value })} />
          <TextField label="整單折扣" inputMode="numeric" value={f.orderDiscount} onChange={(e) => setF({ ...f, orderDiscount: e.target.value })} hint="負數代表加價；取消部分商品時依剩餘金額比例調整" />
          <SelectField label="代購團" value={f.groupBuyId} onChange={(e) => setF({ ...f, groupBuyId: e.target.value })} options={[["", "不指定"], ...groupBuys.map((g) => [g.id, g.name] as [string, string])]} className="sm:col-span-2" />
          <TextArea label="備註" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="sm:col-span-2" />
        </div>
        <p className="mt-3 text-[12px] text-mute">每次修改都會留下稽核紀錄。</p>
      </Modal>
    </>
  );
}

export function ItemActions({
  item,
  categories,
  disabled,
}: {
  item: { id: string; name: string; qty: number; cancelled: number; shipped: number; reserved: number; unitPrice: number; lineDiscount: number; categoryId: string | null; specNote: string | null };
  categories: { id: string; name: string }[];
  disabled: boolean;
}) {
  const [mode, setMode] = useState<null | "cancel" | "edit">(null);
  const [cancelQty, setCancelQty] = useState("1");
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState({ unitPrice: String(item.unitPrice), lineDiscount: String(item.lineDiscount), addQty: "", categoryId: item.categoryId ?? "", specNote: item.specNote ?? "" });
  const { run, pending } = useRun();
  const cancellable = item.qty - item.cancelled - item.shipped;
  return (
    <>
      <div className="flex flex-wrap gap-1">
        <Button small disabled={disabled} onClick={() => setMode("edit")}>
          修改
        </Button>
        <Button small variant="danger" disabled={disabled || cancellable <= 0} onClick={() => setMode("cancel")}>
          取消數量
        </Button>
      </div>
      <Modal
        open={mode === "cancel"}
        onClose={() => setMode(null)}
        title={`取消「${item.name}」`}
        footer={
          <Button
            variant="danger"
            loading={pending}
            onClick={() => {
              const q = int(cancelQty);
              if (!Number.isInteger(q) || q <= 0 || q > cancellable) return notify(`請輸入 1 到 ${cancellable} 的整數`);
              run(() => cancelItemAction(item.id, q, reason || null), {
                success: (d) => `已取消 ${q} 件，應收變為 ${formatTwd(d.receivableAfter)}${d.refundUnscheduled > 0 ? `，需退款 ${formatTwd(d.refundUnscheduled)}` : ""}`,
                onOk: () => setMode(null),
              });
            }}
          >
            確認取消
          </Button>
        }
      >
        <p className="mb-3 text-sm">
          可取消 {cancellable} 件（已出貨 {item.shipped} 件不能取消）。已保留的庫存會自動釋放；取消紀錄會保留在訂單與買家履歷中。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="取消數量" inputMode="numeric" value={cancelQty} onChange={(e) => setCancelQty(e.target.value)} />
          <TextField label="取消原因" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
      <Modal
        open={mode === "edit"}
        onClose={() => setMode(null)}
        title={`修改「${item.name}」`}
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              const up = int(edit.unitPrice);
              const ld = int(edit.lineDiscount || "0");
              const add = edit.addQty ? int(edit.addQty) : 0;
              if (!Number.isInteger(up) || up < 0 || !Number.isInteger(ld) || !Number.isInteger(add) || add < 0) return notify("請輸入正確的整數");
              run(() => updateItemAction(item.id, { unitPrice: up, lineDiscount: ld, addQty: add || undefined, categoryId: edit.categoryId || null, specNote: edit.specNote }), { success: "已儲存明細", onOk: () => setMode(null) });
            }}
          >
            儲存
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="成交單價" inputMode="numeric" value={edit.unitPrice} onChange={(e) => setEdit({ ...edit, unitPrice: e.target.value })} />
          <TextField label="明細折扣" inputMode="numeric" value={edit.lineDiscount} onChange={(e) => setEdit({ ...edit, lineDiscount: e.target.value })} />
          <TextField label="增加數量" inputMode="numeric" value={edit.addQty} placeholder="0" onChange={(e) => setEdit({ ...edit, addQty: e.target.value })} hint="減少數量請用「取消數量」，才會留下取消紀錄" />
          <SelectField label="銷售歸屬分類" value={edit.categoryId} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value })} options={[["", "未歸類"], ...categories.map((c) => [c.id, c.name] as [string, string])]} />
          <TextField label="規格備註" value={edit.specNote} onChange={(e) => setEdit({ ...edit, specNote: e.target.value })} className="sm:col-span-2" />
        </div>
      </Modal>
    </>
  );
}

export function FlagSelect({ itemId, kind, value, disabled }: { itemId: string; kind: "purchase" | "pack"; value: string; disabled: boolean }) {
  const { run, pending } = useRun();
  const opts = kind === "purchase" ? purchaseFlag : packFlag;
  return (
    <select
      aria-label={kind === "purchase" ? "採購狀態" : "備貨狀態"}
      disabled={disabled || pending}
      value={value}
      className="rounded-md border border-line bg-white px-1.5 py-1 text-[13px]"
      onChange={(e) =>
        run(() => updateItemAction(itemId, kind === "purchase" ? { purchaseFlag: e.target.value as never } : { packFlag: e.target.value as never }), { success: "已更新狀態" })
      }
    >
      {Object.entries(opts).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

export function ReserveButtons({ itemId, need, reserved, available }: { itemId: string; need: number; reserved: number; available: number }) {
  const { run, pending } = useRun();
  const can = Math.min(need, Math.max(0, available));
  return (
    <div className="flex flex-wrap gap-1">
      {can > 0 && (
        <Button small loading={pending} onClick={() => run(() => reserveAction(itemId, can), { success: `已保留 ${can} 件` })}>
          保留庫存 {can} 件
        </Button>
      )}
      {reserved > 0 && (
        <Button small variant="ghost" loading={pending} onClick={() => run(() => unreserveAction(itemId, reserved), { success: "已取消保留" })}>
          取消保留
        </Button>
      )}
    </div>
  );
}

export function PaymentForm({ orderId, balance }: { orderId: string; balance: number }) {
  const [f, setF] = useState({ amount: balance > 0 ? String(balance) : "", paidAt: toDateTimeInput(new Date()), method: "轉帳", reference: "", note: "" });
  const { run, pending } = useRun();
  const idem = useIdemKey();
  return (
    <form
      className="grid gap-2 sm:grid-cols-2 sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const amount = int(f.amount);
        if (!Number.isInteger(amount) || amount <= 0) return notify("付款金額必須是正整數");
        run(() => addPaymentAction({ orderId, amount, paidAt: f.paidAt, method: f.method, reference: f.reference || null, note: f.note || null, dedupeKey: idem.key }), {
          success: `已登記收款 ${formatTwd(amount)}`,
          onOk: () => {
            idem.renew();
            setF({ ...f, amount: "", reference: "", note: "" });
          },
        });
      }}
    >
      <TextField label="金額" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <TextField label="付款時間" type="datetime-local" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} />
      <SelectField label="方式" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={[["轉帳", "轉帳"], ["現金", "現金"], ["LINE Pay", "LINE Pay"], ["街口", "街口"], ["其他", "其他"]]} />
      <TextField label="識別資訊／備註" value={f.reference} placeholder="例：末五碼 12345" onChange={(e) => setF({ ...f, reference: e.target.value })} />
      <Button type="submit" variant="primary" loading={pending} className="sm:col-span-2 sm:justify-self-start">
        登記收款
      </Button>
    </form>
  );
}

export function VoidPaymentButton({ id, amount }: { id: string; amount: number }) {
  const [reason, setReason] = useState("");
  const { run } = useRun();
  return (
    <ConfirmButton
      small
      variant="danger"
      label="作廢"
      title={`作廢收款 ${formatTwd(amount)}`}
      message={
        <div className="space-y-3">
          <p>用於登記錯誤的收款。作廢後不計入已收，但紀錄會保留。實際退錢給買家請用「建立退款」。</p>
          <TextField label="作廢原因（必填）" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      }
      confirmLabel="作廢收款"
      onConfirm={() => (reason.trim() ? run(() => voidPaymentAction(id, reason), { success: "已作廢收款" }) : notify("請填寫作廢原因"))}
    />
  );
}

export function RefundForm({ orderId, suggested, max }: { orderId: string; suggested: number; max: number }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: suggested > 0 ? String(suggested) : "", reason: "", method: "轉帳", completed: false });
  const { run, pending } = useRun();
  const idem = useIdemKey();
  return (
    <>
      <Button
        small
        disabled={max <= 0}
        onClick={() => {
          setF((x) => ({ ...x, amount: suggested > 0 ? String(suggested) : "" }));
          setOpen(true);
        }}
      >
        建立退款
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="建立退款"
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              const amount = int(f.amount);
              if (!Number.isInteger(amount) || amount <= 0) return notify("退款金額必須是正整數");
              run(() => createRefundAction({ orderId, amount, reason: f.reason || null, method: f.method, completed: f.completed, dedupeKey: idem.key }), {
                success: f.completed ? "已登記退款完成" : "已建立待退款",
                onOk: () => {
                  idem.renew();
                  setOpen(false);
                },
              });
            }}
          >
            {f.completed ? "登記已退款" : "建立待退款"}
          </Button>
        }
      >
        <p className="mb-3 text-sm text-ink-2">
          可退金額上限 {formatTwd(max)}。{suggested > 0 ? `目前溢收 ${formatTwd(suggested)}。` : ""}待退款不會計入已退款，實際退出後再標記完成。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="退款金額" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <SelectField label="退款方式" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={[["轉帳", "轉帳"], ["現金", "現金"], ["LINE Pay", "LINE Pay"], ["其他", "其他"]]} />
          <TextField label="退款原因" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="sm:col-span-2" />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4" checked={f.completed} onChange={(e) => setF({ ...f, completed: e.target.checked })} />
            已經實際退款給買家
          </label>
        </div>
      </Modal>
    </>
  );
}

export function RefundRowActions({ id, status }: { id: string; status: string }) {
  const { run, pending } = useRun();
  const [reason, setReason] = useState("");
  if (status !== "PENDING") return null;
  return (
    <div className="flex flex-wrap gap-1">
      <ConfirmButton small variant="primary" label="標記已退款" title="確認已退款" message="確認款項已經實際退給買家？標記後會計入已退款。" confirmLabel="已退款" onConfirm={() => run(() => completeRefundAction(id, null), { success: "已標記退款完成" })} />
      <ConfirmButton
        small
        variant="danger"
        label="作廢"
        title="作廢退款"
        message={<TextField label="作廢原因（必填）" value={reason} onChange={(e) => setReason(e.target.value)} />}
        confirmLabel="作廢退款"
        disabled={pending}
        onConfirm={() => (reason.trim() ? run(() => voidRefundAction(id, reason), { success: "已作廢退款" }) : notify("請填寫作廢原因"))}
      />
    </div>
  );
}
