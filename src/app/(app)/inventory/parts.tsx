"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, TextField, SelectField, useRun, useIdemKey, inputCls, notify } from "@/components/client";
import { ProductPicker, type ProductOpt } from "@/components/pickers";
import { receiveAction, allocateAction, adjustAction, createBatchAction } from "@/actions/ops";
import { OperatorPicker, type OperatorOption } from "@/components/operator-picker";
import { keepAction } from "@/actions/batches";
import { OwnerChips, defaultOwner, type OwnerStockOpt } from "@/components/owner-chips";

type Plan = { orderItemId: string; orderNo: string; buyerName: string; need: number; allocate: number };

/** 到貨登記：入庫後列出待出貨的訂單，確認後保留給訂單 */
export function ReceiveForm({ initialProduct, batchItems, operators }: { initialProduct: ProductOpt | null; batchItems: { id: string; productId: string; label: string; remaining: number; defaultReceiver: string | null }[]; operators: OperatorOption[] }) {
  const [product, setProduct] = useState<ProductOpt | null>(initialProduct);
  const [source, setSourceRaw] = useState("");
  const [receiver, setReceiver] = useState<string | null>(null);
  const [defect, setDefect] = useState("");
  const setSource = (v: string) => {
    setSourceRaw(v);
    setReceiver(batchItems.find((b) => b.id === v)?.defaultReceiver ?? null);
  };
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
        {source !== "" && <TextField label="其中瑕疵（選填，不入庫）" inputMode="numeric" value={defect} onChange={(e) => setDefect(e.target.value)} placeholder="0" />}
        {source !== "" && (
          <div className="sm:col-span-2">
            <OperatorPicker label="收貨確認人" required allowNone={false} operators={operators} value={receiver} onChange={setReceiver} hint="多個品項一起到貨時，建議到採購團頁面一次登記整批收貨" />
          </div>
        )}
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
          const dq = defect.trim() === "" ? 0 : Number(defect);
          if (source && (!Number.isInteger(dq) || dq < 0 || dq > n)) return notify("瑕疵數量必須是 0 到到貨數量之間的整數");
          if (source && !receiver) return notify("請選擇收貨確認人");
          run(() => receiveAction({ productId: product.id, qty: n, batchItemId: source || null, unitCostTwd: c, reason: reason || null, dedupeKey: idem.key, receivedById: source ? receiver : null, defectQty: source ? dq : 0 }), {
            success: source && dq ? `已登記到貨 ${n} 件（良品 ${n - dq} 件入庫）` : `已登記到貨 ${n} 件`,
            onOk: (d) => {
              idem.renew();
              setDefect("");
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

/** 自留／改回出售：自留的不算可售庫存，成本來源保留 */
export function KeepButton({ productId, name, available, kept, small, tiny, owners, me }: { productId: string; name: string; available: number; kept: number; small?: boolean; tiny?: boolean; owners?: OwnerStockOpt[]; me?: string | null }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"keep" | "sell">("keep");
  const [n, setN] = useState(1);
  const [owner, setOwner] = useState<string | null>(null);
  const idem = useIdemKey();
  const { run, pending } = useRun();
  if (available <= 0 && kept <= 0) return null;
  const cur = owners?.find((o) => o.key === owner);
  const avail = cur ? cur.free : available;
  const keptN = cur ? cur.kept : kept;
  const max = mode === "keep" ? Math.max(0, avail) : keptN;
  const countOf = (m: "keep" | "sell") => (o: OwnerStockOpt) => (m === "keep" ? o.free : o.kept);
  return (
    <>
      {(() => {
        const openIt = () => {
          const m = available > 0 ? "keep" : "sell";
          setMode(m);
          setOwner(defaultOwner(owners, me, countOf(m)));
          setN(1);
          setOpen(true);
        };
        // tiny：表格裡小小的「留」，不搶「賣」的位置
        return tiny ? (
          <button type="button" onClick={openIt} aria-label={`自留${kept ? ` ${kept}` : ""}`} className="px-1.5 py-1 text-[13px] text-ai underline-offset-2 hover:underline">
            留
          </button>
        ) : (
          <Button small={small} onClick={openIt}>
            自留{kept ? ` ${kept}` : ""}
          </Button>
        );
      })()}
      <Modal open={open} onClose={() => setOpen(false)} title={`自留：${name}`} footer={
        <Button variant="primary" loading={pending} disabled={n < 1 || n > max} onClick={() => run(() => keepAction({ productId, delta: mode === "keep" ? n : -n, dedupeKey: idem.key, owner }), { success: mode === "keep" ? `已自留 ${n} 件` : `已改回出售 ${n} 件`, onOk: () => { idem.renew(); setOpen(false); } })}>
          {mode === "keep" ? `自留 ${n} 件` : `改回出售 ${n} 件`}
        </Button>
      }>
        <div role="radiogroup" aria-label="操作" className="mb-4 grid grid-cols-2 gap-2">
          {([["keep", `留給自己（可售 ${Math.max(0, avail)}）`], ["sell", `改回出售（自留 ${keptN}）`]] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} disabled={k === "keep" ? available <= 0 : kept <= 0} onClick={() => { setMode(k); setOwner(defaultOwner(owners, me, countOf(k))); setN(1); }} className={`min-h-11 rounded-lg border px-2 text-sm disabled:opacity-40 ${mode === k ? "border-ai bg-ai text-white" : "border-line bg-white"}`}>{l}</button>
          ))}
        </div>
        <div className="mb-4">
          <OwnerChips label="留誰的" owners={owners ?? []} value={owner} onChange={(k) => { setOwner(k); setN(1); }} count={countOf(mode)} />
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={() => setN((x) => Math.max(1, x - 1))} aria-label="減少">－</Button>
          <input aria-label="數量" inputMode="numeric" className={`${inputCls} num w-20 text-center text-lg`} value={n} onChange={(e) => setN(Number(e.target.value.replace(/\D/g, "")) || 0)} />
          <Button onClick={() => setN((x) => Math.min(max, x + 1))} aria-label="增加">＋</Button>
        </div>
        <p className="mt-3 text-[13px] text-mute">自留的商品不會算進可售庫存，也不會被分配給買家；原本的採購成本來源會保留。已保留給買家的數量不能自留。</p>
      </Modal>
    </>
  );
}
