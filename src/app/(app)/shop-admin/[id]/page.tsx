import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getView } from "@/server/view";
import { soldMap } from "@/server/services/shop";
import { taipeiParts } from "@/lib/taipei";
import { PageHeader } from "@/components/ui";
import { QuotaForm, SettingsForm, type QuotaRow } from "./forms";

export default async function ShopCategoryAdmin({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const cat = await prisma.category.findUnique({ where: { id }, select: { id: true, name: true, active: true } });
  if (!cat) notFound();
  const [s, ops, view, products, quotas, typePrices, waits] = await Promise.all([
    prisma.shopCategory.findUnique({ where: { categoryId: id } }),
    prisma.operator.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    getView(),
    prisma.product.findMany({
      where: { categories: { some: { categoryId: id } }, archivedAt: null, mergedIntoId: null },
      include: { productType: { select: { id: true, name: true, sortOrder: true } }, characters: { include: { character: { select: { name: true, sortOrder: true } } } } },
    }),
    prisma.shopQuota.findMany({ where: { categoryId: id } }),
    prisma.categoryTypePrice.findMany({ where: { categoryId: id } }),
    prisma.shopWait.groupBy({ by: ["productId"], where: { categoryId: id, status: "WAITING" }, _count: { _all: true } }),
  ]);
  const sold = await soldMap(prisma, id, products.map((p) => p.id));
  const q = new Map(quotas.map((x) => [x.productId, x]));
  const tp = new Map(typePrices.map((t) => [t.productTypeId, t]));
  const w = new Map(waits.map((x) => [x.productId, x._count._all]));
  const rows: QuotaRow[] = products
    .map((p) => {
      const ch = p.characters.map((c) => c.character).sort((a, b) => a.sortOrder - b.sortOrder)[0];
      const defaultPrice = (p.productTypeId ? tp.get(p.productTypeId)?.salePriceTwd : null) ?? p.salePriceTwd;
      return {
        productId: p.id,
        type: p.productType?.name ?? "其他",
        typeId: p.productTypeId,
        typeImage: (p.productTypeId ? tp.get(p.productTypeId)?.imageUrl : null) ?? null,
        typeSort: p.productTypeId ? (tp.get(p.productTypeId)?.sortOrder ?? p.productType?.sortOrder ?? 0) : 9999,
        label: ch?.name ?? p.spec ?? p.name,
        charSort: ch?.sortOrder ?? 0,
        name: p.name,
        image: p.imageUrl,
        defaultPrice,
        price: q.get(p.id)?.price ?? null,
        quota: q.get(p.id)?.quota ?? null,
        sold: sold.get(p.id) ?? 0,
        waiting: w.get(p.id) ?? 0,
      };
    })
    .sort((a, b) => a.typeSort - b.typeSort || a.type.localeCompare(b.type, "zh-Hant") || a.charSort - b.charSort || a.label.localeCompare(b.label, "zh-Hant"));
  const open = s?.openAt ? taipeiParts(s.openAt) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`開放訂購：${cat.name}`}
        back={{ href: "/shop-admin", label: "訂購頁" }}
        sub={
          <span className="flex flex-wrap gap-3">
            <Link href={`/categories/${id}`} className="text-ai underline">系列頁</Link>
            {s?.enabled && <a href={`/shop/c/${id}`} target="_blank" rel="noreferrer" className="text-ai underline">看客人的畫面</a>}
            <Link href={`/inventory?tab=stock&v=1&cat=${id}&only=short`} className="text-ai underline">這個系列的待買清單</Link>
          </span>
        }
      />
      {!cat.active && <p className="rounded-xl border border-[#f0dfa8] bg-warn-soft px-3 py-2 text-[14px] text-warn">這個系列已過期，客人看不到。要開放請先到系列頁改回進行中。</p>}
      <SettingsForm
        categoryId={id}
        ops={ops}
        initial={{
          enabled: s?.enabled ?? false,
          openDate: open?.date ?? "",
          openTime: open?.time ?? "",
          perPersonLimit: s?.perPersonLimit ?? null,
          ownerId: s?.ownerId ?? view.me ?? ops[0]?.id ?? null,
          imageUrl: s?.imageUrl ?? "",
          intro: s?.intro ?? "",
        }}
        isNew={!s}
      />
      <QuotaForm categoryId={id} rows={rows} />
    </div>
  );
}
