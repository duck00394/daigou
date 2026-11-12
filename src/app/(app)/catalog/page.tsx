import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { catalogTree, seriesPins, typeOptions } from "@/server/services/catalog-tree";
import { getMe } from "@/server/me";
import { listOperators } from "@/server/services/operators";
import { CatalogView } from "./view";

export const metadata = { title: "系列目錄" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ kind?: string; open?: string; order?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const me = await getMe();
  const [tree, types, pins, operators] = await Promise.all([
    catalogTree(prisma),
    typeOptions(prisma),
    seriesPins(prisma, me),
    tx((t) => listOperators(t)),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="系列目錄" sub="種類 › 系列 › 品項 › 角色。售價設一次，賣給客人時自動帶入；買進價格在採購時填。" />
      <CatalogView tree={tree} types={types} initialKind={sp.kind ?? null} initialOpen={sp.open ?? null} initialOrdering={sp.order === "1"} pins={pins} me={me} operators={operators.map((o) => ({ id: o.id, name: o.name }))} />
    </div>
  );
}
