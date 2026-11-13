import { AreaTabs } from "@/components/area-tabs";
import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { appUrl } from "@/server/push";
import { callbackUrl, lineEnv, loginConfigured, pushConfigured } from "@/server/line";
import { getContactField, getShopName, isOpen } from "@/server/services/shop";
import { PageHeader, Section, Badge } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { taipeiDayLabel, taipeiParts } from "@/lib/taipei";
import { ContactFieldForm, OpenSeries, OperatorLine, ShopInfoForm, ShopName } from "./parts";
import { getShopInfo } from "@/server/services/shop-pay";
import { mailConfigured, mailEnv } from "@/server/mail";

export const metadata = { title: "訂購頁" };

export default async function ShopAdmin() {
  await requireUser();
  const [info, mailFailed, recentMail] = await Promise.all([
    getShopInfo(prisma),
    prisma.mailOutbox.count({ where: { sentAt: null, tries: { gte: 3 } } }),
    prisma.mailOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { id: true, to: true, subject: true, createdAt: true, sentAt: true, tries: true, error: true } }),
  ]);
  const [name, shops, cats, ops, lineBuyers, failed, field] = await Promise.all([
    getShopName(prisma),
    prisma.shopCategory.findMany({ include: { category: { select: { name: true, active: true } }, owner: { select: { name: true } } }, orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }] }),
    prisma.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], select: { id: true, name: true } }),
    prisma.operator.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, lineUserId: true } }),
    prisma.buyer.findMany({ where: { lineUserId: { not: null }, mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 80, select: { id: true, name: true, lineName: true, lineUserId: true } }),
    prisma.lineOutbox.count({ where: { sentAt: null, tries: { gte: 3 } } }),
    getContactField(prisma),
  ]);
  const recent = await prisma.lineOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { id: true, createdAt: true, sentAt: true, tries: true, error: true } });
  const quotaCounts = await prisma.shopQuota.groupBy({ by: ["categoryId"], _count: { _all: true } });
  const qc = new Map(quotaCounts.map((q) => [q.categoryId, q._count._all]));
  const base = appUrl();
  const shopUrl = base ? `${base}/shop` : "/shop";
  const env = lineEnv();

  return (
    <div className="space-y-4">
      <AreaTabs area="take" current="/shop-admin" />
      <PageHeader title="訂購頁（客人下單）" sub="客人用訪客或 LINE 登入自己下單，訂單會直接進「訂單」，也會算進庫存的客人訂" actions={<Link href="/shop-pay" className="text-[14px] text-ai underline">訂購頁付款</Link>} />

      <Section title="訂購頁網址">
        <div className="flex flex-wrap items-center gap-2">
          <a href="/shop" target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[15px] text-ai underline">{shopUrl}</a>
          <CopyButton text={shopUrl} label="複製網址" />
        </div>
        <p className="mt-2 text-[13px] text-mute">貼到 LINE 官方帳號的圖文選單或社群公告，客人點了就能下單。</p>
        <div className="mt-3"><ShopName name={name} /></div>
        <div className="mt-3"><ContactFieldForm mode={field.mode} label={field.label} /></div>
      </Section>

      <Section title="客服資料">
        <ShopInfoForm threads={info.threads} supportEmail={info.supportEmail} bankInfo={info.bankInfo} />
        <p className="mt-2 text-[13px] text-mute">
          客人會看到的頁面：<a href="/shop/rules" target="_blank" rel="noreferrer" className="text-ai underline">交易規則</a>、<a href="/shop/privacy" target="_blank" rel="noreferrer" className="text-ai underline">隱私權政策</a>
        </p>
      </Section>

      <Section title="Email 通知（訪客下單的客人）">
        <ul className="space-y-1.5 text-[14px]">
          <li className="flex flex-wrap items-center gap-2">{mailConfigured() ? <Badge tone="good">已設定</Badge> : <Badge tone="bad">還沒設定</Badge>} 用 Gmail 寄信（GMAIL_USER、GMAIL_APP_PASSWORD）{mailConfigured() && <span className="text-mute">寄件人：{mailEnv().user}</span>}</li>
        </ul>
        {!mailConfigured() && (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
            <li>Google 帳號要先開「兩步驟驗證」。</li>
            <li>到 Google 帳號的「應用程式密碼」建立一組（16 個字）。</li>
            <li>在 Vercel 專案的環境變數加上 GMAIL_USER（Gmail 地址）和 GMAIL_APP_PASSWORD（那 16 個字），重新部署。</li>
          </ol>
        )}
        {mailFailed > 0 && <p className="mt-2 text-[13px] text-bad">有 {mailFailed} 封信寄不出去（可能是 Email 打錯，或應用程式密碼不對）。</p>}
        {mailConfigured() && (
          <div className="mt-3">
            <div className="text-[13px] font-medium text-ink-2">最近的 Email 通知</div>
            {recentMail.length === 0 ? (
              <p className="mt-1 text-[13px] text-mute">還沒有寄過信。訪客下單（不用 LINE）時才會寄。</p>
            ) : (
              <ul className="mt-1 divide-y divide-line-2 rounded-lg border border-line-2 text-[13px]">
                {recentMail.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5" data-testid="mail-outbox">
                    <span className="num text-mute">{taipeiParts(r.createdAt).date.slice(5)} {taipeiParts(r.createdAt).time}</span>
                    {r.sentAt ? <Badge tone="good">已寄出</Badge> : r.tries >= 3 ? <Badge tone="bad">寄不出去</Badge> : r.tries > 0 ? <Badge tone="warn">失敗，會再試</Badge> : <Badge tone="warn">等待寄出</Badge>}
                    <span className="min-w-0 flex-1 truncate">{r.to}</span>
                    {r.error && <span className="w-full break-all text-bad">{r.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      <Section title="開放訂購的系列">
        {shops.length === 0 ? (
          <p className="text-[14px] text-mute">還沒有系列開放訂購。從下面選一個系列開始設定。</p>
        ) : (
          <ul className="divide-y divide-line-2 rounded-lg border border-line-2">
            {shops.map((s) => (
              <li key={s.categoryId}>
                <Link href={`/shop-admin/${s.categoryId}`} className="flex items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{s.category.name}</div>
                    <div className="text-[12px] text-mute">
                      {qc.get(s.categoryId) ?? 0} 個商品開放，{s.owner?.name ?? "還沒選負責人"}
                      {s.openAt ? `，${taipeiDayLabel(s.openAt)} ${taipeiParts(s.openAt).time} 開賣` : ""}
                    </div>
                  </div>
                  {!s.enabled ? <Badge tone="muted">沒開放</Badge> : isOpen(s) ? <Badge tone="good">販售中</Badge> : <Badge tone="warn">等開賣</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3"><OpenSeries cats={cats.filter((c) => !shops.some((s) => s.categoryId === c.id))} /></div>
        <p className="mt-2 text-[13px] text-mute">
          客人訂了之後要買多少：看 <Link href="/inventory?tab=stock&v=1&only=short" className="text-ai underline">待買清單</Link>（客人訂的比現有＋一定到還多的）。
        </p>
      </Section>

      <Section title="LINE 設定">
        <ul className="space-y-1.5 text-[14px]">
          <li className="flex items-center gap-2">{loginConfigured() ? <Badge tone="good">已設定</Badge> : <Badge tone="bad">還沒設定</Badge>} LINE 登入（LINE_LOGIN_CHANNEL_ID、LINE_LOGIN_CHANNEL_SECRET）</li>
          <li className="flex items-center gap-2">{pushConfigured() ? <Badge tone="good">已設定</Badge> : <Badge tone="bad">還沒設定</Badge>} 訂單通知（LINE_CHANNEL_ACCESS_TOKEN）</li>
          <li className="flex items-center gap-2">{env.oaId ? <Badge tone="good">{env.oaId}</Badge> : <Badge tone="warn">還沒設定</Badge>} 官方帳號 ID（LINE_OA_ID，下單後跳回聊天室用）</li>
        </ul>
        {base && (
          <div className="mt-3 rounded-lg bg-line-2 px-3 py-2 text-[13px]">
            <div className="text-mute">LINE Login 的 Callback URL（貼到 LINE Developers）：</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate">{callbackUrl()}</code>
              <CopyButton text={callbackUrl()} label="複製" />
            </div>
          </div>
        )}
        {failed > 0 && <p className="mt-2 text-[13px] text-bad">有 {failed} 則 LINE 通知送不出去（客人可能封鎖了官方帳號，或金鑰不對）。</p>}
        {recent.length > 0 && (
          <div className="mt-3">
            <div className="text-[13px] font-medium text-ink-2">最近的 LINE 通知</div>
            <ul className="mt-1 divide-y divide-line-2 rounded-lg border border-line-2 text-[13px]">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5" data-testid="line-outbox">
                  <span className="num text-mute">{taipeiParts(r.createdAt).date.slice(5)} {taipeiParts(r.createdAt).time}</span>
                  {r.sentAt ? <Badge tone="good">已送出</Badge> : r.tries >= 3 ? <Badge tone="bad">送不出去</Badge> : <Badge tone="warn">等待送出</Badge>}
                  {r.error && <span className="min-w-0 flex-1 break-all text-bad">{r.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="新訂單通知誰">
        <p className="mb-2 text-[13px] text-mute">先用自己的 LINE 登入一次訂購頁（右上角「LINE 登入」），再回來這裡選「這是我」。之後你負責的系列有新訂單就會通知你。</p>
        <ul className="space-y-2">
          {ops.map((o) => (
            <li key={o.id}>
              <OperatorLine op={{ id: o.id, name: o.name }} current={lineBuyers.find((b) => b.lineUserId === o.lineUserId)?.id ?? (o.lineUserId ? "keep" : "")} choices={lineBuyers.map((b) => ({ id: b.id, label: b.lineName && b.lineName !== b.name ? `${b.name}（LINE：${b.lineName}）` : b.name }))} />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
