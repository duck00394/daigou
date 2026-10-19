import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { conflicts, listRush } from "@/server/services/rush";
import { vapidPublicKey } from "@/server/push";
import { PushStatusChip } from "@/components/push-setup";
import { relativeDay, taipeiParts } from "@/lib/taipei";
import { scheduleBadge, toneCls } from "@/lib/rush-labels";

export const metadata = { title: "搶購提醒" };

export default async function RushPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const history = sp.tab === "history";
  const rows = await listRush(prisma, history ? "history" : "upcoming");
  const clash = conflicts(rows);
  const days = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = relativeDay(r.startAt);
    days.set(k, [...(days.get(k) ?? []), r]);
  }
  const tab = (on: boolean) => `flex-1 rounded-lg py-2 text-center text-[14px] ${on ? "bg-white font-semibold text-ink shadow-sm" : "text-ink-2"}`;
  return (
    <div className="space-y-3">
      <PageHeader title="搶購提醒" />
      <nav aria-label="搶購提醒分頁" className="flex rounded-xl bg-line-2 p-1">
        <Link href="/rush" className={tab(!history)} aria-current={!history ? "page" : undefined}>接下來</Link>
        <Link href="/rush?tab=history" className={tab(history)} aria-current={history ? "page" : undefined}>歷史紀錄</Link>
      </nav>
      <PushStatusChip vapidKey={vapidPublicKey()} />
      <Link href="/rush/new" className="block rounded-xl bg-ai py-3 text-center text-[16px] font-semibold text-white">＋ 新增搶購提醒</Link>
      {rows.length === 0 && <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-[14px] text-mute">{history ? "還沒有結束的搶購。" : "接下來沒有搶購。按上面「新增搶購提醒」記一筆。"}</p>}
      {[...days.entries()].map(([day, list]) => (
        <section key={day}>
          <h2 className="mt-2 mb-1 text-[13px] font-bold text-ink-2">{day}</h2>
          <ul className="space-y-2">
            {list.map((r) => {
              const b = scheduleBadge(r);
              const near = clash.get(r.id);
              return (
                <li key={r.id}>
                  <Link href={`/rush/${r.id}`} className={`flex gap-3 rounded-xl border bg-white p-3 ${near ? "border-[#fdba74] bg-[#fff7ed]" : "border-line"}`} data-testid="rush-row" data-name={`${r.supplierName}｜${r.seriesName}`}>
                    <span className="w-14 shrink-0 text-[18px] font-extrabold">{taipeiParts(r.startAt).time}</span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[15px]">{r.supplierName}</b>
                      <span className="block truncate text-[13px] text-mute">{r.seriesName}</span>
                      <span className="mt-1 flex flex-wrap gap-1 text-[12px]">
                        <span className={`rounded-full px-2 py-0.5 ${toneCls[b.tone]}`}>{b.text}</span>
                        {near && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-warn">⚠ 時間衝突：{near.map((x) => x.supplierName).join("、")}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
