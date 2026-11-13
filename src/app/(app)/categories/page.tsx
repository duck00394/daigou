// 系列：每個系列花了多少、還要付、到了幾件（原本的活動總表＋系列目錄合在一起；點進去看買了什麼、採購團、品項售價）
import { AreaTabs } from "@/components/area-tabs";
import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getView } from "@/server/view";
import { seriesSummary } from "@/server/services/batch-ops";
import { getMe } from "@/server/me";
import { seriesOptions } from "@/server/services/catalog-tree";
import { listCustomCategoryTypes } from "@/server/services/catalog";
import { PageHeader } from "@/components/ui";
import { CategoryEditButton } from "./forms";
import { SeriesList, type KindGroup } from "./list";
import { CostCompare } from "./cost-compare";

export const metadata = { title: "系列" };

export default async function Categories({ searchParams }: { searchParams: Promise<{ view?: string; char?: string; type?: string; series?: string; calc?: string; scope?: string; sort?: string }> }) {
  await requireUser();
  const vk = (await getView()).key;
  const sp = await searchParams;
  // 系列成本比較：同一頁的另一個檢視（不另外開頁面）
  if (sp.view === "cost")
    return (
      <div className="space-y-3">
        <AreaTabs area="catalog" current="/categories?view=cost" />
        <PageHeader title="系列成本比較" sub="同一個角色、同一個品項，在各系列每隻成本差多少。" back={{ href: "/categories", label: "系列" }} />
        <CostCompare sp={sp} owner={vk === "all" ? "" : vk} />
      </div>
    );
  const [sum, opts, customTypes] = await Promise.all([tx((t) => seriesSummary(t, vk)), seriesOptions(prisma, await getMe()), tx((t) => listCustomCategoryTypes(t))]);
  const zero = { batches: 0, totalTwd: 0, dueTwd: 0, refundTwd: 0, ordered: 0, received: 0, pendingBatches: 0 };
  // 照「調整順序」排的；已過期的放在最後一組
  const groups: KindGroup[] = [];
  const expired: KindGroup = { key: "~expired", label: "已過期的系列", rows: [] };
  for (const o of opts) {
    const row = { id: o.id, name: o.name, active: o.active, ...(sum.get(o.id) ?? zero) };
    if (!o.active) {
      expired.rows.push(row);
      continue;
    }
    let g = groups.find((x) => x.key === o.kindKey);
    if (!g) groups.push((g = { key: o.kindKey, label: o.kindLabel, rows: [] }));
    g.rows.push(row);
  }
  if (expired.rows.length) groups.push(expired);
  return (
    <div className="space-y-3">
      <AreaTabs area="catalog" current="/categories" />
      <PageHeader
        title="系列"
        sub="點種類展開；點系列看買了什麼、採購團、品項售價。"
        actions={
          <>
            <CategoryEditButton label="＋ 新系列" customTypes={customTypes} />
            <Link href="/catalog?order=1" className="inline-flex min-h-10 items-center rounded-lg border border-line bg-card px-3 text-[14px] text-ai">調整順序</Link>
          </>
        }
      />
      <div data-tour="series-list"><SeriesList groups={groups} /></div>
    </div>
  );
}
