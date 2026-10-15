"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, TextField, SelectField, useRun, useIdemKey, inputCls, notify } from "@/components/client";
import { ProductPicker, type ProductOpt } from "@/components/pickers";
import { receiveAction, allocateAction, adjustAction, createBatchAction } from "@/actions/ops";

type Plan = { orderItemId: string; orderNo: string; buyerName: string; need: number; allocate: number };

/** 到貨登記：入庫後列出待出貨的訂單，確認後保留給訂單 */
export function ReceiveForm({ initialProduct, batchItems }: { initialProduct: ProductOpt | null; batchItems: { id: string; productId: string; label: string; remaining: number }[] }) {
  const [product, setProduct] = useState<ProductOpt | null>(initialProduct);
  const [source, setSource] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<{ plan: Plan[]; unallocated: number; batchItemId: string | null } | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const { run, pending } = useRun();
  const idem = useIdemKey();
  const options = batchItems.filter((b) => b.productId === product?.id && b.remaining > 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <ProductPicker value={product} onPick={(p) => { setProduct(p); setSource(""); setPlan(null); }} />
        <SelectField
          label="到貨來源"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          options={[["", "手動入庫（不屬於採購團）"], ...options.map((o) => [o.id, `${o.label}（未到 ${o.remaining} 件）`] as [string, string])]}
          hint={product && options.length === 0 ? "這個商品沒有未到貨的採購明細" : "選採購團時，成本會依採購團匯率與分攤費用計算"}
        />
        <TextField label="到貨數量" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        {source === "" ? <TextField label="單件成本（台幣，選填）" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} hint="空白時銷貨成本改用訂單的預估成本" /> : <div />}
        {source === "" && <TextField label="原因" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：期初庫存、現貨購入" className="sm:col-span-2" />}
      </div>
      <Button
        variant="primary"
        loading={pending}
        onClick={() => {
          const n = Number(qty);
          if (!product) return notify("請選擇商品");
          if (!Number.isInteger(n) || n <= 0) return notify("到貨數量必須是正整數");
          const c = cost.trim() === "" ? null : Number(cost);
          if (c !== null && (!Number.isInteger(c) || c < 0)) return notify("成本必須是整數");
          run(() => receiveAction({ productId: product.id, qty: n, batchItemId: source || null, unitCostTwd: c, reason: reason || null, dedupeKey: idem.key }), {
            success: `已登記到貨 ${n} 件`,
            onOk: (d) => {
              idem.renew();
              setPlan({ ...d, batchItemId: source || null });
              setAlloc(Object.fromEntries(d.plan.map((p) => [p.orderItemId, String(p.allocate)])));
            },
          });
        }}
      >
        登記到貨
      </Button>
      <Modal
        open={!!plan}
        onClose={() => setPlan(null)}
        title="分配給待出貨的訂單"
        wide
        footer={
          <>
            <Button onClick={() => setPlan(null)}>先不分配</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => {
                const items = Object.entries(alloc).map(([orderItemId, v]) => ({ orderItemId, qty: Number(v) })).filter((x) => Number.isInteger(x.qty) && x.qty > 0);
                if (!items.length) return setPlan(null);
                run(() => allocateAction(items, plan?.batchItemId ?? null), { success: (n) => `已保留 ${n} 件給訂單`, onOk: () => setPlan(null) });
              }}
            >
              確認保留
            </Button>
          </>
        }
      >
        {plan && (
          <div>
            <p className="mb-2 text-sm text-ink-2">依下單先後排序，已預填建議數量；可以調整。保留後才算「已到貨」，出貨時從保留中扣除。</p>
            {plan.plan.length === 0 ? (
              <p className="text-sm text-mute">目前沒有需要這個商品的訂單，到貨數量會成為可用庫存。</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-mute">
                    <th className="py-1">訂單</th>
                    <th>買家</th>
                    <th className="text-right">尚需</th>
                    <th className="w-24 text-right">保留</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.plan.map((p) => (
                    <tr key={p.orderItemId} className="border-t border-line-2">
                      <td className="num py-1.5">{p.orderNo}</td>
                      <td>{p.buyerName}</td>
                      <td className="num text-right">{p.need}</td>
                      <td className="text-right">
                        <input className={`${inputCls} w-20 py-1 text-right`} inputMode="numeric" value={alloc[p.orderItemId] ?? ""} onChange={(e) => setAlloc({ ...alloc, [p.orderItemId]: e.target.value })} aria-label={`保留給 ${p.orderNo}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {plan.unallocated > 0 && <p className="mt-2 text-sm text-mute">尚有 {plan.unallocated} 件沒有對應的訂單，會留在可用庫存。</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function AdjustForm() {
  const [product, setProduct] = useState<ProductOpt | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [cost, setCost] = useState("");
  const { run, pending } = useRun();
  const idem = useIdemKey();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ProductPicker value={product} onPick={setProduct} />
      <TextField label="調整數量（正數增加、負數減少）" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} />
      <TextField label="原因（必填）" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：盤點差異、商品損壞" />
      <TextField label="單件成本（增加時，選填）" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
      <div>
        <Button
          variant="primary"
          loading={pending}
          onClick={() => {
            const d = Number(delta);
            if (!product) return notify("請選擇商品");
            if (!Number.isInteger(d) || d === 0) return notify("調整數量必須是非 0 整數");
            run(() => adjustAction({ productId: product.id, delta: d, reason, unitCostTwd: cost ? Number(cost) : null, dedupeKey: idem.key }), { success: "已調整庫存", onOk: () => { idem.renew(); setDelta(""); setReason(""); } });
          }}
        >
          調整庫存
        </Button>
      </div>
    </div>
  );
}

/** 從待下單清單建立採購團 */
export function CreateBatchFromDemand({ demand, defaultRate }: { demand: { productId: string; name: string; code: string; qty: number; jpy: number | null; itemIds: string[] }[]; defaultRate: string }) {
  const [sel, setSel] = useState<Record<string, { on: boolean; qty: string; jpy: string }>>(() => Object.fromEntries(demand.map((d) => [d.productId, { on: true, qty: String(d.qty), jpy: d.jpy == null ? "" : String(d.jpy) }])));
  const [name, setName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [rate, setRate] = useState(defaultRate);
  const [open, setOpen] = useState(false);
  const { run, pending } = useRun();
  const router = useRouter();
  const chosen = demand.filter((d) => sel[d.productId]?.on);
  return (
    <>
      <Button variant="primary" disabled={demand.length === 0} onClick={() => setOpen(true)}>
        建立採購團
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        wide
        title="建立採購團"
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              if (!name.trim()) return notify("請填寫採購團名稱");
              const items: { productId: string; qty: number; unitCost: number; currency: "JPY"; markOrderItemIds: string[] }[] = [];
              for (const d of chosen) {
                const s = sel[d.productId];
                const q = Number(s.qty);
                const j = Number(s.jpy);
                if (!Number.isInteger(q) || q <= 0) return notify(`「${d.name}」的數量必須是正整數`);
                if (s.jpy === "" || !Number.isInteger(j) || j < 0) return notify(`請填寫「${d.name}」的日幣單價`);
                items.push({ productId: d.productId, qty: q, unitCost: j, currency: "JPY", markOrderItemIds: d.itemIds });
              }
              if (!items.length) return notify("請至少選一項商品");
              run(() => createBatchAction({ name, supplier: supplier || null, rate, orderedAt: null, notes: null, items }), { success: "已建立採購團", onOk: (d) => router.push(`/inventory/batches/${d.id}`) });
            }}
          >
            建立採購團並標記訂單為已下單
          </Button>
        }
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <TextField label="採購團名稱" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：10/15 官網下單" />
          <TextField label="供應商" value={supplier} onChange={(e) => setSupplier(e.target.value)} hint="輸入名稱；不存在時會自動建立" />
          <TextField label="匯率（1 日圓 = ? 台幣）" value={rate} onChange={(e) => setRate(e.target.value)} hint="建立後鎖定，之後修改預設匯率不影響這批" />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-mute">
              <th className="w-8"></th>
              <th>商品</th>
              <th className="w-24 text-right">數量</th>
              <th className="w-28 text-right">日幣單價</th>
            </tr>
          </thead>
          <tbody>
            {demand.map((d) => (
              <tr key={d.productId} className="border-t border-line-2">
                <td className="py-1.5"><input type="checkbox" className="h-4 w-4" checked={sel[d.productId]?.on} onChange={(e) => setSel({ ...sel, [d.productId]: { ...sel[d.productId], on: e.target.checked } })} aria-label={`選取 ${d.name}`} /></td>
                <td>{d.name}<span className="ml-1 text-[12px] text-mute">{d.code}</span></td>
                <td className="text-right"><input className={`${inputCls} w-20 py-1 text-right`} inputMode="numeric" value={sel[d.productId]?.qty} onChange={(e) => setSel({ ...sel, [d.productId]: { ...sel[d.productId], qty: e.target.value } })} aria-label="數量" /></td>
                <td className="text-right"><input className={`${inputCls} w-24 py-1 text-right`} inputMode="numeric" value={sel[d.productId]?.jpy} onChange={(e) => setSel({ ...sel, [d.productId]: { ...sel[d.productId], jpy: e.target.value } })} aria-label="日幣單價" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[12px] text-mute">相關訂單明細會標記為「已向供應商下單」。</p>
      </Modal>
    </>
  );
}
