import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { viewOwner } from "@/server/view";
import { PageHeader, Section, TableWrap, Twd, Empty, LinkButton, Pager, TagChip } from "@/components/ui";
import { FilterBar, FSearch, FSelect, FCheck, qs } from "@/components/filters";
import { fmtDate } from "@/lib/labels";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "買家" };
const SIZE = 50;

export default async function Buyers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const owner = await viewOwner(); // 看某個人：金額只算跟他訂的
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.BuyerWhereInput = {
    mergedIntoId: null,
    ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { lineName: { contains: sp.q, mode: "insensitive" } }, { code: { contains: sp.q, mode: "insensitive" } }, { aliases: { some: { alias: { contains: sp.q, mode: "insensitive" } } } }] } : {}),
    ...(sp.tagId ? { tags: { some: { tagId: sp.tagId, removedAt: null } } } : {}),
    ...(sp.due ? { orders: { some: { balanceCache: { gt: 0 }, confirmation: "CONFIRMED" } } } : {}),
  };
  const [buyers, total, tags] = await Promise.all([
    prisma.buyer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * SIZE,
      take: SIZE,
      include: { tags: { where: { removedAt: null }, include: { tag: true } }, aliases: { take: 4 } },
    }),
    prisma.buyer.count({ where }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);
  const ids = buyers.map((b) => b.id);
  const [agg, last] = await Promise.all([
    prisma.order.groupBy({ by: ["buyerId"], where: { buyerId: { in: ids }, confirmation: "CONFIRMED", ...(owner ? { items: { some: { ownerKey: { in: [owner, "joint", "none"] } } } } : {}) }, _count: true, _sum: { receivableCache: true, balanceCache: true } }),
    prisma.order.groupBy({ by: ["buyerId"], where: { buyerId: { in: ids }, ...(owner ? { items: { some: { ownerKey: { in: [owner, "joint", "none"] } } } } : {}) }, _max: { orderedAt: true } }),
  ]);
  const am = new Map(agg.map((a) => [a.buyerId, a]));
  const lm = new Map(last.map((a) => [a.buyerId, a._max.orderedAt]));
  return (
    <div>
      <PageHeader title="買家" actions={<><LinkButton href="/api/export/buyers">匯出（不含收件資料）</LinkButton><LinkButton href="/buyers/new" primary>新增買家</LinkButton></>} />
      <Section pad={false}>
        <FilterBar action="/buyers">
          <FSearch data-search value={sp.q} placeholder="名稱、LINE 暱稱、別名、編號" />
          <FSelect name="tagId" label="標籤" value={sp.tagId} options={tags.map((t) => [t.id, t.name + (t.active ? "" : "（停用）")])} />
          <FCheck name="due" checked={!!sp.due} label="只看有待收款" />
        </FilterBar>
        {buyers.length === 0 ? (
          <Empty action={<LinkButton href="/buyers/new" primary>新增買家</LinkButton>}>沒有符合條件的買家。</Empty>
        ) : (
          <TableWrap maxH="70vh">
            <thead>
              <tr>
                <th>買家</th>
                <th>標籤</th>
                <th className="text-right">有效訂單</th>
                <th className="text-right">累計應收</th>
                <th className="text-right">待收</th>
                <th>最近下單</th>
              </tr>
            </thead>
            <tbody>
              {buyers.map((b) => {
                const a = am.get(b.id);
                return (
                  <tr key={b.id}>
                    <td className="min-w-[12rem]">
                      <Link href={`/buyers/${b.id}`} className="font-medium text-ai hover:underline">{b.name}</Link>
                      <div className="text-[12px] text-mute">
                        {b.code}
                        {b.lineName ? `｜LINE：${b.lineName}` : ""}
                        {b.aliases.length ? `｜別名：${b.aliases.map((x) => x.alias).join("、")}` : ""}
                      </div>
                    </td>
                    <td><div className="flex max-w-xs flex-wrap gap-1">{b.tags.map((t) => <TagChip key={t.id} name={t.tag.name} color={t.tag.color} />)}</div></td>
                    <td className="num text-right">{a?._count ?? 0}</td>
                    <td className="text-right"><Twd v={a?._sum.receivableCache ?? 0} /></td>
                    <td className="text-right">{(a?._sum.balanceCache ?? 0) > 0 ? <Twd v={a?._sum.balanceCache} className="text-bad" /> : <span className="text-mute">0</span>}</td>
                    <td className="num text-mute">{fmtDate(lm.get(b.id))}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        <Pager page={page} total={total} size={SIZE} base={`/buyers${qs({ ...sp, page: undefined })}`} />
      </Section>
    </div>
  );
}
