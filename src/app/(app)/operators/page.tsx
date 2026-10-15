import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { listReceivingRecords, listSupplierPayments, operatorReport, UNASSIGNED, type OperatorFilter } from "@/server/services/operator-report";
import { listOperators } from "@/server/services/operators";
import { PageHeader, Section, TableWrap, Empty, LinkButton } from "@/components/ui";
import { qs } from "@/components/filters";
import { currencyName, fmtDate, parseDateInput, paymentPurpose, supplierPaymentStatus } from "@/lib/labels";
import { formatJpy, formatRate, formatTwd, jpyToTwd } from "@/lib/money";

export const metadata = { title: "經營者對帳" };

type SP = { from?: string; to?: string; supplier?: string; batch?: string; op?: string; view?: string; currency?: string; status?: string; role?: string };

const money = (v: number, c: string) => (c === "JPY" ? formatJpy(v) : formatTwd(v));
const ROLES: Record<string, [string, "orderedById" | "paymentResponsibleById" | "receivingResponsibleById"]> = {
  ordered: ["訂購負責", "orderedById"],
  payment: ["付款負責", "paymentResponsibleById"],
  receiving: ["收貨負責", "receivingResponsibleById"],
};

export default async function OperatorsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const from = parseDateInput(sp.from);
  const to = parseDateInput(sp.to);
  const f: OperatorFilter = {
    from,
    toExclusive: to ? new Date(to.getTime() + 86_400_000) : null,
    supplierId: sp.supplier || null,
    batchId: sp.batch || null,
    operatorId: sp.op || null,
  };
  const base = { from: sp.from, to: sp.to, supplier: sp.supplier, batch: sp.batch, op: sp.op };
  const [operators, suppliers, batches, report] = await Promise.all([
    tx((t) => listOperators(t, { includeInactive: true })),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.purchaseBatch.findMany({ orderBy: { createdAt: "desc" }, take: 200, select: { id: true, code: true, name: true } }),
    tx((t) => operatorReport(t, f)),
  ]);
  const opName = (id: string | null) => (id ? (operators.find((o) => o.id === id)?.name ?? "（已移除）") : "未指定");
  const sel = "w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[15px]";
  const currencies = Object.keys(report.totals).sort();

  return (
    <div className="space-y-4">
      <PageHeader title="經營者對帳" sub="誰負責下單、誰實際付了供應商多少、誰收貨清點。" actions={<LinkButton href="/settings">經營者名稱</LinkButton>} />
      <p className="rounded-xl border border-[#f0dfa8] bg-warn-soft px-4 py-2.5 text-[13px] leading-6 text-warn">
        這裡只呈現實際發生的紀錄，<strong>不是</strong>合夥人之間的成本分攤或還款結算：誰付給供應商的錢，不代表誰應該負擔這筆成本，也不代表誰欠誰。不同幣別分開統計，不直接相加。
      </p>

      <form method="get" action="/operators" className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-card p-3 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
        <label className="text-[12px] text-mute">開始日<input type="date" name="from" defaultValue={sp.from} className={sel} /></label>
        <label className="text-[12px] text-mute">結束日<input type="date" name="to" defaultValue={sp.to} className={sel} /></label>
        <label className="text-[12px] text-mute">
          經營者
          <select name="op" defaultValue={sp.op ?? ""} className={sel}>
            <option value="">全部</option>
            {operators.map((o) => <option key={o.id} value={o.id}>{o.name}{o.active ? "" : "（停用）"}</option>)}
            <option value={UNASSIGNED}>未指定</option>
          </select>
        </label>
        <label className="text-[12px] text-mute">
          供應商
          <select name="supplier" defaultValue={sp.supplier ?? ""} className={sel}>
            <option value="">全部</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="col-span-2 text-[12px] text-mute sm:col-span-1">
          採購團
          <select name="batch" defaultValue={sp.batch ?? ""} className={sel}>
            <option value="">全部</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}
          </select>
        </label>
        {sp.view && <input type="hidden" name="view" value={sp.view} />}
        <div className="col-span-2 flex gap-2 sm:col-span-3 lg:col-span-1">
          <button type="submit" className="flex-1 rounded-lg border border-ai bg-ai px-3 py-2 text-sm font-medium text-white">套用</button>
          <Link href="/operators" className="rounded-lg border border-line bg-white px-3 py-2 text-sm">清除</Link>
        </div>
      </form>
      <p className="-mt-2 text-[12px] text-mute">日期篩選：採購團依下單日、付款依付款日、收貨依收貨日。採購團數量不含已取消的團。</p>

      {/* 每人一張卡片：手機也能直接看 */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {report.rows.map((r) => {
          const curr = Object.keys(r.payments).sort();
          const link = (extra: Record<string, string>) => `/operators${qs(base, { op: r.key, ...extra })}`;
          return (
            <section key={r.key} className="rounded-xl border border-line bg-card" aria-label={r.name} data-testid={`op-card-${r.code ?? "none"}`}>
              <h2 className="flex items-center justify-between border-b border-line-2 px-4 py-2.5 text-[16px] font-semibold">
                <span>{r.name}{!r.active && <span className="ml-1 text-[12px] font-normal text-mute">（停用）</span>}</span>
                {r.code && <span className="num rounded bg-line-2 px-1.5 text-[12px] font-normal text-ink-2">{r.code}</span>}
              </h2>
              <div className="space-y-3 p-4 text-sm">
                <div>
                  <div className="mb-1 text-[12px] text-mute">負責的採購團</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {(Object.keys(ROLES) as (keyof typeof ROLES)[]).map((k) => {
                      const v = k === "ordered" ? r.batches.ordered : k === "payment" ? r.batches.paymentResponsible : r.batches.receivingResponsible;
                      return (
                        <Link key={k} href={link({ view: "batches", role: k })} className="rounded-lg border border-line-2 px-1 py-1.5 hover:border-ai">
                          <div className="num text-[18px] font-semibold">{v}</div>
                          <div className="text-[11px] text-mute">{ROLES[k][0]}</div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[12px] text-mute">實際付給供應商（已付款）</div>
                  {curr.length === 0 ? (
                    <p className="text-mute">沒有付款紀錄</p>
                  ) : (
                    <ul className="space-y-1">
                      {curr.map((c) => {
                        const s = r.payments[c];
                        return (
                          <li key={c}>
                            <Link href={link({ view: "payments", currency: c })} className="flex items-baseline justify-between gap-2 rounded-lg px-1 hover:bg-ai-soft">
                              <span className="text-ink-2">{currencyName[c]}（{s.paidCount} 筆）</span>
                              <span className="num text-[16px] font-semibold" data-testid={`paid-${r.code ?? "none"}-${c}`}>{money(s.paidAmount, c)}</span>
                            </Link>
                            {c === "JPY" && s.paidAmount > 0 && (
                              <p className="px-1 text-[12px] text-mute">
                                {s.ratedAmount > 0 ? `其中 ${formatJpy(s.ratedAmount)} 依各筆實際匯率約 ${formatTwd(s.twdFromRated)}` : "沒有填實際匯率，不換算台幣"}
                                {s.unratedCount > 0 && s.ratedAmount > 0 ? `；${s.unratedCount} 筆未填匯率` : ""}
                              </p>
                            )}
                            {s.pendingCount > 0 && (
                              <Link href={link({ view: "payments", currency: c, status: "PENDING" })} className="block px-1 text-[12px] text-warn hover:underline">另有待付款 {s.pendingCount} 筆 {money(s.pendingAmount, c)}（未計入）</Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-[12px] text-mute">收貨清點</div>
                  <Link href={link({ view: "receivings" })} className="block rounded-lg px-1 hover:bg-ai-soft">
                    <span className="num font-semibold">{r.receiving.records}</span> 次、<span className="num font-semibold">{r.receiving.batches}</span> 個採購團；實收 <span className="num font-semibold">{r.receiving.receivedQty}</span> 件
                    {r.receiving.defectQty ? `（瑕疵 ${r.receiving.defectQty}）` : ""}
                    {r.receiving.missingQty ? `，缺少 ${r.receiving.missingQty}` : ""}
                  </Link>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {currencies.length > 0 && (
        <Section title="供應商付款合計（依幣別，不跨幣別相加）">
          <ul className="flex flex-wrap gap-4 text-sm">
            {currencies.map((c) => (
              <li key={c}>
                {currencyName[c]}：<span className="num font-semibold">{money(report.totals[c].paidAmount, c)}</span>
                <span className="text-mute">（{report.totals[c].paidCount} 筆{report.totals[c].pendingCount ? `，待付款 ${money(report.totals[c].pendingAmount, c)}` : ""}）</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {sp.view === "payments" && <PaymentsList f={f} sp={sp} opName={opName} />}
      {sp.view === "receivings" && <ReceivingsList f={f} opName={opName} />}
      {sp.view === "batches" && <BatchesList f={f} role={sp.role ?? "ordered"} opName={opName} />}
    </div>
  );
}

async function PaymentsList({ f, sp, opName }: { f: OperatorFilter; sp: SP; opName: (id: string | null) => string }) {
  const rows = await tx((t) => listSupplierPayments(t, f, { currency: sp.currency || null, status: sp.status || null }));
  const title = `付款紀錄：${f.operatorId ? opName(f.operatorId === UNASSIGNED ? null : f.operatorId) : "全部"}${sp.currency ? `／${currencyName[sp.currency]}` : ""}${sp.status ? `／${supplierPaymentStatus[sp.status]?.[0]}` : ""}`;
  return (
    <Section title={title} pad={false}>
      {rows.length === 0 ? <Empty>沒有符合的付款紀錄。</Empty> : (
        <TableWrap>
          <thead><tr><th>付款日</th><th>實際付款人</th><th>採購團</th><th className="text-right">金額</th><th>實際匯率／台幣</th><th>用途</th><th>方式</th><th>狀態</th><th>編號／備註</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.status === "VOIDED" ? "text-mute line-through" : ""}>
                <td className="num">{fmtDate(p.paidAt)}</td>
                <td>{opName(p.paidById)}</td>
                <td><Link className="text-ai hover:underline" href={`/inventory/batches/${p.batch.id}#pay-${p.id}`}>{p.batch.code} {p.batch.name}</Link>{p.batch.supplierRef && <div className="text-[12px] text-mute">{p.batch.supplierRef.name}</div>}</td>
                <td className="num text-right">{money(p.amount, p.currency)}</td>
                <td className="num text-[13px]">{p.currency === "TWD" ? "—" : p.rateMicro ? `${formatRate(p.rateMicro)}／${formatTwd(jpyToTwd(p.amount, p.rateMicro))}` : "未填"}</td>
                <td>{p.purpose ? paymentPurpose[p.purpose] : "—"}</td>
                <td>{p.method ?? "—"}</td>
                <td>{supplierPaymentStatus[p.status][0]}</td>
                <td className="text-[13px]">{[p.reference, p.note, p.voidReason ? `作廢：${p.voidReason}` : null].filter(Boolean).join("｜") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Section>
  );
}

async function ReceivingsList({ f, opName }: { f: OperatorFilter; opName: (id: string | null) => string }) {
  const rows = await tx((t) => listReceivingRecords(t, f));
  return (
    <Section title={`收貨紀錄：${f.operatorId ? opName(f.operatorId === UNASSIGNED ? null : f.operatorId) : "全部"}`} pad={false}>
      {rows.length === 0 ? <Empty>沒有符合的收貨紀錄。</Empty> : (
        <ul className="divide-y divide-line-2">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-2.5 text-sm">
              <div className="flex flex-wrap gap-2">
                <span className="num text-mute">{fmtDate(r.receivedAt, true)}</span>
                <span className="font-medium">{opName(r.receivedById)}</span>
                <Link className="text-ai hover:underline" href={`/inventory/batches/${r.batch.id}#rcv-${r.id}`}>{r.batch.code} {r.batch.name}</Link>
              </div>
              <div className="text-[13px] text-ink-2">
                {r.lines.map((l) => `${l.batchItem.product.name} 實收 ${l.receivedQty}${l.defectQty ? `（瑕疵 ${l.defectQty}）` : ""}${l.missingQty ? `，缺 ${l.missingQty}` : ""}`).join("；")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

async function BatchesList({ f, role, opName }: { f: OperatorFilter; role: string; opName: (id: string | null) => string }) {
  const [label, field] = ROLES[role] ?? ROLES.ordered;
  const range = f.from || f.toExclusive ? { orderedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.toExclusive ? { lt: f.toExclusive } : {}) } } : {};
  const rows = await prisma.purchaseBatch.findMany({
    where: {
      status: { not: "CANCELLED" },
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(f.batchId ? { id: f.batchId } : {}),
      ...(f.operatorId ? { [field]: f.operatorId === UNASSIGNED ? null : f.operatorId } : {}),
      ...range,
    },
    orderBy: { orderedAt: "desc" },
    take: 300,
    include: { supplierRef: { select: { name: true } } },
  });
  return (
    <Section title={`${label}的採購團：${f.operatorId ? opName(f.operatorId === UNASSIGNED ? null : f.operatorId) : "全部"}`} pad={false}>
      {rows.length === 0 ? <Empty>沒有符合的採購團。</Empty> : (
        <TableWrap>
          <thead><tr><th>採購團</th><th>供應商</th><th>下單日</th><th>訂購</th><th>付款負責</th><th>收貨負責</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><Link className="text-ai hover:underline" href={`/inventory/batches/${b.id}`}>{b.code} {b.name}</Link></td>
                <td>{b.supplierRef?.name ?? b.supplier ?? "—"}</td>
                <td className="num">{fmtDate(b.orderedAt)}</td>
                <td>{opName(b.orderedById)}</td>
                <td>{opName(b.paymentResponsibleById)}</td>
                <td>{opName(b.receivingResponsibleById)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Section>
  );
}
