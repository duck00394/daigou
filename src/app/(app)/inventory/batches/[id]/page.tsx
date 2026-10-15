import { notFound } from "next/navigation";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { landedCosts, minCommittedQty } from "@/server/services/purchase";
import { PageHeader, Section, TableWrap, Twd, Jpy, StatusBadge, Empty, KV, LinkButton, Stat } from "@/components/ui";
import { AddCost, DeleteCost, CancelBatch, Collapsible } from "./parts";
import { BulkAddGrid } from "./bulk-add";
import { BulkEditTable, type EditItem } from "./bulk-edit";
import { ResponsibilityCard, SupplierPayments, Receiving, type PaymentRow } from "./operators";
import { listOperators } from "@/server/services/operators";
import { supplierPaymentHistory } from "@/server/services/supplier-payments";
import { allocMethod, batchStatus, costKind, currencyName, fmtDate, paymentPurpose, supplierPaymentStatus, toDateTimeInput } from "@/lib/labels";
import { formatRate, jpyToTwd } from "@/lib/money";

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bulk?: string }> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const b = await prisma.purchaseBatch.findUnique({
    where: { id },
    include: {
      supplierRef: true,
      items: { orderBy: { createdAt: "asc" }, include: { product: true, movements: { select: { kind: true, onHandDelta: true } } } },
      costs: { orderBy: { createdAt: "asc" }, include: { allocations: true } },
      supplierPayments: { orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] },
      receivings: { orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }], include: { lines: { include: { batchItem: { include: { product: { select: { name: true } } } } } } } },
    },
  });
  if (!b) notFound();
  const [operators, history] = await Promise.all([tx((t) => listOperators(t, { includeInactive: true })), tx((t) => supplierPaymentHistory(t, b.supplierPayments.map((p) => p.id)))]);
  const ops = operators.map((o) => ({ id: o.id, name: o.name, code: o.code, active: o.active }));
  const opName = (id: unknown) => (typeof id === "string" ? (ops.find((o) => o.id === id)?.name ?? "（已移除）") : "未指定");
  const fieldName: Record<string, string> = { paidById: "付款人", paidAt: "日期", amount: "金額", currency: "幣別", rateMicro: "匯率", method: "方式", status: "狀態", reference: "編號", purpose: "用途", note: "備註" };
  const fmtVal = (k: string, v: unknown) =>
    v === null || v === undefined || v === "" ? "（空）" : k === "paidById" ? opName(v) : k === "paidAt" ? fmtDate(String(v), true) : k === "rateMicro" ? formatRate(Number(v)) : k === "currency" ? currencyName[String(v)] : k === "status" ? (supplierPaymentStatus[String(v)]?.[0] ?? String(v)) : k === "purpose" ? paymentPurpose[String(v)] : String(v);
  const payments: PaymentRow[] = b.supplierPayments.map((p) => ({
    id: p.id,
    paidById: p.paidById,
    paidAt: toDateTimeInput(p.paidAt),
    amount: p.amount,
    currency: p.currency as "JPY" | "TWD",
    rate: p.rateMicro ? formatRate(p.rateMicro) : null,
    method: p.method,
    status: p.status,
    reference: p.reference,
    purpose: p.purpose,
    note: p.note,
    voidReason: p.voidReason,
    twd: p.currency === "TWD" ? p.amount : p.rateMicro ? jpyToTwd(p.amount, p.rateMicro) : null,
    history: (history.get(p.id) ?? []).map((h) => {
      const d = (h.data ?? {}) as { before?: Record<string, unknown>; after?: Record<string, unknown>; reason?: string | null };
      const when = fmtDate(h.at, true);
      if (h.action === "supplierPayment.create") return `${when} 建立`;
      if (h.action === "supplierPayment.void") return `${when} 作廢：${d.reason ?? ""}`;
      const parts = Object.keys(d.after ?? {}).map((k) => `${fieldName[k] ?? k} ${fmtVal(k, d.before?.[k])} → ${fmtVal(k, d.after?.[k])}`);
      return `${when} 修改：${parts.join("；")}${d.reason ? `（原因：${d.reason}）` : ""}`;
    }),
  }));
  const [landed, series, types] = await Promise.all([
    tx((t) => landedCosts(t, b.items.map((i) => i.id))),
    prisma.series.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.productType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  const editItems: EditItem[] = [];
  for (const i of b.items) {
    const m = await tx((t) => minCommittedQty(t, i.id));
    const l = landed.get(i.id)!;
    editItems.push({
      id: i.id,
      productId: i.productId,
      name: i.product.name,
      specNote: i.specNote && !i.product.name.includes(i.specNote) ? i.specNote : null,
      qty: i.qty - i.cancelledQty,
      received: m.received,
      minQty: m.min,
      promisedNote: [m.received ? `已到貨 ${m.received}` : "", m.dependent ? `買家訂購靠這批 ${m.dependent}` : ""].filter(Boolean).join("、"),
      currency: i.currency as "JPY" | "TWD",
      estUnitCost: i.estUnitCost,
      actualUnitCost: i.actualUnitCost,
      salePriceTwd: i.salePriceTwd,
      goodsTwd: l.goodsTwd,
      feesTwd: l.feesTwd,
      canDelete: i.movements.length === 0 && m.min === 0,
    });
  }
  const open = b.status !== "CANCELLED";
  const totalLanded = [...landed.values()].reduce((s, l) => s + l.totalTwd, 0);
  const totalQty = editItems.reduce((s, i) => s + i.qty, 0);
  const received = editItems.reduce((s, i) => s + i.received, 0);
  const estimated = [...landed.values()].some((l) => l.estimated);
  const supplierName = b.supplierRef?.name ?? b.supplier;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${b.code} ${b.name}`}
        back={{ href: "/inventory?tab=batches", label: "採購團" }}
        sub={<span className="flex flex-wrap items-center gap-2"><StatusBadge map={batchStatus} value={b.status} />{supplierName && <span>供應商：{supplierName}</span>}</span>}
        actions={<><LinkButton href={`/inventory/batches/new?from=${b.id}`}>沿用負責人建立新團</LinkButton>{open && <CancelBatch id={b.id} />}</>}
      />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="採購品項" value={editItems.length} />
        <Stat label="總件數／已到貨" value={`${totalQty} / ${received}`} />
        <Stat label="總成本（台幣）" value={<Twd v={totalLanded} />} note={estimated ? "部分品項依預估單價" : "依實際單價"} />
        <Stat label="本團匯率（已鎖定）" value={formatRate(b.rateMicro)} note="1 日圓 = ? 台幣" />
      </div>

      <Section title="負責人">
        <ResponsibilityCard
          batchId={b.id}
          operators={ops}
          editable={open}
          value={{ orderedById: b.orderedById, paymentResponsibleById: b.paymentResponsibleById, receivingResponsibleById: b.receivingResponsibleById, responsibilityNote: b.responsibilityNote }}
        />
      </Section>

      {open && (
        <Collapsible title="批次新增系列商品" defaultOpen={sp.bulk === "1" || b.items.length === 0}>
          <BulkAddGrid
            batchId={b.id}
            supplierId={b.supplierId}
            supplierCurrency={(b.supplierRef?.defaultCurrency as "JPY" | "TWD") ?? "JPY"}
            rateMicro={b.rateMicro}
            series={series}
            types={types}
          />
        </Collapsible>
      )}

      <Section title={`採購品項（${editItems.length}）`} pad={false}>
        {editItems.length === 0 ? (
          <Empty>還沒有採購品項，請用上方「批次新增系列商品」加入。</Empty>
        ) : (
          <BulkEditTable batchId={b.id} items={editItems} editable={open} />
        )}
        <p className="px-4 py-2 text-[12px] text-mute">新增採購品項不代表已付款或到貨，也不會增加庫存；到貨請用「登記到貨」。數量不能低於已到貨與買家已訂購、只能靠這批到貨的數量。</p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`供應商付款（${payments.filter((p) => p.status !== "VOIDED").length}）`} pad={false}>
          <SupplierPayments
            batchId={b.id}
            operators={ops}
            payments={payments}
            editable={b.status !== "CANCELLED"}
            defaultPayer={b.paymentResponsibleById}
            defaultCurrency={(b.supplierRef?.defaultCurrency as "JPY" | "TWD") ?? "JPY"}
          />
        </Section>
        <Section title={`收貨清點（${b.receivings.length}）`} pad={false}>
          <Receiving
            batchId={b.id}
            operators={ops}
            editable={open}
            defaultReceiver={b.receivingResponsibleById}
            items={editItems.map((i) => ({ id: i.id, name: i.specNote ? `${i.name} ${i.specNote}` : i.name, ordered: i.qty, received: i.received }))}
            records={b.receivings.map((r) => ({
              id: r.id,
              receivedById: r.receivedById,
              receivedAt: r.receivedAt.toISOString(),
              note: r.note,
              lines: r.lines.map((l) => ({ name: l.batchItem.product.name, receivedQty: l.receivedQty, defectQty: l.defectQty, missingQty: l.missingQty, note: l.note })),
            }))}
          />
        </Section>
      </div>

      <Section title="共同費用與分攤" pad={false} actions={open && <AddCost batchId={b.id} items={b.items.filter((i) => i.qty - i.cancelledQty > 0).map((i) => ({ id: i.id, name: i.product.name }))} />}>
        {b.costs.length === 0 ? (
          <Empty>還沒有共同費用，例如代購費、國際運費、國內運費、關稅。</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr><th>費用</th><th className="text-right">金額</th><th className="text-right">台幣</th><th>分攤方式</th><th>分攤結果</th><th></th></tr>
            </thead>
            <tbody>
              {b.costs.map((c) => {
                const twd = c.currency === "JPY" ? jpyToTwd(c.amount, b.rateMicro) : c.amount;
                const sum = c.allocations.reduce((s, a) => s + a.amountTwd, 0);
                return (
                  <tr key={c.id}>
                    <td>{costKind[c.kind]}{c.note ? <div className="text-[12px] text-mute">{c.note}</div> : null}</td>
                    <td className="text-right">{c.currency === "JPY" ? <Jpy v={c.amount} /> : <Twd v={c.amount} />}</td>
                    <td className="text-right"><Twd v={twd} /></td>
                    <td>{allocMethod[c.method]}</td>
                    <td className="text-[13px]">
                      {c.allocations.map((a) => `${b.items.find((i) => i.id === a.batchItemId)?.product.name}：${a.amountTwd}`).join("、")}
                      <div className={sum === twd ? "text-good" : "text-bad"}>合計 {sum}{sum === twd ? "（與費用相符）" : "（與費用不符）"}</div>
                    </td>
                    <td>{open && <DeleteCost id={c.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>
      <Section>
        <KV items={[["供應商", supplierName], ["下單日", fmtDate(b.orderedAt)], ["本團匯率", `1 日圓 = ${formatRate(b.rateMicro)} 台幣（建立時鎖定，修改預設匯率不會影響）`], ["備註", b.notes]]} />
      </Section>
    </div>
  );
}
