import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section, TableWrap, StatusBadge, Empty, Twd } from "@/components/ui";
import { GroupBuyEditButton } from "../categories/forms";
import { fmtDate, groupBuyStatus, toDateTimeInput } from "@/lib/labels";

export const metadata = { title: "代購團" };

export default async function GroupBuys({ searchParams }: { searchParams: Promise<{ closing?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const soon = new Date(Date.now() + 7 * 86400000);
  const [gbs, cats, stats] = await Promise.all([
    prisma.groupBuy.findMany({
      where: sp.closing ? { status: "OPEN", closeAt: { not: null, lte: soon } } : {},
      include: { category: true },
      orderBy: [{ status: "asc" }, { closeAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.category.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.order.groupBy({ by: ["groupBuyId"], where: { confirmation: "CONFIRMED" }, _count: true, _sum: { receivableCache: true, balanceCache: true } }),
  ]);
  const sm = new Map(stats.map((s) => [s.groupBuyId, s]));
  return (
    <div>
      <PageHeader title={sp.closing ? "7 天內截止的代購團" : "代購團"} sub="代購團記錄實際開團與收單；商品分類與採購批次分開管理。" actions={<GroupBuyEditButton categories={cats} />} />
      <Section pad={false}>
        {gbs.length === 0 ? (
          <Empty>{sp.closing ? "7 天內沒有截止的代購團。" : "還沒有代購團。"}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>代購團</th>
                <th>狀態</th>
                <th>主要分類</th>
                <th>開團</th>
                <th>收單截止</th>
                <th className="text-right">訂單數</th>
                <th className="text-right">應收合計</th>
                <th className="text-right">待收</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gbs.map((g) => {
                const s = sm.get(g.id);
                return (
                  <tr key={g.id}>
                    <td>
                      <Link href={`/orders?groupBuyId=${g.id}`} className="font-medium text-ai hover:underline">{g.name}</Link>
                      <div className="text-[12px] text-mute">{g.code}</div>
                    </td>
                    <td><StatusBadge map={groupBuyStatus} value={g.status} /></td>
                    <td>{g.category?.name ?? "—"}</td>
                    <td className="num whitespace-nowrap">{fmtDate(g.openAt, true)}</td>
                    <td className="num whitespace-nowrap">{fmtDate(g.closeAt, true)}</td>
                    <td className="num text-right">{s?._count ?? 0}</td>
                    <td className="text-right"><Twd v={s?._sum.receivableCache ?? 0} /></td>
                    <td className="text-right"><Twd v={s?._sum.balanceCache ?? 0} /></td>
                    <td>
                      <GroupBuyEditButton categories={cats} gb={{ id: g.id, name: g.name, categoryId: g.categoryId, status: g.status, openAt: toDateTimeInput(g.openAt) || null, closeAt: toDateTimeInput(g.closeAt) || null, notes: g.notes }} />
                    </td>
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
