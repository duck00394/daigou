import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section, TableWrap, Empty, Badge } from "@/components/ui";
import { SeriesEditButton } from "./forms";

export const metadata = { title: "系列與角色" };

export default async function SeriesList() {
  await requireUser();
  const list = await prisma.series.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { characters: { orderBy: { sortOrder: "asc" }, include: { character: true } }, _count: { select: { products: true, templates: true } } },
  });
  return (
    <div>
      <PageHeader title="系列與角色" sub="IP／系列下的角色名單會用在採購團的「批次新增系列商品」。系列、角色、商品類型、分類、供應商、採購團各自獨立管理。" actions={<SeriesEditButton />} />
      <Section pad={false}>
        {list.length === 0 ? (
          <Empty action={<SeriesEditButton />}>還沒有系列。</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>系列</th>
                <th>角色名單</th>
                <th className="text-right">商品數</th>
                <th className="text-right">範本</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={s.active ? "" : "opacity-60"}>
                  <td className="whitespace-nowrap">
                    <Link href={`/series/${s.id}`} className="font-medium text-ai hover:underline">{s.name}</Link>
                    {!s.active && <span className="ml-1"><Badge tone="muted">停用</Badge></span>}
                  </td>
                  <td className="max-w-md text-[13px]">{s.characters.map((c) => c.character.name).join("、") || <span className="text-mute">尚未設定</span>}</td>
                  <td className="num text-right">{s._count.products}</td>
                  <td className="num text-right">{s._count.templates}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
