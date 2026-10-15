import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { landedCosts } from "@/server/services/purchase";
import { PageHeader, Section, TableWrap, Twd, Jpy, StatusBadge, Empty, KV, LinkButton } from "@/components/ui";
import { AddCost, DeleteCost, EditBatchItem, AddBatchItem, CancelBatch } from "./parts";
import { allocMethod, batchStatus, costKind, fmtDate } from "@/lib/labels";
import { divRound, formatRate, jpyToTwd } from "@/lib/money";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const b = await prisma.purchaseBatch.findUnique({
    where: { id },
    include: {
      items: { orderBy: { createdAt: "asc" }, include: { product: true, movements: { select: { kind: true, onHandDelta: true } }, allocations: { include: { batchCost: true } } } },
      costs: { orderBy: { createdAt: "asc" }, include: { allocations: true } },
    },
  });
  if (!b) notFound();
  const landed = await tx((t) => landedCosts(t, b.items.map((i) => i.id)));
  const open = b.status !== "CANCELLED";
  const totalLanded = [...landed.values()].reduce((s, l) => s + l.totalTwd, 0);
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${b.code} ${b.name}`}
        back={{ href: "/inventory?tab=batches", label: "採購批次" }}
        sub={<StatusBadge map={batchStatus} value={b.status} />}
        actions={open && <><LinkButton href="/inventory?tab=receive">登記到貨</LinkButton><CancelBatch id={b.id} /></>}
      />
      <Section>
        <KV items={[["供應商", b.supplier], ["下單日", fmtDate(b.orderedAt)], ["本批匯率", `1 日圓 = ${formatRate(b.rateMicro)} 台幣（已鎖定）`], ["實際總成本", <Twd key="t" v={totalLanded} />], ["備註", b.notes]]} />
      </Section>
      <Section title="採購明細與實際成本" pad={false} actions={open && <AddBatchItem batchId={b.id} />}>
        <TableWrap>
          <thead>
            <tr>
              <th>商品</th>
              <th className="text-right">採購</th>
              <th className="text-right">已到貨</th>
              <th className="text-right">未到貨</th>
              <th className="text-right">日幣單價</th>
              <th className="text-right">商品成本（台幣）</th>
              <th className="text-right">分攤費用</th>
              <th className="text-right">實際總成本</th>
              <th className="text-right">每件成本</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {b.items.map((i) => {
              const rec = i.movements.filter((m) => m.kind === "RECEIVE").reduce((s, m) => s + m.onHandDelta, 0);
              const q = i.qty - i.cancelledQty;
              const l = landed.get(i.id)!;
              return (
                <tr key={i.id}>
                  <td>
                    <Link href={`/products/${i.productId}`} className="hover:underline">{i.product.name}</Link>
                    <div className="text-[12px] text-mute">{i.weightGrams != null ? `${i.weightGrams} g` : "未填重量"}{i.cancelledQty ? `｜已取消 ${i.cancelledQty}` : ""}</div>
                  </td>
                  <td className="num text-right">{q}</td>
                  <td className="num text-right">{rec}</td>
                  <td className="num text-right">{q - rec}</td>
                  <td className="text-right"><Jpy v={i.unitCostJpy} /></td>
                  <td className="text-right"><Twd v={l.goodsTwd} /></td>
                  <td className="text-right"><Twd v={l.feesTwd} /></td>
                  <td className="text-right font-medium"><Twd v={l.totalTwd} /></td>
                  <td className="text-right"><Twd v={q > 0 ? divRound(l.totalTwd, q) : 0} /></td>
                  <td>{open && <EditBatchItem item={{ id: i.id, name: i.product.name, unitCostJpy: i.unitCostJpy, weightGrams: i.weightGrams, cancellable: q - rec }} />}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <p className="px-4 py-2 text-[12px] text-mute">商品成本 = 日幣單價 × 件數 × 本批匯率（四捨五入到元）。每件成本僅供參考，銷貨成本以總成本依出貨件數比例計算，總和不會多算或少算。</p>
      </Section>
      <Section title="共同費用與分攤" pad={false} actions={open && <AddCost batchId={b.id} items={b.items.filter((i) => i.qty - i.cancelledQty > 0).map((i) => ({ id: i.id, name: i.product.name }))} />}>
        {b.costs.length === 0 ? (
          <Empty>還沒有共同費用，例如日本國內運費、國際運費、關稅。</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>費用</th>
                <th className="text-right">金額</th>
                <th className="text-right">台幣</th>
                <th>分攤方式</th>
                <th>分攤結果</th>
                <th></th>
              </tr>
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
    </div>
  );
}
