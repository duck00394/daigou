import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { categoryDetail } from "@/server/services/reports";
import { PageHeader, Section, TableWrap, Stat, Twd, Empty, LinkButton, StatusBadge, KV, Badge } from "@/components/ui";
import { ProductImage } from "@/components/client";
import { CategoryEditButton, CategoryActiveButton } from "../forms";
import { categoryType, dayInput, fmtDay, productStatus } from "@/lib/labels";

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; sort?: string }> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const exists = await prisma.category.findUnique({ where: { id } });
  if (!exists) notFound();
  const d = await categoryDetail(prisma, id);
  let products = d.products;
  if (sp.q) products = products.filter((p) => p.product.name.toLowerCase().includes(sp.q!.toLowerCase()) || p.product.code.toLowerCase().includes(sp.q!.toLowerCase()));
  if (sp.sort === "qty") products = [...products].sort((a, b) => b.stats.activeQty - a.stats.activeQty);
  if (sp.sort === "buyers") products = [...products].sort((a, b) => b.stats.buyers.size - a.stats.buyers.size);
  const c = d.category;
  return (
    <div className="space-y-4">
      <PageHeader
        title={c.name}
        back={{ href: "/categories", label: "活動與分類" }}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {c.type === "CUSTOM" ? (c.customType ?? "自訂") : categoryType[c.type]}
            {!c.active && <Badge tone="muted">停用</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/api/export/category?id=${c.id}`}>匯出 Excel</LinkButton>
            <LinkButton href={`/products/new?categoryId=${c.id}`}>新增商品到此分類</LinkButton>
            <CategoryEditButton cat={{ id: c.id, name: c.name, type: c.type, customType: c.customType, startDate: dayInput(c.startDate) || null, endDate: dayInput(c.endDate) || null, notes: c.notes, active: c.active }} />
            <CategoryActiveButton id={c.id} active={c.active} />
          </>
        }
      />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        <Stat label="商品款數" value={d.products.length} />
        <Stat label="有效購買人數" value={d.total.buyers.size} />
        <Stat label="有效訂購件數" value={d.total.activeQty} />
        <Stat label="已取消件數" value={d.total.cancelledQty} />
        <Stat label="待下單" value={d.total.toPurchase} />
        <Stat label="待到貨" value={d.total.incoming} />
        <Stat label="待出貨／已出貨" value={`${d.total.toShip} / ${d.total.shipped}`} />
      </div>
      {(c.startDate || c.notes) && (
        <Section>
          <KV items={[["活動期間", `${fmtDay(c.startDate)} – ${fmtDay(c.endDate)}`], ["備註", c.notes]]} />
        </Section>
      )}
      <Section title="分類內商品" pad={false}>
        <form className="flex flex-wrap gap-2 border-b border-line-2 px-4 py-3" method="get">
          <input type="search" name="q" defaultValue={sp.q} placeholder="搜尋商品" className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-2" />
          <select name="sort" defaultValue={sp.sort ?? ""} className="rounded-lg border border-line px-2 py-2">
            <option value="">依名稱</option>
            <option value="qty">訂購件數多→少</option>
            <option value="buyers">購買人數多→少</option>
          </select>
          <button className="rounded-lg border border-ai bg-ai px-3 py-2 text-sm text-white">套用</button>
        </form>
        {products.length === 0 ? (
          <Empty>這個分類還沒有商品。</Empty>
        ) : (
          <TableWrap maxH="70vh">
            <thead>
              <tr>
                <th>商品</th>
                <th>狀態</th>
                <th className="text-right">售價</th>
                <th className="text-right">購買人數</th>
                <th className="text-right">有效件數</th>
                <th className="text-right">待下單</th>
                <th className="text-right">已下單待到貨</th>
                <th className="text-right">待出貨</th>
                <th className="text-right">已出貨</th>
                <th className="text-right">取消</th>
                <th>買家名單</th>
              </tr>
            </thead>
            <tbody>
              {products.map(({ product: p, stats: s }) => (
                <tr key={p.id}>
                  <td className="min-w-[14rem]">
                    <Link href={`/products/${p.id}?categoryId=${c.id}`} className="flex items-start gap-2 hover:underline">
                      <ProductImage src={p.imageUrl} alt={p.name} size={36} />
                      <span>
                        <span className="block font-medium">{p.name}</span>
                        <span className="text-[12px] text-mute">{p.code}</span>
                      </span>
                    </Link>
                  </td>
                  <td><StatusBadge map={productStatus} value={p.status} /></td>
                  <td className="text-right"><Twd v={p.salePriceTwd} /></td>
                  <td className="num text-right font-medium">{s.buyers.size}</td>
                  <td className="num text-right font-medium">{s.activeQty}</td>
                  <td className="num text-right">{s.toPurchase}</td>
                  <td className="num text-right">{s.incoming}</td>
                  <td className="num text-right">{s.toShip}</td>
                  <td className="num text-right">{s.shipped}</td>
                  <td className="num text-right">{s.cancelledQty}</td>
                  <td>
                    <Link href={`/products/${p.id}?categoryId=${c.id}`} className="text-sm text-ai hover:underline">
                      查看買家
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
