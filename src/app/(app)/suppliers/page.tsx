import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section, TableWrap, Empty, Badge } from "@/components/ui";
import { SupplierEditButton } from "./forms";
import { fmtDate } from "@/lib/labels";

export const metadata = { title: "供應商" };

export default async function Suppliers() {
  await requireUser();
  const list = await prisma.supplier.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { batches: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { batches: true } } },
  });
  return (
    <div>
      <PageHeader title="供應商" sub="每個採購團可以指定供應商；批次新增時會優先帶入同供應商上次的單價。" actions={<SupplierEditButton />} />
      <Section pad={false}>
        {list.length === 0 ? (
          <Empty action={<SupplierEditButton />}>還沒有供應商。</Empty>
        ) : (
          <TableWrap>
            <thead><tr><th>供應商</th><th>預設幣別</th><th className="text-right">採購團</th><th>最近一團</th><th>聯絡方式</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={s.active ? "" : "opacity-60"}>
                  <td className="font-medium">{s.name}{!s.active && <span className="ml-1"><Badge tone="muted">停用</Badge></span>}</td>
                  <td>{s.defaultCurrency}</td>
                  <td className="num text-right">{s._count.batches}</td>
                  <td>{s.batches[0] ? <Link href={`/inventory/batches/${s.batches[0].id}`} className="text-ai hover:underline">{s.batches[0].code} {s.batches[0].name}</Link> : "—"}<div className="text-[12px] text-mute">{s.batches[0] ? fmtDate(s.batches[0].orderedAt) : ""}</div></td>
                  <td className="text-[13px]">{s.contact ?? "—"}</td>
                  <td><SupplierEditButton supplier={{ id: s.id, name: s.name, defaultCurrency: s.defaultCurrency, contact: s.contact, notes: s.notes, active: s.active }} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
