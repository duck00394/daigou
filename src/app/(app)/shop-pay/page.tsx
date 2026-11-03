// 後台：訂購頁付款（賣貨便）。等客人下單、等到貨、逾期、賣貨便已下單，一筆一行，按一下就處理
import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { viewOwner } from "@/server/view";
import { mineKeys } from "@/server/services/mine";
import { payRows, sweepShopPay, dueLabel } from "@/server/services/shop-pay";
import { mailConfigured } from "@/server/mail";
import { PageHeader, Section } from "@/components/ui";
import { NavSelect } from "@/components/nav-select";
import { PayList } from "./rows";

export const metadata = { title: "訂購頁付款" };
export const dynamic = "force-dynamic";

const VIEWS = {
  waiting: "等客人下單",
  arrival: "到貨才付：等發通知",
  overdue: "逾期",
  myship: "賣貨便已下單",
} as const;

export default async function ShopPay({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  await requireUser();
  await sweepShopPay().catch((e) => console.error("[sweep]", e));
  const { v: raw } = await searchParams;
  const v = (raw && raw in VIEWS ? raw : "waiting") as keyof typeof VIEWS;
  const keys = mineKeys(await viewOwner());
  const [rows, counts] = await Promise.all([
    payRows(prisma, v, keys),
    Promise.all((Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map(async (k) => [k, k === v ? -1 : (await payRows(prisma, k, keys)).length] as const)),
  ]);
  const cnt = Object.fromEntries(counts.map(([k, n]) => [k, n === -1 ? rows.length : n]));
  return (
    <div className="space-y-4">
      <PageHeader title="訂購頁付款" sub="客人用賣貨便下單了沒；期限到了沒下單會自動取消，名額給候補" back={{ href: "/shop-admin", label: "訂購頁" }} />
      <NavSelect label="顯示" current={`/shop-pay?v=${v}`} options={(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((k) => ({ label: `${VIEWS[k]}（${cnt[k]}）`, href: `/shop-pay?v=${k}` }))} />
      {!mailConfigured() && <p className="rounded-xl border border-[#f0dfa8] bg-warn-soft px-3 py-2 text-[13px] text-warn">Email 寄信還沒設定（GMAIL_USER、GMAIL_APP_PASSWORD），訪客下單的客人收不到通知。設定方式見<Link href="/shop-admin" className="underline">訂購頁</Link>的「通知設定」。</p>}
      <Section>
        <PayList
          view={v}
          rows={rows.map((r) => ({ ...r, dueLabel: r.dueAt ? dueLabel(r.dueAt) : null, noticeLabel: r.noticeAt ? dueLabel(r.noticeAt) : null, myshipLabel: r.myshipAt ? dueLabel(r.myshipAt) : null, dueAt: r.dueAt?.toISOString() ?? null, noticeAt: null, myshipAt: null }))}
        />
      </Section>
      <p className="text-[12px] text-mute">每一個「賣貨便已下單」「補發通知」「延期」「取消」都會記在操作紀錄裡。</p>
    </div>
  );
}
