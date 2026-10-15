import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { currentYm, monthlyReport, receivablesSnapshot, unrealizedEstimate } from "@/server/services/reports";
import { PageHeader, Section, TableWrap, Twd, Stat, Empty } from "@/components/ui";

export const metadata = { title: "成本與利潤" };

function months(n = 12) {
  const out: string[] = [];
  const now = currentYm();
  let [y, m] = now.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export default async function Reports({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const ym = sp.ym && /^\d{4}-\d{2}$/.test(sp.ym) ? sp.ym : currentYm();
  const [r, un, snap, expenses] = await Promise.all([
    monthlyReport(prisma, ym),
    unrealizedEstimate(prisma),
    receivablesSnapshot(prisma),
    prisma.expense.findMany({ where: { date: { gte: new Date(`${ym}-01T00:00:00Z`), lt: new Date(new Date(`${ym}-01T00:00:00Z`).setUTCMonth(new Date(`${ym}-01T00:00:00Z`).getUTCMonth() + 1)) } }, orderBy: { date: "asc" } }),
  ]);
  const margin = (rev: number, cost: number) => (rev > 0 ? `${Math.round(((rev - cost) / rev) * 1000) / 10}%` : "—");
  return (
    <div className="space-y-4">
      <PageHeader
        title="成本與利潤"
        sub="營收依出貨認列；收款是現金流，與營收分開；利潤 = 已實現營收 − 銷貨成本 − 其他費用。"
        actions={
          <form method="get" className="flex items-center gap-2">
            <select name="ym" defaultValue={ym} className="rounded-lg border border-line bg-white px-2 py-2" aria-label="月份">
              {months().map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="rounded-lg border border-ai bg-ai px-3 py-2 text-sm text-white">查看</button>
          </form>
        }
      />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="已實現營收" value={<Twd v={r.revenue} />} note={`其中運費收入 ${r.shippingIncome.toLocaleString()} 元`} />
        <Stat label="銷貨成本" value={<Twd v={r.cogs} />} note={r.estimatedCostUnits > 0 ? `${r.estimatedCostUnits} 件以預估成本計` : "依採購團實際成本"} tone={r.estimatedCostUnits > 0 ? "warn" : undefined} />
        <Stat label="其他費用" value={<Twd v={r.expenses} />} note="不屬於採購團的費用" />
        <Stat label="已實現利潤" value={<Twd v={r.realizedProfit} />} note={`毛利率 ${margin(r.revenue, r.cogs)}`} />
        <Stat label="本月新訂單金額" value={<Twd v={r.bookedSales} />} note="以訂單日期計的有效應收" />
        <Stat label="本月收款" value={<Twd v={r.cashIn} />} note={`本月退款 ${r.cashOut.toLocaleString()} 元`} />
        <Stat label="預估未實現利潤" value={<Twd v={un.profit} />} note={`未出貨營收 ${un.revenue.toLocaleString()} − 預估成本 ${un.cost.toLocaleString()}${un.unknownCostUnits ? `（${un.unknownCostUnits} 件無成本）` : ""}`} />
        <Stat label="目前待收款" value={<Twd v={snap.balance} />} note={`應退 ${snap.refundDue.toLocaleString()} 元，處理中 ${snap.refundPending.toLocaleString()} 元`} />
      </div>

      <Section title="各活動（銷售歸屬分類）營收與利潤" pad={false}>
        {r.byCategory.length === 0 ? <Empty>本月沒有出貨。</Empty> : (
          <TableWrap>
            <thead><tr><th>分類</th><th className="text-right">出貨件數</th><th className="text-right">營收（不含運費）</th><th className="text-right">銷貨成本</th><th className="text-right">毛利</th><th className="text-right">毛利率</th></tr></thead>
            <tbody>
              {r.byCategory.map((c) => (
                <tr key={c.name}><td>{c.name}</td><td className="num text-right">{c.qty}</td><td className="text-right"><Twd v={c.revenue} /></td><td className="text-right"><Twd v={c.cost} /></td><td className="text-right"><Twd v={c.revenue - c.cost} /></td><td className="num text-right">{margin(c.revenue, c.cost)}</td></tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
      <Section title="各商品銷售數量與毛利" pad={false}>
        {r.byProduct.length === 0 ? <Empty>本月沒有出貨。</Empty> : (
          <TableWrap maxH="60vh">
            <thead><tr><th>商品</th><th className="text-right">出貨件數</th><th className="text-right">營收</th><th className="text-right">銷貨成本</th><th className="text-right">毛利</th><th className="text-right">毛利率</th></tr></thead>
            <tbody>
              {r.byProduct.map((p) => (
                <tr key={p.name}><td>{p.name}</td><td className="num text-right">{p.qty}</td><td className="text-right"><Twd v={p.revenue} /></td><td className="text-right"><Twd v={p.cost} /></td><td className="text-right"><Twd v={p.revenue - p.cost} /></td><td className="num text-right">{margin(p.revenue, p.cost)}</td></tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="各買家本月訂購金額" pad={false}>
          {r.byBuyer.length === 0 ? <Empty>本月沒有新訂單。</Empty> : (
            <TableWrap maxH="50vh">
              <thead><tr><th>買家</th><th className="text-right">訂單數</th><th className="text-right">有效應收</th></tr></thead>
              <tbody>{r.byBuyer.map((b) => <tr key={b.name}><td>{b.name}</td><td className="num text-right">{b.orders}</td><td className="text-right"><Twd v={b.amount} /></td></tr>)}</tbody>
            </TableWrap>
          )}
        </Section>
        <Section title="本月其他費用" pad={false}>
          {expenses.length === 0 ? <Empty>沒有其他費用。可在「設定」新增。</Empty> : (
            <ul className="divide-y divide-line-2 text-sm">{expenses.map((e) => <li key={e.id} className="flex justify-between px-4 py-2"><span>{e.date.toISOString().slice(0, 10)}｜{e.note ?? ""}</span><Twd v={e.amountTwd} /></li>)}</ul>
          )}
        </Section>
      </div>
      <p className="text-[12px] text-mute">完整計算公式見專案文件 docs/計算口徑.md。</p>
    </div>
  );
}
