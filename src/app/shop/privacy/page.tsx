import { prisma } from "@/server/db";
import { getShopName } from "@/server/services/shop";
import { getShopInfo } from "@/server/services/shop-pay";
import { DocPage, DocSection } from "../doc";

export const metadata = { title: "隱私權政策" };
export const dynamic = "force-dynamic";

export default async function Privacy() {
  const [name, info] = await Promise.all([getShopName(prisma), getShopInfo(prisma)]);
  const contact = [info.supportEmail ? `Email ${info.supportEmail}` : null, info.threads ? `Threads @${info.threads}` : null, "LINE 官方帳號"].filter(Boolean).join("、");
  return (
    <DocPage eyebrow="PRIVACY" title="隱私權政策" updated="2026/11/3">
      <p>{name}重視你的個人資料，以下說明我們蒐集哪些資料、怎麼使用、保存多久，以及你可以怎麼查詢或刪除。</p>

      <DocSection title="1. 我們蒐集的資料">
        <ul className="list-disc space-y-1 pl-5">
          <li>下單時填的：社群暱稱、Email（訪客下單）、結帳頁要求的聯絡方式（例如 Threads／IG 帳號或手機）、取貨方式、備註。</li>
          <li>用 LINE 登入時：LINE 的使用者識別碼、顯示名稱、大頭貼（只用來辨識你和傳通知，不會拿到你的 LINE 好友或聊天內容）。</li>
          <li>訂單內容：商品、數量、金額、付款與出貨狀態。</li>
          <li>我們<b>不會</b>蒐集信用卡或銀行帳號；付款在 7-ELEVEN 賣貨便完成，收件人與門市資料是你在賣貨便填寫。</li>
        </ul>
      </DocSection>

      <DocSection title="2. 使用目的">
        <p>處理訂單、排單與候補、通知付款期限與貨況、出貨、退款、回覆客服問題。不會用來寄廣告，也不會賣給任何人。</p>
      </DocSection>

      <DocSection title="3. 會提供給誰">
        <ul className="list-disc space-y-1 pl-5">
          <li>LINE：用 LINE 登入或傳通知時。</li>
          <li>Google（Gmail）：寄 Email 通知給訪客下單的客人時。</li>
          <li>網站主機與資料庫服務：存放訂單資料。</li>
          <li>物流與金流（7-ELEVEN 賣貨便）：由你自己在賣貨便填寫與付款。</li>
          <li>依法律要求（例如司法機關依法調查）時。</li>
        </ul>
      </DocSection>

      <DocSection title="4. 保存期限">
        <p>訂單完成後保存 5 年，作為帳務與售後服務紀錄；期滿後刪除或去識別化。你要求刪除時，除了法律要求要保留的帳務資料，其他會刪除。</p>
      </DocSection>

      <DocSection title="5. 你的權利">
        <p>依個人資料保護法，你可以查詢、閱覽、要求複本、補充或更正、停止使用或刪除你的個人資料。請聯絡 {contact}，並附上訂單編號，我們會在確認是你本人後處理。</p>
      </DocSection>

      <DocSection title="6. 安全措施">
        <ul className="list-disc space-y-1 pl-5">
          <li>網站全程加密連線（HTTPS）。</li>
          <li>查詢碼只存加密後的雜湊，查詢頁只會顯示你自己的那一筆訂單；猜錯太多次會暫停查詢。</li>
          <li>只有經營者可以登入後台。</li>
        </ul>
      </DocSection>

      <DocSection title="7. Cookie">
        <p>網站會用 Cookie 記住你的 LINE 登入狀態，以及這支手機下過的訂單（讓你不用登入也能在「我的訂單」看到）。清除瀏覽器資料後就會消失，可以再用訂單編號＋查詢碼查詢。</p>
      </DocSection>

      <DocSection title="8. 政策修改">
        <p>政策有修改時會更新這一頁，並寫上最後更新日期。</p>
      </DocSection>
    </DocPage>
  );
}
