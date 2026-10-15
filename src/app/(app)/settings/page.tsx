import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getDefaultRateMicro } from "@/server/services/settings";
import { businessDataCount } from "@/server/services/backup";
import { PageHeader, Section, LinkButton, Twd, Empty } from "@/components/ui";
import { RateForm, NameList, ExpenseForm, DeleteExpense, RestoreForm, LogoutAll } from "./parts";
import { costKind, fmtDate } from "@/lib/labels";
import { formatRate } from "@/lib/money";

export const metadata = { title: "匯出、備份與設定" };

const EXPORTS: [string, string, string][] = [
  ["products", "商品", "含庫存數量、別名與分類"],
  ["buyers", "買家", "不含收件人、電話、地址"],
  ["buyers?private=1", "買家（含收件資料）", "包含私人資料，請小心保管"],
  ["orders", "訂單明細", "每列一項商品，含付款與出貨狀態"],
  ["payments", "收款與退款", "所有付款與退款紀錄"],
  ["purchases", "採購品項", "各採購團的單價、幣別、匯率、數量與分攤費用"],
  ["inventory", "庫存流水", "每一次到貨、保留、出貨與調整"],
  ["shipments", "出貨紀錄", "不含收件資料"],
  ["to-ship", "待出貨清單", "依買家排序"],
];

export default async function Settings() {
  await requireUser();
  const [rate, chars, types, expenses, dataCount, audits] = await Promise.all([
    getDefaultRateMicro(prisma),
    prisma.character.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.productType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.expense.findMany({ orderBy: { date: "desc" }, take: 20 }),
    businessDataCount(),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="匯出、備份與設定" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="預設匯率">
          <RateForm current={formatRate(rate)} />
        </Section>
        <Section title="帳號安全">
          <p className="mb-3 text-sm text-ink-2">管理者密碼設定在伺服器的環境變數 ADMIN_PASSWORD_HASH，修改方式見 README。登入 3 天未使用或 14 天後需要重新登入；同一來源連續輸錯 5 次會暫停 15 分鐘。</p>
          <LogoutAll />
        </Section>
        <Section title="角色">
          <NameList kind="character" items={chars} />
        </Section>
        <Section title="商品類型">
          <NameList kind="type" items={types} />
        </Section>
      </div>

      <Section title="其他費用（不屬於任何採購團）">
        <ExpenseForm />
        {expenses.length === 0 ? <Empty>沒有其他費用。</Empty> : (
          <ul className="mt-3 divide-y divide-line-2 text-sm">
            {expenses.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{e.date.toISOString().slice(0, 10)}｜{costKind[e.kind]}{e.note ? `｜${e.note}` : ""}</span>
                <span className="flex items-center gap-2"><Twd v={e.amountTwd} /><DeleteExpense id={e.id} /></span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="匯出資料" pad={false}>
        <ul className="divide-y divide-line-2">
          {EXPORTS.map(([k, label, desc]) => (
            <li key={k} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span><span className="font-medium">{label}</span><span className="ml-2 text-[13px] text-mute">{desc}</span></span>
              <span className="flex gap-2">
                <LinkButton small href={`/api/export/${k}`}>Excel</LinkButton>
                <LinkButton small href={`/api/export/${k}${k.includes("?") ? "&" : "?"}format=csv`}>CSV</LinkButton>
              </span>
            </li>
          ))}
        </ul>
        <p className="px-4 py-2 text-[12px] text-mute">CSV 已防範試算表公式注入：以 = + - @ 開頭的文字會加上單引號。</p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="完整備份">
          <p className="mb-3 text-sm text-ink-2">下載包含所有商品、買家、訂單、付款、退款、庫存、出貨、匯入與稽核紀錄的 JSON 檔，可在任何安裝本系統的環境還原。檔案含私人資料，請存放在安全的位置。</p>
          <LinkButton href="/api/backup" primary>下載完整備份</LinkButton>
          <p className="mt-2 text-[12px] text-mute">資料庫層級的備份（pg_dump）方式見 docs/備份與還原.md。</p>
        </Section>
        <Section title="從備份還原">
          <RestoreForm hasData={dataCount > 0} />
        </Section>
      </div>

      <Section title="最近的操作紀錄" pad={false}>
        <ul className="max-h-80 divide-y divide-line-2 overflow-y-auto text-[13px]">
          {audits.map((a) => (
            <li key={a.id} className="flex gap-3 px-4 py-1.5">
              <span className="num shrink-0 text-mute">{fmtDate(a.createdAt, true)}</span>
              <span className="font-mono text-[12px]">{a.action}</span>
              <span className="text-mute">{a.entity}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
