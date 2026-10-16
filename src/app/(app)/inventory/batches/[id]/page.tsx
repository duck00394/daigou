import { notFound } from "next/navigation";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { landedCosts, minCommittedQty } from "@/server/services/purchase";
import { PageHeader, Section, Jpy, StatusBadge, Empty, LinkButton } from "@/components/ui";
import { AddCost, DeleteCost, CancelBatch } from "./parts";
import { type EditItem } from "./bulk-edit";
import { BatchInfoCard, CopyItemsButton } from "./manage";
import { ItemsPanel, PayOffButton, ReceiveAllButton } from "./items";
import Link from "next/link";
import { OwnerBadge } from "@/components/owner-badge";
import { batchPaySummary } from "@/server/services/batch-ops";
import { getMe } from "@/server/me";
import { listShippingMethods } from "@/server/services/shipping-methods";
import { ProgressBar, ResponsibilityCard, SupplierPayments, Receiving, type PaymentRow } from "./operators";
import { listOperators } from "@/server/services/operators";
import { jointWeights, sharePercents } from "@/server/services/ownership";
import { supplierPaymentHistory } from "@/server/services/supplier-payments";
import { allocMethod, batchStage, batchStageLabel, costKind, currencyName, dayInput, fmtDate, paymentPurpose, supplierPaymentStatus, toDateTimeInput } from "@/lib/labels";
import { formatRate, formatTwd, jpyToTwd } from "@/lib/money";

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bulk?: string }> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const b = await prisma.purchaseBatch.findUnique({
    where: { id },
    include: {
      supplierRef: true,
      category: { select: { id: true, name: true } },
      items: { orderBy: { createdAt: "asc" }, include: { product: true, movements: { select: { kind: true, onHandDelta: true } } } },
      costs: { orderBy: { createdAt: "asc" }, include: { allocations: true } },
      supplierPayments: { orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] },
      receivings: { orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }], include: { lines: { include: { batchItem: { include: { product: { select: { name: true } } } } } } } },
    },
  });
  if (!b) notFound();
  const [operators, history] = await Promise.all([tx((t) => listOperators(t, { includeInactive: true })), tx((t) => supplierPaymentHistory(t, b.supplierPayments.map((p) => p.id)))]);
  const ops = operators.map((o) => ({ id: o.id, name: o.name, code: o.code, active: o.active }));
  const shippingPresets = (await listShippingMethods(prisma)).map((x) => ({ id: x.id, name: x.name, kind: x.kind, currency: x.currency, amount: x.amount }));
  const opName = (id: unknown) => (typeof id === "string" ? (ops.find((o) => o.id === id)?.name ?? "（已移除）") : "未指定");
  const feeTotal = b.costs.reduce((s, c) => s + (c.currency === "JPY" ? jpyToTwd(c.amount, b.rateMicro) : c.amount), 0);
  const ownerLabel = b.ownership === "JOINT" ? "跟著這團（合資）" : b.orderedById ? `${opName(b.orderedById)}（這團主人）` : "這團（未指定主人）";
  const payerText = (c: { payer: string | null; shareSplit: unknown }) =>
    !c.payer ? ownerLabel.replace("跟著這團（合資）", "合資（依付款比例）") : c.payer === "joint" ? `兩人一起付：${Object.entries((c.shareSplit ?? {}) as Record<string, number>).map(([k, v]) => `${opName(k)} ${formatTwd(v)}`).join("、")}` : `${opName(c.payer)}付的`;
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
  const [suppliersList, categoriesList, otherBatches] = await Promise.all([
    prisma.supplier.findMany({ where: { OR: [{ active: true }, { id: b.supplierId ?? "" }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { OR: [{ active: true }, { id: b.categoryId ?? "" }] }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.purchaseBatch.findMany({ where: { id: { not: b.id }, items: { some: {} } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, code: true, name: true, supplierRef: { select: { name: true } } } }),
  ]);
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
      cancelledQty: i.cancelledQty,
      cancelReason: i.cancelReason,
    });
  }
  const open = b.status !== "CANCELLED";
  const totalLanded = [...landed.values()].reduce((s, l) => s + l.totalTwd, 0);
  const totalQty = editItems.reduce((s, i) => s + i.qty, 0);
  const received = editItems.reduce((s, i) => s + i.received, 0);
  const estimated = [...landed.values()].some((l) => l.estimated);
  const supplierName = b.supplierRef?.name ?? b.supplier;
  const pay = (await tx((t) => batchPaySummary(t, [b.id]))).get(b.id) ?? { totalTwd: totalLanded, paidTwd: 0, dueTwd: totalLanded };
  const me = await getMe();
  return (
    <div className="space-y-4">
      <PageHeader
        title={b.name}
        back={{ href: "/inventory?tab=batches", label: "採購團" }}
        sub={<span className="flex flex-wrap items-center gap-2"><OwnerBadge k={b.ownership === "JOINT" ? "joint" : b.orderedById} name={b.ownership === "JOINT" ? "合資" : opName(b.orderedById)} ids={ops.map((o) => o.id)} /><StatusBadge map={batchStageLabel} value={batchStage(b)} />{b.category && <a href={`/categories/${b.category.id}`} className="text-ai hover:underline">{b.category.name}</a>}{supplierName && supplierName !== b.name && <span>代購：{supplierName}</span>}<span className="text-[12px] text-mute">{b.code}</span></span>}
        actions={<><LinkButton href={`/purchase${b.categoryId ? `?categoryId=${b.categoryId}` : ""}`}>同活動再開一團</LinkButton>{open && <CancelBatch id={b.id} />}</>}
      />
      <section className="rounded-xl border border-line bg-card p-4" aria-label="這團金額">
        <div className="grid grid-cols-3 gap-2">
          <div><div className="text-[12px] text-mute">總額{estimated ? "（含預估）" : ""}</div><div className="num text-[20px] font-semibold" data-testid="batch-total">{formatTwd(pay.totalTwd)}</div></div>
          <div><div className="text-[12px] text-mute">已付</div><div className="num text-[20px] font-semibold text-good">{formatTwd(pay.paidTwd)}</div></div>
          <div><div className="text-[12px] text-mute">還要付</div><div className={`num text-[20px] font-semibold ${pay.dueTwd ? "text-bad" : ""}`} data-testid="batch-due">{formatTwd(pay.dueTwd)}</div></div>
        </div>
        <div className="mt-1 text-[13px] text-mute">{totalQty} 件・已到 {received}{feeTotal > 0 ? `・含運費等 ${formatTwd(feeTotal)}` : ""}</div>
        {open && (
          <div className="mt-3 grid grid-cols-3 gap-2" aria-label="常用動作">
            <ReceiveAllButton batchId={b.id} outstanding={Math.max(0, totalQty - received)} operators={ops.filter((o) => o.active)} defaultReceiver={b.receivingResponsibleById ?? b.orderedById ?? null} />
            {pay.dueTwd > 0 ? <PayOffButton big batchId={b.id} due={pay.dueTwd} operators={ops.filter((o) => o.active)} defaultPayer={b.ownership === "JOINT" ? me : (b.orderedById ?? me)} /> : <span className="flex items-center justify-center rounded-lg bg-good-soft px-3 py-2 text-[14px] text-good">已付清</span>}
            <Link href={`/inventory/batches/${b.id}?bulk=1#items`} className="flex items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-[14px] hover:border-ai">＋ 加商品</Link>
          </div>
        )}
      </section>

      <ProgressBar batchId={b.id} progress={b.progress} stage={batchStage(b)} editable={b.status !== "CANCELLED"} />





      <section id="items" className="scroll-mt-28 rounded-xl border border-line bg-card">
        <ItemsPanel
          batchId={b.id}
          items={editItems}
          editable={open}
          initialMode={open && (sp.bulk === "1" || b.items.length === 0) ? "add" : "view"}
          supplierId={b.supplierId}
          supplierCurrency={(b.supplierRef?.defaultCurrency as "JPY" | "TWD") ?? "TWD"}
          rateMicro={b.rateMicro}
          series={series}
          types={types}
          category={b.category ? { id: b.category.id, name: b.category.name } : null}
          copyButton={<CopyItemsButton toBatchId={b.id} batches={otherBatches.map((x) => ({ id: x.id, label: `${x.code} ${x.name}${x.supplierRef ? `（${x.supplierRef.name}）` : ""}` }))} />}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="payments" title={`付款（${payments.filter((p) => p.status !== "VOIDED").length}）`} pad={false}>
          <SupplierPayments
            batchId={b.id}
            operators={ops}
            payments={payments}
            editable={b.status !== "CANCELLED"}
            defaultPayer={b.paymentResponsibleById}
            defaultCurrency={(b.supplierRef?.defaultCurrency as "JPY" | "TWD") ?? "TWD"}
          />
        </Section>
        <Section id="receiving" title={`收貨清點（${b.receivings.length}）`} pad={false}>
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

      <Section id="costs" title="運費・代購費" pad={false} actions={open && <AddCost batchId={b.id} items={b.items.filter((i) => i.qty - i.cancelledQty > 0).map((i) => ({ id: i.id, name: i.product.name }))} operators={ops.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }))} owner={{ id: b.ownership === "JOINT" ? null : b.orderedById, label: ownerLabel }} presets={shippingPresets} />}>
        {b.costs.length === 0 ? (
          <Empty>還沒有記運費。國際運費、國內運費、代購費、關稅都記在這裡。</Empty>
        ) : (
          <ul className="divide-y divide-line-2" aria-label="運費與其他費用">
            {b.costs.map((c) => {
              const twd = c.currency === "JPY" ? jpyToTwd(c.amount, b.rateMicro) : c.amount;
              const sum = c.allocations.reduce((s, a) => s + a.amountTwd, 0);
              const q = b.items.reduce((s, i) => s + i.qty - i.cancelledQty, 0);
              return (
                <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3" data-testid="fee-row">
                  <div className="min-w-0">
                    <div className="font-medium">{costKind[c.kind]}{c.note ? <span className="ml-1 text-[12px] font-normal text-mute">{c.note}</span> : null}</div>
                    <div className="text-[13px] text-ink-2">{payerText(c)}</div>
                    <div className="text-[12px] text-mute">
                      {c.method === "NONE" ? "不攤進商品成本，單獨記" : `攤進商品成本：${allocMethod[c.method]}${c.method === "BY_QTY" && q ? `（每件約 +${formatTwd(Math.round(twd / q))}）` : ""}`}
                      {c.method !== "NONE" && sum !== twd && q > 0 && <span className="text-bad">・分攤合計 {sum} 和費用不符</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num font-semibold">{formatTwd(twd)}</div>
                    {c.currency === "JPY" && <div className="text-[12px] text-mute"><Jpy v={c.amount} /></div>}
                    {open && <div className="mt-1"><DeleteCost id={c.id} /></div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <details className="group rounded-xl border border-line bg-card" id="more">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
          <span><span className="mr-1 inline-block text-mute transition-transform group-open:rotate-90">▸</span>負責人・基本資料</span>
          <span className="text-[13px] font-normal text-mute group-open:hidden">點開修改</span>
        </summary>
        <div className="space-y-4 border-t border-line-2 p-3">
      <Section title="負責人" id="people">
        <ResponsibilityCard
          batchId={b.id}
          operators={ops}
          editable={open}
          jointShares={b.ownership === "JOINT" ? sharePercents((await tx((t) => jointWeights(t, [b.id]))).get(b.id)).map((x) => ({ name: ops.find((o) => o.id === x.key)?.name ?? "未指定", percent: x.percent })) : undefined}
          value={{ ownership: b.ownership, orderedById: b.orderedById, paymentResponsibleById: b.paymentResponsibleById, receivingResponsibleById: b.receivingResponsibleById, responsibilityNote: b.responsibilityNote }}
        />
      </Section>

      <Section id="info" title="基本資料">
        <BatchInfoCard
          batchId={b.id}
          editable={b.status !== "CANCELLED"}
          suppliers={suppliersList}
          categories={categoriesList}
          info={{
            name: b.name,
            supplierId: b.supplierId,
            supplierName: supplierName ?? null,
            categoryId: b.categoryId,
            categoryName: b.category?.name ?? null,
            supplierOrderNo: b.supplierOrderNo,
            orderUrl: b.orderUrl,
            expectedAt: dayInput(b.expectedAt),
            orderedAt: fmtDate(b.orderedAt),
            rate: formatRate(b.rateMicro),
            notes: b.notes,
          }}
        />
      </Section>
        </div>
      </details>
    </div>
  );
}
