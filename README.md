# 代購帳房：日本角色周邊代購管理

個人使用的代購管理後台：商品、系列與角色、供應商、採購團（含批次新增系列商品）、活動分類、代購團、LINE 貼上加單、Excel 匯入、買家與標籤、收款退款、採購與到貨、砍單、跨團複製與比價、雙人經營責任紀錄（誰下單、誰付款、誰收貨）與經營者對帳、庫存與自留、現貨直接出售（可更正、作廢）、出貨、成本與利潤、庫存估值、資料健康檢查、匯出與備份。

- 技術：Next.js 15（App Router）、TypeScript、Tailwind CSS 4、Prisma 6、PostgreSQL
- 全部使用免費開源套件，不依賴任何付費服務；可完全在本機執行
- 文件：[計算口徑](docs/計算口徑.md)、[狀態規則](docs/狀態規則.md)、[備份與還原](docs/備份與還原.md)

## 本機啟動（Windows / macOS）

需要：Node.js 20 以上、PostgreSQL 14 以上（本機安裝即可）。

1. 建立資料庫（以 PostgreSQL 內建的 psql 或 pgAdmin 執行）：
   ```sql
   CREATE USER daigou WITH PASSWORD '自訂密碼' CREATEDB;
   CREATE DATABASE daigou OWNER daigou;
   ```
2. 安裝套件：`npm install`
3. 複製 `.env.example` 為 `.env`，填入 `DATABASE_URL`。
4. 產生管理者密碼雜湊：`npm run hash-password -- "你的密碼"`，把印出的那一行貼到 `.env`（雜湊值裡的 `$` 前面要有反斜線，指令已經處理好）。
5. 建立資料表：`npm run db:migrate`
6. 建立預設分類、標籤、商品類型、角色（可重複執行，不會建立假訂單）：`npm run db:seed`
7. 開發模式：`npm run dev`，或正式模式：`npm run build` 後 `npm start`，打開 http://localhost:3000

以 `npm start` 在本機用 http（非 https）測試時，登入 Cookie 預設要求 https，請在 `.env` 加上 `INSECURE_COOKIE=1`；部署到 https 網站時不要設定。

## 環境變數

| 名稱 | 必填 | 說明 |
|---|---|---|
| `DATABASE_URL` | 是 | 任何標準 PostgreSQL 連線字串 |
| `ADMIN_PASSWORD_HASH` | 是 | 管理者密碼的 bcrypt 雜湊值（不是密碼本身） |
| `INSECURE_COOKIE` | 否 | 只在本機 http 測試正式模式時設為 `1` |
| `TEST_DATABASE_URL` | 否 | 測試用資料庫，名稱必須含 `test`；預設 `daigou_test` |
| `VAPID_PUBLIC_KEY` | 搶購通知 | Web Push 公開金鑰（`npx web-push generate-vapid-keys` 產生） |
| `VAPID_PRIVATE_KEY` | 搶購通知 | Web Push 私密金鑰，只放伺服器環境變數 |
| `QSTASH_TOKEN` | 搶購通知 | Upstash QStash 的 token（免費方案即可） |
| `QSTASH_CURRENT_SIGNING_KEY`／`QSTASH_NEXT_SIGNING_KEY` | 搶購通知 | 驗證排程呼叫真的來自 QStash |
| `QSTASH_URL` | 否 | QStash 帳號在非預設區域時才需要（Upstash 主控台會顯示） |
| `APP_URL` | 否 | 正式網址；沒填時用 Vercel 提供的正式網域 |

更換密碼：重新產生雜湊並更新環境變數後重新啟動；可在設定頁「登出所有裝置」。

## 搶購提醒的通知

- 手機通知用 Web Push；iPhone 要 iOS 16.4 以上，且要從 Safari「加入主畫面」後，從主畫面圖示打開才能允許通知。
- 準時觸發用 Upstash QStash（Vercel 免費方案的排程一天只能一次、誤差可達一小時，不夠準）：存提醒時預約 QStash 在「開始前 N 分鐘」呼叫 `/api/rush/fire`（驗簽章），伺服器再推播。QStash 單次最多預約 7 天，更久的會分段接力。
- 改時間、取消、刪除、標記結束都會讓舊排程失效（版本號＋觸發時再檢查）；同一場同一版只送一次；全部手機都失敗才讓 QStash 重試。
- 沒設定上面的環境變數時，畫面會顯示「推播服務還沒設定」，不會假裝排好。

## 測試

```bash
npm run db:test:prepare   # 對測試資料庫套用 migration
npm test                  # 單元測試＋整合測試（使用測試資料庫，會清空它）
npx playwright install chromium   # 第一次執行端對端測試前
npm run test:e2e          # 端對端測試：會建置正式版並以測試資料庫啟動（開始前清空測試資料庫；各檔案可單獨執行）
npm run typecheck
npm run lint
```

## 安全設計

- 登入：單一管理者密碼（bcrypt），登入後發 HttpOnly、SameSite=Lax、https 下為 Secure 的工作階段 Cookie；工作階段存在資料庫，可撤銷。14 天到期、3 天未使用到期，可登出所有裝置。
- 暴力破解防護：同一來源 15 分鐘內失敗 5 次、或全站失敗 30 次即暫停登入 15 分鐘。
- Middleware 只做第一層檢查；每個頁面、Server Action 與匯出 API 都在伺服器端重新驗證工作階段（`src/server/auth.ts`、`src/server/action.ts`）。
- 擴充邊界：已有 `User`（含角色 OWNER／ADMIN／STAFF）與 `Session` 資料表，權限檢查集中在 `can()`；之後增加員工帳號只需加入使用者管理與登入方式，不必改業務模組。
- 上傳檔案只解析、不執行；檢查副檔名與檔案標頭、10 MB 上限。CSV 匯出防範公式注入。一般匯出不含收件人、電話、地址。
- 網站設定 noindex 與基本安全標頭。

## 部署

測試網址部署在 GitHub ＋ Vercel（Hobby）＋ Neon（免費方案），推送到 main 即自動建置，建置時會執行 migration 與預設資料（`scripts/vercel-build.mjs`）。本機仍可完整運作，不依賴這些服務。

| 服務 | 用途 | 替代方案 |
|---|---|---|
| GitHub | 存放程式碼 | GitLab、本機 Git |
| Vercel | 執行網站 | Render、Fly.io、自有 VPS（`npm run build && npm start`） |
| Neon | PostgreSQL | Supabase、本機或 VPS 的 PostgreSQL（標準 PostgreSQL，可用 pg_dump 搬移） |

部署到 Vercel 的已知限制：單次上傳約 4.5 MB（Excel 匯入大檔或還原大型備份時需注意，可改在本機操作或用 pg_restore）。

## 專案結構

```
prisma/schema.prisma        資料模型；prisma/migrations 為正式 migration
prisma/seed.ts              預設分類、標籤、類型、角色
src/lib/parser/line.ts      LINE 訊息解析器（純函式）
src/lib/parser/excel.ts     Excel/CSV 讀取與欄位配對
src/lib/money.ts            整數金額、匯率、最大餘數分攤
src/server/calc/order.ts    訂單金額與狀態計算（純函式）
src/server/services/        業務邏輯（訂單、付款、庫存、採購、出貨、買家、報表、備份）
src/server/imports/         匯入預覽、驗證、重複偵測與建單
src/actions/                Server Actions（驗證登入後呼叫 services）
src/app/(app)/              各頁面
tests/unit, integration, e2e
```
