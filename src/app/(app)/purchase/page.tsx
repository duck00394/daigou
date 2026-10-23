import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getMe } from "@/server/me";
import { listOperators } from "@/server/services/operators";
import { getDefaultRateMicro } from "@/server/services/settings";
import { PageHeader } from "@/components/ui";
import { QuickPurchase } from "./quick";
import { listShippingMethods } from "@/server/services/shipping-methods";
import { batchStage, batchStageLabel, isStoreKind } from "@/lib/labels";
import { formatRate } from "@/lib/money";
import { seriesOptions } from "@/server/services/catalog-tree";

export const metadata = { title: "新增採購" };

export default async function PurchasePage({ searchParams }: { searchParams: Promise<{ categoryId?: string; batchId?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [me, operators, categories, suppliers, batches, series, types, rate] = await Promise.all([
    getMe(),
    tx((t) => listOperators(t)),
    seriesOptions(prisma),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, defaultCurrency: true, kind: true, favorite: true } }),
    prisma.purchaseBatch.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, code: true, name: true, categoryId: true, ownership: true, orderedById: true, status: true, progress: true, rateMicro: true, supplierId: true, supplierRef: { select: { name: true, defaultCurrency: true, kind: true } }, _count: { select: { items: true } } },
    }),
    prisma.series.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.productType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    getDefaultRateMicro(prisma),
  ]);
  const opName = (id: string | null) => operators.find((o) => o.id === id)?.name ?? "未指定";
  // 代購：用最多次的排前面；IP 與品項：帶上次用的
  const supUse = new Map<string, number>();
  for (const b of batches) if (b.supplierId) supUse.set(b.supplierId, (supUse.get(b.supplierId) ?? 0) + 1);
  const sortedSups = [...suppliers].sort((a, b) => (supUse.get(b.id) ?? 0) - (supUse.get(a.id) ?? 0) || a.name.localeCompare(b.name, "zh-Hant"));
  // 每個代購上次寫的「在哪訂的」（Threads、IG、LINE 團名），新開一團時可以一鍵帶入
  const noted = await prisma.purchaseBatch.findMany({ where: { notes: { not: null }, supplierId: { not: null } }, orderBy: { createdAt: "desc" }, take: 300, select: { supplierId: true, notes: true } });
  const lastNote = new Map<string, string>();
  for (const n of noted) if (n.supplierId && n.notes?.trim() && !lastNote.has(n.supplierId)) lastNote.set(n.supplierId, n.notes.trim());
  const [lastItem, shipping] = await Promise.all([
    prisma.purchaseBatchItem.findFirst({ orderBy: { createdAt: "desc" }, select: { product: { select: { seriesId: true, productTypeId: true } } } }),
    listShippingMethods(prisma),
  ]);
  const lastCategory = batches.find((b) => b.categoryId && categories.some((c) => c.id === b.categoryId && c.active))?.categoryId ?? null;
  return (
    <div className="space-y-4">
      <PageHeader title="新增採購" />
      <QuickPurchase
        me={me}
        operators={operators.map((o) => ({ id: o.id, name: o.name, code: o.code }))}
        categories={categories}
        shipping={shipping.map((x) => ({ id: x.id, name: x.name, kind: x.kind, currency: x.currency === "JPY" ? "JPY" : "TWD", amount: x.amount }))}
        lastSeriesId={lastItem?.product.seriesId ?? null}
        lastTypeId={lastItem?.product.productTypeId ?? null}
        suppliers={sortedSups.map((s) => ({ id: s.id, name: s.name, currency: (s.defaultCurrency as "JPY" | "TWD") ?? "TWD", store: isStoreKind(s.kind), favorite: s.favorite, lastNote: lastNote.get(s.id) ?? null }))}
        batches={batches.map((b) => ({
          id: b.id,
          label: `${b.name}`,
          code: b.code,
          categoryId: b.categoryId,
          owner: b.ownership === "JOINT" ? "合資" : opName(b.orderedById),
          ownerKey: b.ownership === "JOINT" ? "JOINT" : (b.orderedById ?? "none"),
          stage: isStoreKind(b.supplierRef?.kind) ? "實體店購買" : batchStageLabel[batchStage(b)][0],
          supplierId: b.supplierId,
          supplierName: b.supplierRef?.name ?? null,
          currency: (b.supplierRef?.defaultCurrency as "JPY" | "TWD") ?? "TWD",
          rateMicro: b.rateMicro,
          items: b._count.items,
        }))}
        series={series}
        types={types}
        defaultRate={formatRate(rate)}
        initialCategory={sp.categoryId ?? (sp.batchId ? null : lastCategory)}
        initialBatch={sp.batchId ?? null}
      />
    </div>
  );
}
