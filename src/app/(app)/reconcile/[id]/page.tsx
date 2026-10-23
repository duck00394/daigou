import { notFound } from "next/navigation";
import { tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { reconcileList, reconcileSheet } from "@/server/services/reconcile";
import { PageHeader } from "@/components/ui";
import { ReconcileSheet } from "./sheet";

export default async function ReconcileBatch({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const sheet = await tx((t) => reconcileSheet(t, id)).catch(() => null);
  if (!sheet) notFound();
  const list = await tx((t) => reconcileList(t, { supplier: sp.supplier, cat: sp.cat }));
  const idx = list.todo.findIndex((r) => r.id === id);
  const others = list.todo.filter((r) => r.id !== id);
  const next = idx >= 0 ? (list.todo[idx + 1] ?? others[0]) : others[0];
  const q = new URLSearchParams();
  if (sp.supplier) q.set("supplier", sp.supplier);
  if (sp.cat) q.set("cat", sp.cat);
  const qs = q.size ? `?${q}` : "";
  return (
    <div className="space-y-3">
      <PageHeader
        title={sheet.name}
        sub={[sheet.supplierName, idx >= 0 ? `第 ${idx + 1}／${list.todo.length} 團` : "已對完"].filter(Boolean).join("｜")}
        back={{ href: `/reconcile${qs}`, label: "對單" }}
      />
      {!sheet.needsCheck ? (
        <p className="rounded-xl border border-line bg-card p-4 text-[14px] text-mute">這一團不用對單（實體店買的或已取消）。</p>
      ) : (
        <ReconcileSheet key={JSON.stringify(sheet.items.map((i) => [i.id, i.bought, i.cut]))} batchId={sheet.id} items={sheet.items} nextHref={next ? `/reconcile/${next.id}${qs}` : null} listHref={`/reconcile${qs}`} batchHref={`/inventory/batches/${sheet.id}`} />
      )}
    </div>
  );
}
