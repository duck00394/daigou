// 系列：每個系列花了多少、還要付、到了幾件（原本的活動總表＋系列目錄合在一起；點進去看買了什麼、採購團、品項售價）
import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getView } from "@/server/view";
import { seriesSummary } from "@/server/services/batch-ops";
import { seriesOptions } from "@/server/services/catalog-tree";
import { listCustomCategoryTypes } from "@/server/services/catalog";
import { PageHeader } from "@/components/ui";
import { CategoryEditButton } from "./forms";
import { SeriesList, type KindGroup } from "./list";

export const metadata = { title: "系列" };

export default async function Categories() {
  await requireUser();
  const vk = (await getView()).key;
  const [sum, opts, customTypes] = await Promise.all([tx((t) => seriesSummary(t, vk)), seriesOptions(prisma), tx((t) => listCustomCategoryTypes(t))]);
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
      <PageHeader
        title="系列"
        sub="點種類展開；點系列看買了什麼、採購團、品項售價。"
        actions={
          <>
            <CategoryEditButton label="＋ 新系列" customTypes={customTypes} />
            <Link href="/catalog?order=1" className="inline-flex min-h-10 items-center rounded-lg border border-line bg-white px-3 text-[14px] text-ai">調整順序</Link>
          </>
        }
      />
      <SeriesList groups={groups} />
    </div>
  );
}
