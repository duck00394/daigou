"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, TextField, SelectField, TextArea, useRun, useIdemKey, useLeaveGuard, inputCls, notify } from "@/components/client";
import { BuyerPicker, ProductPicker, type BuyerOpt, type ProductOpt } from "@/components/pickers";
import { createOrderAction, appendItemsAction, buyerWarningsAction } from "@/actions/orders";
import { saveBuyerAction } from "@/actions/buyers";
import { formatTwd } from "@/lib/money";
import { toDateTimeInput } from "@/lib/labels";

type Line = { key: number; product: ProductOpt | null; qty: string; price: string; discount: string; spec: string; categoryId: string };
type Warn = { tags: { name: string; color: string; reason: string | null }[]; openOrders: { id: string; orderNo: string; balanceCache: number; groupBuyId: string | null; statusCache: string }[]; cancelledCount: number };

let seq = 1;
const newLine = (): Line => ({ key: seq++, product: null, qty: "1", price: "", discount: "", spec: "", categoryId: "" });

export function NewOrderForm({ groupBuys, initialBuyer }: { groupBuys: { id: string; name: string }[]; initialBuyer: BuyerOpt | null }) {
  const [buyer, setBuyer] = useState<BuyerOpt | null>(initialBuyer);
  const [warn, setWarn] = useState<Warn | null>(null);
  const [mode, setMode] = useState<"NEW" | "APPEND" | "NEW_LINKED">("NEW");
  const [targetOrder, setTargetOrder] = useState("");
  const [groupBuyId, setGroupBuyId] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  useLeaveGuard(lines.some((l) => l.product));
  const [shipping, setShipping] = useState("0");
  const [confirming, setConfirming] = useState(false);
  const [discount, setDiscount] = useState("0");
  const [confirmation, setConfirmation] = useState<"CONFIRMED" | "PENDING">("CONFIRMED");
  const [orderedAt, setOrderedAt] = useState(toDateTimeInput(new Date()));
  const [notes, setNotes] = useState("");
  const { run, pending } = useRun();
  const idem = useIdemKey();
  const router = useRouter();

  useEffect(() => {
    setWarn(null);
    setTargetOrder("");
    if (!buyer) return;
    buyerWarningsAction(buyer.id).then((r) => r.ok && setWarn(r.data));
  }, [buyer]);

  const total = useMemo(() => {
    let goods = 0;
    for (const l of lines) {
      const q = Number(l.qty) || 0;
      const p = l.price === "" ? (l.product?.salePriceTwd ?? 0) : Number(l.price) || 0;
      goods += q * p - (Number(l.discount) || 0);
    }
    return mode === "APPEND" ? goods : goods - (Number(discount) || 0) + (Number(shipping) || 0);
  }, [lines, shipping, discount, mode]);

  const upd = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit(go = false) {
    if (!buyer) return notify("請選擇買家");
    const items: { productId: string; qty: number; unitPrice: number | null; lineDiscount: number; specNote: string | null; categoryId: string | null }[] = [];
    for (const l of lines) {
      if (!l.product) return notify("每一列都要選擇商品，或刪除空白列");
      const qty = Number(l.qty);
      if (!Number.isInteger(qty) || qty <= 0) return notify(`「${l.product.name}」的數量必須是正整數`);
      const price = l.price === "" ? null : Number(l.price);
      if (price !== null && (!Number.isInteger(price) || price < 0)) return notify(`「${l.product.name}」的單價必須是整數`);
      if (price === null && l.product.salePriceTwd === null) return notify(`「${l.product.name}」沒有預設售價，請填寫單價`);
      items.push({ productId: l.product.id, qty, unitPrice: price, lineDiscount: Number(l.discount) || 0, specNote: l.spec || null, categoryId: l.categoryId || null });
    }
    if (mode === "APPEND" && !targetOrder) return notify("請選擇要追加的原訂單");
    if (mode === "NEW_LINKED" && !targetOrder) return notify("請選擇原訂單");
    if (mode !== "APPEND" && !/^\d+$/.test(shipping.trim())) return notify("運費請填 0 以上的整數（不收填 0）");
    // 送出前先看確認清單，按「確認送出」才成立
    if (!go) return setConfirming(true);
    if (mode === "APPEND") {
      await run(() => appendItemsAction(targetOrder, items, notes || null, idem.key), { success: "已追加到原訂單", onOk: () => { idem.renew(); router.push(`/orders/${targetOrder}`); } });
      return;
    }
    await run(
      () =>
        createOrderAction({
          buyerId: buyer.id,
          groupBuyId: groupBuyId || null,
          parentOrderId: mode === "NEW_LINKED" ? targetOrder : null,
          orderedAt,
          confirmation,
          shippingFee: Number(shipping) || 0,
          orderDiscount: Number(discount) || 0,
          notes: notes || null,
          items,
          idempotencyKey: idem.key,
        }),
      { success: (d) => `已建立訂單 ${d.orderNo}`, onOk: (d) => { setConfirming(false); router.push(`/orders/${d.id}`); } },
    );
  }

  const openOrders = warn?.openOrders ?? [];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <BuyerPicker
          value={buyer}
          onPick={setBuyer}
          extra={(q, close) =>
            q.trim() ? (
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-ai hover:bg-ai-soft"
                onClick={async () => {
                  const r = await saveBuyerAction(null, { name: q.trim() });
                  if (r.ok) {
                    setBuyer({ id: r.data.id, name: q.trim(), code: (r.data as { code?: string }).code ?? "", lineName: null });
                    close();
                  } else notify(r.error);
                }}
              >
                新增買家「{q.trim()}」
              </button>
            ) : null
          }
        />
        <SelectField label="代購團" value={groupBuyId} onChange={(e) => setGroupBuyId(e.target.value)} options={[["", "不指定"], ...groupBuys.map((g) => [g.id, g.name] as [string, string])]} />
      </div>

      {warn && (warn.tags.length > 0 || openOrders.length > 0 || warn.cancelledCount > 0) && (
        <div role="note" className="rounded-xl border border-[#f0dfa8] bg-warn-soft px-4 py-3 text-sm text-ink">
          {warn.tags.length > 0 && (
            <p className="mb-1">
              <b>標籤提醒：</b>
              {warn.tags.map((t) => `${t.name}${t.reason ? `（${t.reason}）` : ""}`).join("、")}。只是提醒，是否接單由你決定。
            </p>
          )}
          {openOrders.length > 0 && <p className="mb-1">這位買家有 {openOrders.length} 張進行中的訂單，待收合計 {formatTwd(openOrders.reduce((s, o) => s + o.balanceCache, 0))}。</p>}
          {warn.cancelledCount > 0 && <p>曾有 {warn.cancelledCount} 筆取消紀錄。</p>}
        </div>
      )}

      <fieldset>
        <legend className="mb-1 text-[13px] font-medium text-ink-2">建立方式</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ["NEW", "新訂單"],
              ["APPEND", "追加到原訂單"],
              ["NEW_LINKED", "獨立追加訂單（連結原訂單）"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 ${mode === v ? "border-ai bg-ai-soft" : "border-line bg-white"}`}>
              <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} />
              {l}
            </label>
          ))}
        </div>
        {mode !== "NEW" && (
          <div className="mt-2 max-w-md">
            <SelectField
              label="原訂單"
              value={targetOrder}
              onChange={(e) => {
                setTargetOrder(e.target.value);
                const o = openOrders.find((x) => x.id === e.target.value);
                if (o && mode === "NEW_LINKED") setGroupBuyId(o.groupBuyId ?? "");
              }}
              options={[["", buyer ? (openOrders.length ? "請選擇" : "這位買家沒有進行中的訂單") : "請先選擇買家"], ...openOrders.map((o) => [o.id, o.orderNo] as [string, string])]}
              hint={mode === "APPEND" ? "新增的明細會標記為追加，原明細不變；運費與折扣沿用原訂單" : "建立一張新訂單並連結原訂單，代購團需相同"}
            />
          </div>
        )}
      </fieldset>

      <div>
        <div className="mb-1 text-[13px] font-medium text-ink-2">商品明細</div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={l.key} className="rounded-xl border border-line bg-[#fbfcfd] p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem_7rem]">
                <ProductPicker value={l.product} onPick={(p) => upd(l.key, { product: p, categoryId: "" })} label={`商品 ${i + 1}`} />
                <TextField label="數量" inputMode="numeric" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} />
                <TextField label="成交單價" inputMode="numeric" value={l.price} placeholder={l.product?.salePriceTwd != null ? String(l.product.salePriceTwd) : "必填"} onChange={(e) => upd(l.key, { price: e.target.value })} />
                <TextField label="明細折扣" inputMode="numeric" value={l.discount} placeholder="0" onChange={(e) => upd(l.key, { discount: e.target.value })} />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
                <input className={inputCls} placeholder="規格／款式備註（選填）" value={l.spec} onChange={(e) => upd(l.key, { spec: e.target.value })} aria-label="規格備註" />
                {l.product && l.product.categories.length > 1 ? (
                  <select className={inputCls} value={l.categoryId} onChange={(e) => upd(l.key, { categoryId: e.target.value })} aria-label="銷售歸屬分類">
                    <option value="">歸屬分類：自動</option>
                    {l.product.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        歸屬：{c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div />
                )}
                {lines.length > 1 && (
                  <Button variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    刪除此列
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <Button className="mt-2" onClick={() => setLines((ls) => [...ls, newLine()])}>
          新增一列
        </Button>
      </div>

      {mode !== "APPEND" && (
        <div className="grid gap-3 sm:grid-cols-4">
          <TextField label="運費" inputMode="numeric" value={shipping} onChange={(e) => setShipping(e.target.value.replace(/\D/g, ""))} />
          <TextField label="整單折扣" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} hint="負數代表加價" />
          <TextField label="訂單時間" type="datetime-local" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} />
          <SelectField label="訂單狀態" value={confirmation} onChange={(e) => setConfirmation(e.target.value as "CONFIRMED" | "PENDING")} options={[["CONFIRMED", "已確認"], ["PENDING", "待確認"]]} hint="待確認的訂單不計入有效統計" />
        </div>
      )}
      <TextArea label={mode === "APPEND" ? "追加備註" : "訂單備註"} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="sticky bottom-16 z-20 flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 shadow-sm md:bottom-4">
        <span className="text-sm">
          {mode === "APPEND" ? "追加金額" : "應收"}：<b className="num text-[17px]">{formatTwd(total)}</b>
        </span>
        <Button variant="primary" loading={pending} onClick={() => submit()}>
          {mode === "APPEND" ? "追加到原訂單" : "建立訂單"}
        </Button>
      </div>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="確認這張訂單"
        footer={
          <div className="flex w-full gap-2">
            <Button className="flex-1" onClick={() => setConfirming(false)}>返回修改</Button>
            <Button className="flex-[2]" variant="primary" loading={pending} onClick={() => submit(true)}>確認送出</Button>
          </div>
        }
      >
        <div className="space-y-2 text-[14.5px]" data-testid="order-confirm">
          <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1">
            <dt className="text-mute">客人</dt><dd>{buyer?.name}</dd>
            {mode === "APPEND" && <><dt className="text-mute">追加到</dt><dd>{openOrders.find((o) => o.id === targetOrder)?.orderNo ?? ""}</dd></>}
          </dl>
          <ul className="divide-y divide-line-2 rounded-lg border border-line-2">
            {lines.filter((l) => l.product).map((l) => {
              const q = Number(l.qty) || 0;
              const pr = l.price === "" ? (l.product?.salePriceTwd ?? 0) : Number(l.price) || 0;
              return (
                <li key={l.key} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                  <span className="min-w-0">{l.product!.name} × {q}{l.spec ? <span className="ml-1 text-[12px] text-mute">{l.spec}</span> : null}</span>
                  <span className="num shrink-0">{formatTwd(q * pr - (Number(l.discount) || 0))}</span>
                </li>
              );
            })}
            {mode !== "APPEND" && <li className="flex justify-between px-3 py-1.5"><span>運費</span><span className="num">{formatTwd(Number(shipping) || 0)}</span></li>}
            {mode !== "APPEND" && Number(discount) !== 0 && <li className="flex justify-between px-3 py-1.5"><span>整單折扣</span><span className="num">－{formatTwd(Number(discount) || 0)}</span></li>}
          </ul>
          <div className="flex items-baseline justify-between text-[16px] font-semibold"><span>{mode === "APPEND" ? "追加金額" : "應收"}</span><span className="num" data-testid="order-confirm-total">{formatTwd(total)}</span></div>
        </div>
      </Modal>
    </div>
  );
}
