import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getMe } from "@/server/me";
import { listOperators } from "@/server/services/operators";
import { getDefaultRateMicro } from "@/server/services/settings";
import { PageHeader } from "@/components/ui";
import { QuickPurchase } from "./quick";
import { batchStage, batchStageLabel } from "@/lib/labels";
import { formatRate } from "@/lib/money";

export const metadata = { title: "新增採購" };

export default async function PurchasePage({ searchParams }: { searchParams: Promise<{ categoryId?: string; batchId?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [me, operators, categories, suppliers, batches, series, types, rate] = await Promise.all([
    getMe(),
    tx((t) => listOperators(t)),
    prisma.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, defaultCurrency: true } }),
    prisma.purchaseBatch.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, code: true, name: true, categoryId: true, ownership: true, orderedById: true, status: true, progress: true, rateMicro: true, supplierId: true, supplierRef: { select: { name: true, defaultCurrency: true } }, _count: { select: { items: true } } },
    }),
    prisma.series.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.productType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    getDefaultRateMicro(prisma),
  ]);
  const opName = (id: string | null) => operators.find((o) => o.id === id)?.name ?? "未指定";
  return (
    <div className="space-y-4">
      <PageHeader title="新增採購" sub="選活動、選哪一團（或開新的一團），再點角色填單價和數量。預設台幣。" />
      <QuickPurchase
        me={me}
        operators={operators.map((o) => ({ id: o.id, name: o.name, code: o.code }))}
        categories={categories}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, currency: (s.defaultCurrency as "JPY" | "TWD") ?? "TWD" }))}
        batches={batches.map((b) => ({
          id: b.id,
          label: `${b.name}`,
          code: b.code,
          categoryId: b.categoryId,
          owner: b.ownership === "JOINT" ? "合資" : opName(b.orderedById),
          stage: batchStageLabel[batchStage(b)][0],
          supplierId: b.supplierId,
          supplierName: b.supplierRef?.name ?? null,
          currency: (b.supplierRef?.defaultCurrency as "JPY" | "TWD") ?? "TWD",
          rateMicro: b.rateMicro,
          items: b._count.items,
        }))}
        series={series}
        types={types}
        defaultRate={formatRate(rate)}
        initialCategory={sp.categoryId ?? null}
        initialBatch={sp.batchId ?? null}
      />
    </div>
  );
}
