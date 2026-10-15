import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section, TableWrap, Empty, Twd, StatusBadge } from "@/components/ui";
import { SeriesEditButton, RosterEditor, DeleteTemplateButton } from "../forms";
import { productStatus } from "@/lib/labels";

export default async function SeriesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const s = await prisma.series.findUnique({
    where: { id },
    include: {
      characters: { orderBy: { sortOrder: "asc" }, include: { character: true } },
      templates: { orderBy: { name: "asc" } },
      products: { where: { archivedAt: null }, orderBy: { name: "asc" }, include: { productType: true } },
    },
  });
  if (!s) notFound();
  const [allChars, others, types] = await Promise.all([
    prisma.character.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.series.findMany({ where: { id: { not: id } }, orderBy: { name: "asc" } }),
    prisma.productType.findMany(),
  ]);
  const charName = new Map(s.characters.map((c) => [c.characterId, c.character.name]));
  const extra = await prisma.character.findMany({ where: { id: { in: s.templates.flatMap((t) => (t.items as { characterId: string }[]).map((i) => i.characterId)) } } });
  for (const c of extra) charName.set(c.id, c.name);
  return (
    <div className="space-y-4">
      <PageHeader title={s.name} back={{ href: "/series", label: "系列與角色" }} sub={s.notes ?? undefined} actions={<SeriesEditButton series={{ id: s.id, name: s.name, notes: s.notes, active: s.active }} />} />
      <Section title={`角色名單（${s.characters.length}）`}>
        <RosterEditor seriesId={s.id} roster={s.characters.map((c) => ({ id: c.character.id, name: c.character.name }))} allCharacters={allChars} otherSeries={others} />
      </Section>
      <Section title="系列範本" pad={false}>
        {s.templates.length === 0 ? (
          <Empty>還沒有範本。在採購團的「批次新增系列商品」中可以把目前的角色組合存成範本。</Empty>
        ) : (
          <ul className="divide-y divide-line-2 text-sm">
            {s.templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  <b>{t.name}</b>
                  <span className="ml-2 text-mute">
                    {types.find((x) => x.id === t.productTypeId)?.name ?? "不指定類型"}｜
                    {(t.items as { characterId: string; spec: string | null }[]).map((i) => `${charName.get(i.characterId) ?? "（已刪除角色）"}${i.spec ? `（${i.spec}）` : ""}`).join("、")}
                  </span>
                </span>
                <DeleteTemplateButton id={t.id} name={t.name} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`系列商品（${s.products.length}）`} pad={false}>
        {s.products.length === 0 ? (
          <Empty>還沒有商品。到採購團用「批次新增系列商品」建立，或在商品頁選擇這個系列。</Empty>
        ) : (
          <TableWrap>
            <thead><tr><th>商品</th><th>類型</th><th>規格</th><th>狀態</th><th className="text-right">參考售價</th></tr></thead>
            <tbody>
              {s.products.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/products/${p.id}`} className="text-ai hover:underline">{p.name}</Link></td>
                  <td>{p.productType?.name ?? "—"}</td>
                  <td>{p.spec ?? "—"}</td>
                  <td><StatusBadge map={productStatus} value={p.status} /></td>
                  <td className="text-right"><Twd v={p.salePriceTwd} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
