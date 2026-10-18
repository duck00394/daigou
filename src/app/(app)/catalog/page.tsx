import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { catalogTree } from "@/server/services/catalog-tree";
import { CatalogView } from "./view";

export const metadata = { title: "系列目錄" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ kind?: string; open?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [tree, types] = await Promise.all([
    catalogTree(prisma),
    prisma.productType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="系列目錄" sub="種類 › 系列 › 品項 › 角色。售價設一次，賣給客人時自動帶入；買進價格在採購時填。" />
      <CatalogView tree={tree} types={types} initialKind={sp.kind ?? null} initialOpen={sp.open ?? null} />
    </div>
  );
}
