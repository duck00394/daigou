// 名詞說明：看不懂的字來這裡查；最上面可以開始新手教學
import Link from "next/link";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "名詞說明" };

const SECTIONS: { title: string; items: [string, string][] }[] = [
  {
    title: "買東西（採購）",
    items: [
      ["系列", "一個活動或主題，例如 ANA、萬聖節。同類的系列放在同一個「種類」，例如聯名、節慶。"],
      ["採購團（一團）", "每跟代購下一次單就是一團，記買了哪些角色、付了多少、到了幾件。"],
      ["品項", "商品的種類，例如吊娃、S 娃。同一個品項每個角色的售價通常一樣。"],
      ["對單", "跟代購確認有沒有買到。確認買到的才算進庫存和成本；沒買到的砍掉。"],
      ["砍單", "代購沒買到（或你不要了）的件數。付過的錢會列在「已砍單，未退款」，代購退了再按「記退款」。"],
      ["合資", "兩個人一起買的團。每件可以設定是誰的；一起的照比例分，運費平均或照商品金額分。"],
      ["關稅 %", "填了會用商品金額自動估出關稅，平均攤到每件的成本。"],
    ],
  },
  {
    title: "手上有多少（庫存）",
    items: [
      ["現有／手上的", "已經寄到、在你手上的（自己留的不算）。"],
      ["一定到／確定買到", "對單時代購說有買到、還沒寄到的。"],
      ["不一定", "還沒跟代購確認買到沒的。不算進庫存和成本。"],
      ["客人訂", "客人預訂了、還沒交給客人的。"],
      ["有幾隻／庫存", "手上的＋確定買到的，扣掉客人訂的，也就是還可以再賣幾隻。負的代表不夠。"],
      ["自留", "自己留著不賣的，不算在庫存裡。"],
    ],
  },
  {
    title: "錢",
    items: [
      ["總共要付代購", "這些團的商品錢加上運費、關稅。"],
      ["已付", "已經付給代購的錢。"],
      ["還沒付", "還要付給代購的錢＝總共要付－已付。"],
      ["代購要退", "付了錢但被砍單（或整團取消），代購應該退你的錢。"],
      ["每隻成本", "買價＋運費、關稅平均分到每一隻，換成台幣。只算確定買到的。"],
      ["預估價", "代購還沒告訴你最後價格，先用新增時填的單價算。"],
      ["賺多少", "賣掉的收入－那幾隻的成本。"],
      ["預估可賺", "客人預訂、還有剩下照售價賣掉的話，大概可以賺多少。還沒填售價的先不算。"],
    ],
  },
  {
    title: "賣東西",
    items: [
      ["賣給客人", "選系列填數量。手上有貨的直接賣掉；沒貨的記成客人預訂。"],
      ["出貨", "客人預訂的東西到了，交給客人時在這裡記。"],
      ["作廢／更正", "賣錯了用這個改，庫存會自動回來，原紀錄會留著。"],
    ],
  },
];

export default async function HelpPage() {
  await requireUser();
  return (
    <div className="space-y-4">
      <PageHeader title="名詞說明" sub="看不懂的字來這裡查" />
      <Link href="/?tour=1" className="flex items-center justify-between rounded-xl bg-ai px-4 py-3.5 text-white" data-testid="start-tour">
        <span>
          <span className="block text-[16px] font-semibold">新手教學</span>
          <span className="block text-[13px] opacity-85">一步一步帶你走一次，大約一分鐘</span>
        </span>
        <span aria-hidden>›</span>
      </Link>
      {SECTIONS.map((sec) => (
        <section key={sec.title} className="rounded-xl border border-line bg-card">
          <h2 className="border-b border-line-2 px-4 py-2.5 text-[15px] font-semibold">{sec.title}</h2>
          <dl className="divide-y divide-line-2">
            {sec.items.map(([k, v]) => (
              <div key={k} className="px-4 py-2.5">
                <dt className="text-[15px] font-semibold">{k}</dt>
                <dd className="mt-0.5 text-[14px] leading-relaxed text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
