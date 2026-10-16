import Link from "next/link";
import { productSearchWhere } from "@/server/services/catalog";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { inventorySummary } from "@/server/services/inventory";
import { PageHeader, Section, TableWrap, StatusBadge, Twd, Jpy, LinkButton, Empty, Pager, Badge } from "@/components/ui";
import { FilterBar, FSearch, FSelect, FCheck, qs } from "@/components/filters";
import { ProductImage } from "@/components/client";
import { productStatus } from "@/lib/labels";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "商品" };
const SIZE = 50;

type SP = Record<string, string | undefined>;

export default async function Products({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.ProductWhereInput = {
    archivedAt: sp.archived ? { not: null } : null,
    ...productSearchWhere(sp.q),
    ...(sp.categoryId ? { categories: { some: { categoryId: sp.categoryId } } } : {}),
    ...(sp.characterId ? { characters: { some: { characterId: sp.characterId } } } : {}),
    ...(sp.seriesId ? { seriesId: sp.seriesId } : {}),
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(sp.typeId ? { productTypeId: sp.typeId } : {}),
  };
  const sortStock = sp.sort === "stock" || sp.sort === "shortage";
  const [cats, chars, types, total, seriesList] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.character.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.productType.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.product.count({ where }),
    prisma.series.findMany({ orderBy: { name: "asc" } }),
  ]);
  let products = await prisma.product.findMany({
    where,
    include: { productType: true, seriesRef: true, characters: { include: { character: true } }, categories: { include: { category: true } } },
    orderBy: sp.sort === "name" ? { name: "asc" } : { updatedAt: "desc" },
    ...(sortStock ? {} : { skip: (page - 1) * SIZE, take: SIZE }),
  });
  const inv = await tx((t) => inventorySummary(t, products.map((p) => p.id)));
  if (sortStock) {
    const key = (id: string) => (sp.sort === "stock" ? (inv.get(id)?.available ?? 0) : (inv.get(id)?.shortage ?? 0));
    products = products.sort((a, b) => key(b.id) - key(a.id)).slice((page - 1) * SIZE, page * SIZE);
  }
  const base = `/products${qs({ ...sp, page: undefined })}`;

  return (
    <div>
      <PageHeader
        title="商品"
        sub="日幣官方價、代購售價、預估成本與庫存一覽"
        actions={
          <>
            <LinkButton href={`/api/export/products${qs(sp)}`}>匯出 Excel</LinkButton>
            <LinkButton href="/products/new" primary>
              新增商品
            </LinkButton>
          </>
        }
      />
      <Section pad={false}>
        <FilterBar action="/products">
          <FSearch data-search value={sp.q} placeholder="搜尋名稱、編號、系列、別名" />
          <FSelect name="categoryId" label="分類" value={sp.categoryId} options={cats.map((c) => [c.id, c.name])} />
          <FSelect name="seriesId" label="系列" value={sp.seriesId} options={seriesList.map((c) => [c.id, c.name])} />
          <FSelect name="characterId" label="角色" value={sp.characterId} options={chars.map((c) => [c.id, c.name])} />
          <FSelect name="typeId" label="類型" value={sp.typeId} options={types.map((c) => [c.id, c.name])} />
          <FSelect name="status" label="狀態" value={sp.status} options={Object.entries(productStatus).map(([k, v]) => [k, v[0]])} />
          <FSelect name="sort" label="排序" value={sp.sort} options={[["name", "名稱"], ["stock", "可用庫存多→少"], ["shortage", "缺貨數量多→少"]]} />
          <FCheck name="archived" checked={!!sp.archived} label="只看已封存" />
        </FilterBar>
        {products.length === 0 ? (
          <Empty action={<LinkButton href="/products/new" primary>新增商品</LinkButton>}>沒有符合條件的商品。</Empty>
        ) : (
          <TableWrap maxH="70vh">
            <thead>
              <tr>
                <th>商品</th>
                <th>狀態</th>
                <th className="text-right">日幣官方價</th>
                <th className="text-right">代購售價</th>
                <th className="text-right">預估成本</th>
                <th className="text-right">手上有</th>
                <th className="text-right">可用</th>
                <th className="text-right">待到貨</th>
                <th className="text-right">有效訂購</th>
                <th className="text-right">缺貨</th>
                <th>分類</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const s = inv.get(p.id);
                return (
                  <tr key={p.id}>
                    <td className="min-w-[16rem]">
                      <Link href={`/products/${p.id}`} className="flex items-start gap-2.5 hover:underline">
                        <ProductImage src={p.imageUrl} alt={p.name} />
                        <span>
                          <span className="block font-medium">{p.name}</span>
                          <span className="block text-[12px] text-mute">
                            {p.code}
                            {p.seriesRef ? `｜${p.seriesRef.name}` : p.series ? `｜${p.series}` : ""}
                            {p.productType ? `｜${p.productType.name}` : ""}
                            {p.characters.length ? `｜${p.characters.map((c) => c.character.name).join("、")}` : ""}
                            {p.spec ? `｜${p.spec}` : ""}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge map={productStatus} value={p.status} />
                    </td>
                    <td className="text-right"><Jpy v={p.officialPriceJpy} /></td>
                    <td className="text-right"><Twd v={p.salePriceTwd} /></td>
                    <td className="text-right"><Twd v={p.estCostTwd} /></td>
                    <td className="num text-right">{s?.onHand ?? 0}</td>
                    <td className="num text-right">{s?.available ?? 0}</td>
                    <td className="num text-right">{s?.incoming ?? 0}</td>
                    <td className="num text-right">{s?.activeOrdered ?? 0}</td>
                    <td className="num text-right">{s?.shortage ? <Badge tone="bad">{s.shortage}</Badge> : 0}</td>
                    <td className="max-w-[14rem]">
                      <div className="flex flex-wrap gap-1">
                        {p.categories.map((c) => (
                          <Badge key={c.categoryId} tone="neutral">{c.category.name}</Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        <Pager page={page} total={total} size={SIZE} base={base} />
      </Section>
    </div>
  );
}
