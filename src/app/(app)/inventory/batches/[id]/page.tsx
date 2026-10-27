import { DeleteBatchButton, UndoReceivingButton } from "./undo";
import { CopyButton } from "@/components/copy-button";
import { RefundButton } from "../../../reconcile/reset";
import { seriesOptions } from "@/server/services/catalog-tree";
import { notFound } from "next/navigation";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { landedCosts, minCommittedQty } from "@/server/services/purchase";
import { PageHeader, Section, Jpy, StatusBadge, Empty, LinkButton, Badge } from "@/components/ui";
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
import { sharePercents } from "@/server/services/ownership";
import { jointSettlement, jointWeights } from "@/server/services/joint";
import { JointPanel } from "./joint";
import { MoreMenu } from "@/components/more-menu";
import { DutyBar, FixDutyButton } from "./duty";
import { supplierPaymentHistory } from "@/server/services/supplier-payments";
import { isStoreKind, allocMethod, batchStage, batchStageLabel, costKind, currencyName, dayInput, fmtDate, paymentPurpose, supplierPaymentStatus, toDateTimeInput } from "@/lib/labels";
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
      items: { orderBy: { createdAt: "asc" }, include: { product: true, movements: { select: { kind: true, onHandDelta: true, reservedDelta: true } } } },
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
    seriesOptions(prisma),
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
      ...(() => {
        // 手誤刪除：自留的會一起拿掉；還有效的出售、留給買家的要先處理
        const sold = -i.movements.filter((x) => x.kind === "SHIP").reduce((a, x) => a + x.onHandDelta, 0) || 0;
        const reserved = i.movements.reduce((a, x) => a + x.reservedDelta, 0);
        const kept = -i.movements.filter((x) => x.kind === "KEEP").reduce((a, x) => a + x.onHandDelta, 0) || 0;
        const blocked = sold > 0 ? `已經賣出 ${sold} 件，先到「賺多少」把那筆出售作廢才能刪` : reserved > 0 ? `有 ${reserved} 件留給買家，先取消保留才能刪` : m.dependentIfRemoved > 0 ? `有 ${m.dependentIfRemoved} 件買家訂購要靠這批，不能刪` : null;
        return { canDelete: !blocked, deleteBlocked: blocked, kept };
      })(),
      cancelledQty: i.cancelledQty,
      cancelReason: i.cancelReason,
      seriesId: i.categoryId ?? b.categoryId,
      ownerId: i.ownerId,
      dutyPct: i.dutyBp == null ? null : i.dutyBp / 100,
    });
  }
  // 這團有哪些系列（團本身的＋品項各自指定的）
  const batchSeries = [...new Set([b.categoryId, ...b.items.map((i) => i.categoryId)].filter((x): x is string => !!x))].map((cid) => ({ id: cid, name: categoriesList.find((c) => c.id === cid)?.name ?? "" })).filter((x) => x.name);
  const open = b.status !== "CANCELLED";
  const totalLanded = [...landed.values()].reduce((s, l) => s + l.totalTwd, 0);
  const totalQty = editItems.reduce((s, i) => s + i.qty, 0);
  const received = editItems.reduce((s, i) => s + i.received, 0);
  const estimated = [...landed.values()].some((l) => l.estimated);
  const supplierName = b.supplierRef?.name ?? b.supplier;
  const pay = (await tx((t) => batchPaySummary(t, [b.id]))).get(b.id) ?? { totalTwd: totalLanded, paidTwd: 0, dueTwd: totalLanded };
  const me = await getMe();
  const anyCut = b.items.some((i) => i.cancelledQty > 0);
  const joint = b.ownership === "JOINT" ? await tx((t) => jointSettlement(t, b.id)) : null;
  const refundOwed = !open ? pay.paidTwd : anyCut ? pay.paidTwd - pay.totalTwd : 0;
  return (
    <div className="space-y-4">
      <PageHeader
        title={b.name}
        back={{ href: "/inventory?tab=batches", label: "採購團" }}
        sub={<span className="flex flex-wrap items-center gap-2"><OwnerBadge k={b.ownership === "JOINT" ? "joint" : b.orderedById} name={b.ownership === "JOINT" ? "合資" : opName(b.orderedById)} ids={ops.map((o) => o.id)} />{isStoreKind(b.supplierRef?.kind) ? <Badge tone="info">實體店購買</Badge> : <StatusBadge map={batchStageLabel} value={batchStage(b)} />}{batchSeries.map((x) => <a key={x.id} href={`/categories/${x.id}`} className="text-ai hover:underline">{x.name}</a>)}{supplierName && supplierName !== b.name && <span>{isStoreKind(b.supplierRef?.kind) ? "店家" : "代購"}：{supplierName}</span>}<span className="text-[12px] text-mute">{b.code}</span></span>}
        actions={<>{open && <LinkButton href={`/reconcile/${b.id}`}>對單</LinkButton>}<LinkButton href={`/purchase${b.categoryId ? `?categoryId=${b.categoryId}` : ""}`}>同活動再開一團</LinkButton><MoreMenu>{open && <CancelBatch id={b.id} />}<DeleteBatchButton label="刪除整團" batchId={b.id} name={b.name} paid={pay.paidTwd} received={received} items={b.items.length} qty={totalQty} payments={b.supplierPayments.filter((p) => p.status !== "VOIDED").length} fees={b.costs.length} goTo="/inventory?tab=batches" /></MoreMenu></>}
      />
      {(b.supplierOrderNo || b.notes) && (
        <div className="space-y-1 rounded-xl border border-line bg-card px-4 py-2.5 text-[14px]" data-testid="batch-where">
          {b.supplierOrderNo && <div className="flex items-center gap-2"><span className="text-mute">訂單編號</span><span className="num font-semibold break-all" data-testid="batch-order-no">{b.supplierOrderNo}</span><CopyButton text={b.supplierOrderNo} /></div>}
          {b.notes && <div className="flex gap-2"><span className="shrink-0 text-mute">在哪訂的</span><span className="break-all whitespace-pre-wrap">{b.notes}</span></div>}
        </div>
      )}
      {refundOwed > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[#f1b5b5] bg-bad-soft px-4 py-2.5 text-[14px] text-bad" data-testid="batch-refund-owed">
          <span>已砍單，未退款：代購要退 <b className="num">{formatTwd(refundOwed)}</b>{b.refundedTwd ? `（已退 ${formatTwd(b.refundedTwd)}）` : ""}</span>
          <RefundButton batchId={b.id} name={b.name} owed={refundOwed} />
        </div>
      )}
      {!open && (
        <div className="rounded-xl border border-line bg-line-2 px-4 py-3 text-[14px] text-ink-2" role="status">
          這團已取消，不會算進總額、還要付和庫存。{pay.paidTwd > 0 ? "之前付的錢要請代購退回，退了在上面按「記退款」。" : ""}

        </div>
      )}
      <section className="rounded-xl border border-line bg-card p-4" aria-label="這團金額">
        <div className="grid grid-cols-3 gap-2">
          <div><div className="text-[12px] text-mute">總額{estimated ? "（含預估）" : ""}</div><div className="num text-[20px] font-semibold" data-testid="batch-total">{formatTwd(pay.totalTwd)}</div></div>
          <div><div className="text-[12px] text-mute">已付</div><div className="num text-[20px] font-semibold text-good">{formatTwd(pay.paidTwd)}</div></div>
          <div><div className="text-[12px] text-mute">還要付</div><div className={`num text-[20px] font-semibold ${pay.dueTwd ? "text-bad" : ""}`} data-testid="batch-due">{formatTwd(pay.dueTwd)}</div></div>
        </div>
        <div className="mt-1 text-[13px] text-mute">{totalQty} 件・已到 {received}{feeTotal > 0 ? `・含運費等 ${formatTwd(feeTotal)}` : ""}</div>
        {open && (
          <div className="mt-3 grid grid-cols-3 gap-2" aria-label="常用動作">
            <ReceiveAllButton batchId={b.id} outstanding={Math.max(0, totalQty - received)} operators={ops.filter((o) => o.active)} defaultReceiver={b.receivingResponsibleById ?? b.orderedById ?? null} doneLabel={isStoreKind(b.supplierRef?.kind) ? "實體店買的" : "全部到手了"} due={pay.dueTwd} payer={b.ownership === "JOINT" ? me : (b.orderedById ?? me)} />
            {pay.dueTwd > 0 ? <PayOffButton big batchId={b.id} due={pay.dueTwd} operators={ops.filter((o) => o.active)} defaultPayer={b.ownership === "JOINT" ? me : (b.orderedById ?? me)} /> : <span className="flex items-center justify-center rounded-lg bg-good-soft px-3 py-2 text-[14px] text-good">已付清</span>}
            <Link href={`/inventory/batches/${b.id}?bulk=1#items`} className="flex items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-[14px] hover:border-ai">＋ 加商品</Link>
          </div>
        )}
      </section>

      {joint && <JointPanel batchId={b.id} s={joint} editable={open} />}

      {!isStoreKind(b.supplierRef?.kind) && <ProgressBar batchId={b.id} progress={b.progress} stage={batchStage(b)} editable={b.status !== "CANCELLED"} />}





      <section id="items" className="scroll-mt-28 rounded-xl border border-line bg-card">
        <ItemsPanel
          batchId={b.id}
          items={editItems}
          editable={open}
          jointOps={joint ? joint.people.map((p) => ({ id: p.id, name: p.name })) : undefined}
          batchDutyPct={b.dutyBp == null ? null : b.dutyBp / 100}
          jointPct={joint ? Object.fromEntries(joint.people.map((p) => [p.id, p.percent])) : undefined}
          initialMode={open && (sp.bulk === "1" || b.items.length === 0) ? "add" : "view"}
          supplierId={b.supplierId}
          supplierCurrency={(b.supplierRef?.defaultCurrency as "JPY" | "TWD") ?? "TWD"}
          rateMicro={b.rateMicro}
          series={series}
          types={types}
          category={b.category ? { id: b.category.id, name: b.category.name } : null}
          seriesOptions={categoriesList}
          copyButton={<CopyItemsButton toBatchId={b.id} batches={otherBatches.map((x) => ({ id: x.id, label: `${x.code} ${x.name}${x.supplierRef ? `（${x.supplierRef.name}）` : ""}` }))} />}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
        <Section id="receiving" title={`收貨清點（${b.receivings.length}）`} pad={false} actions={open && received > 0 ? <UndoReceivingButton batchId={b.id} recordId={null} qty={received} label="全部撤回" /> : undefined}>
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
              goodQty: r.lines.reduce((x, l) => x + l.receivedQty - l.defectQty, 0),
              lines: r.lines.map((l) => ({ name: l.batchItem.product.name, receivedQty: l.receivedQty, defectQty: l.defectQty, missingQty: l.missingQty, note: l.note })),
            }))}
          />
        </Section>
      </div>

      <Section id="costs" title="運費・代購費" pad={false} actions={open && <AddCost batchId={b.id} items={b.items.filter((i) => i.qty - i.cancelledQty > 0).map((i) => ({ id: i.id, name: i.product.name }))} operators={ops.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }))} owner={{ id: b.ownership === "JOINT" ? null : b.orderedById, label: ownerLabel }} presets={shippingPresets} />}>
        {!isStoreKind(b.supplierRef?.kind) && <DutyBar batchId={b.id} pct={b.dutyBp == null ? null : b.dutyBp / 100} goods={editItems.reduce((a, i) => a + i.goodsTwd, 0)} editable={open} />}
        {b.costs.length === 0 ? (
          <Empty>還沒有記運費。國際運費、國內運費、代購費、關稅都記在這裡。</Empty>
        ) : (
          <>
          {b.items.length > 0 && b.items.every((i) => i.qty - i.cancelledQty <= 0) && (
            <p className="mx-4 mt-3 rounded-lg bg-good-soft px-3 py-2 text-[14px] text-good" data-testid="fees-waived">這團全部沒買到，下面的運費不用付，不算進總額。</p>
          )}
          <ul className="divide-y divide-line-2" aria-label="運費與其他費用">
            {b.costs.map((c) => {
              const twd = c.currency === "JPY" ? jpyToTwd(c.amount, b.rateMicro) : c.amount;
              const sum = c.allocations.reduce((s, a) => s + a.amountTwd, 0);
              const q = b.items.reduce((s, i) => s + i.qty - i.cancelledQty, 0);
              return (
                <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3" data-testid="fee-row">
                  <div className="min-w-0">
                    <div className="font-medium" data-testid={c.autoDuty ? "auto-duty" : undefined}>{costKind[c.kind]}{c.autoDuty ? <span className="ml-1 text-[12px] font-normal text-mute">{b.dutyBp != null ? `${b.dutyBp / 100}%・` : ""}自動算</span> : null}{c.note ? <span className="ml-1 text-[12px] font-normal text-mute">{c.note}</span> : null}</div>
                    <div className="text-[13px] text-ink-2">{payerText(c)}</div>
                    <div className="text-[12px] text-mute">
                      {c.autoDuty ? "照每件的關稅 % 攤進商品成本" : c.method === "NONE" ? "不攤進商品成本，單獨記" : `攤進商品成本：${allocMethod[c.method]}${c.method === "BY_QTY" && q ? `（每件約 +${formatTwd(Math.round(twd / q))}）` : ""}`}
                      {c.method !== "NONE" && sum !== twd && q > 0 && <span className="text-bad">・分攤合計 {sum} 和費用不符</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num font-semibold">{formatTwd(twd)}</div>
                    {c.currency === "JPY" && <div className="text-[12px] text-mute"><Jpy v={c.amount} /></div>}
                    {open && <div className="mt-1 flex justify-end gap-1">{c.autoDuty && <FixDutyButton costId={c.id} amount={twd} />}<DeleteCost id={c.id} /></div>}
                  </div>
                </li>
              );
            })}
          </ul>
          </>
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
