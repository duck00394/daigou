// 日常操作（桌面）：活動下建兩團 → 砍單 → 跨團複製 → 活動頁跨團比價 → 收貨 → 自留
import { test, expect, type Page } from "@playwright/test";
import { login, toast } from "./helpers";

const cell = (page: Page, row: number, col: number) => page.locator(`[data-row="${row}"][data-col="${col}"]`).first();

async function stockOf(page: Page, name: string) {
  await page.goto(`/inventory?tab=stock&only=all&q=${encodeURIComponent(name)}`);
  const row = page.getByRole("row").filter({ hasText: name });
  if ((await row.count()) === 0) return { avail: 0, kept: 0 };
  const cell = async (i: number) => Number((await row.first().getByRole("cell").nth(i).textContent())?.trim() ?? 0);
  return { avail: await cell(3), kept: await cell(4) };
}

async function newBatch(page: Page, name: string) {
  await page.goto("/inventory/batches/new");
  await page.getByLabel("採購團名稱").fill(name);
  await page.getByLabel("所屬活動／系列").selectOption({ label: "萬聖節" });
  await page.getByLabel("供應商").selectOption({ label: "日本官網" });
  await page.getByRole("button", { name: "建立採購團" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
}

test("桌面：砍單、跨團複製、活動頁比價、自留", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4); // 每次不同，重複執行也不會撞名
  await login(page);
  await newBatch(page, `E2E 萬聖 A 團 ${tag}`);
  await page.getByLabel("IP／系列").selectOption({ label: "吉伊卡哇" });
  await page.getByLabel("商品類型").selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  await page.getByRole("button", { name: "＋ 小八" }).click();
  await cell(page, 0, 2).fill("350");
  await cell(page, 0, 4).fill("3");
  await cell(page, 1, 2).fill("350");
  await cell(page, 1, 4).fill("2");
  await page.getByRole("button", { name: "批次新增 2 列" }).click();
  await page.getByRole("button", { name: "確認新增 2 列" }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  // 新增完回到品項清單（只看不改），要改才按「編輯」
  await expect(page.getByRole("list", { name: "品項清單" })).toContainText("吉伊卡哇 小八 吊娃");
  await expect(page.getByTestId("items-total")).toHaveText("NT$1,750");
  await expect(page.getByTestId("batch-due")).toHaveText("NT$1,750");
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  const table = page.getByRole("table", { name: "採購品項", exact: true });
  const rowOf = (name: string) => table.getByRole("row").filter({ hasText: name });

  // 砍單：小八砍 1 件
  await rowOf("吉伊卡哇 小八 吊娃").getByRole("button", { name: "砍單" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("radio", { name: "代購砍單" }).click();
  await dlg.getByLabel("砍單數量").fill("1");
  await dlg.getByRole("button", { name: "砍掉 1 件" }).click();
  await expect(dlg.getByText("已取消 1 件，這個品項還有 1 件有效")).toBeVisible();
  await dlg.getByRole("button", { name: "知道了" }).click();
  await expect(rowOf("吉伊卡哇 小八 吊娃")).toContainText("已砍單 1 件（代購砍單）");
  await expect(rowOf("吉伊卡哇 吉伊 吊娃").getByLabel("數量")).toHaveValue("3"); // 其他品項不受影響

  // B 團：從 A 團複製，改吉伊單價
  await newBatch(page, `E2E 萬聖 B 團 ${tag}`);
  await page.getByRole("button", { name: "從其他團複製品項" }).click();
  const src = dlg.getByLabel("來源採購團");
  await src.selectOption((await src.locator("option", { hasText: `E2E 萬聖 A 團 ${tag}` }).getAttribute("value"))!);
  await expect(dlg.getByLabel("吉伊卡哇 吉伊 吊娃 單價")).toHaveValue("350");
  await expect(dlg.getByLabel("吉伊卡哇 小八 吊娃 數量")).toHaveValue("1");
  await dlg.getByLabel("吉伊卡哇 吉伊 吊娃 單價").fill("380");
  await expect(dlg.getByRole("button", { name: "新增到本團" })).toBeDisabled();
  await dlg.getByLabel(/已確認本團的實際單價/).check();
  await dlg.getByRole("button", { name: "新增到本團" }).click();
  await toast(page, "已新增 2 個品項");
  await page.getByRole("button", { name: "收起" }).click();
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  await expect(rowOf("吉伊卡哇 吉伊 吊娃").getByLabel("預估單價")).toHaveValue("380");
  await expect(page.getByText("還沒有付給供應商的款項")).toBeVisible();

  // 活動頁：兩團與跨團比價
  await page.goto("/categories");
  await page.getByRole("link", { name: "萬聖節", exact: true }).first().click();
  const cmp = page.locator("section").filter({ has: page.getByRole("heading", { name: "跨團價格比較" }) });
  const chiikawa = cmp.getByRole("row").filter({ hasText: "吉伊卡哇 吉伊 吊娃" });
  await expect(chiikawa).toContainText("NT$350");
  await expect(chiikawa).toContainText("NT$380");
  await expect(chiikawa).toContainText("NT$350／NT$380");
  await expect(chiikawa.getByText("暫估").first()).toBeVisible();
  await page.getByRole("link", { name: "含費用單件成本" }).click();
  await expect(page).toHaveURL(/view=full/);

  // A 團到貨，自留 2 件
  const before = await stockOf(page, "吉伊卡哇 吉伊 吊娃"); // 只比較本測試造成的變化
  await page.goto("/inventory?tab=batches");
  await page.getByRole("link", { name: new RegExp(`E2E 萬聖 A 團 ${tag}`) }).click();
  await page.getByRole("button", { name: "＋ 登記這次收貨" }).click();
  const rcv = page.getByRole("form", { name: "登記收貨" });
  await rcv.getByRole("radio").first().click();
  await rcv.getByRole("button", { name: "全部到齊" }).click();
  await rcv.getByRole("button", { name: "儲存收貨" }).click();
  await toast(page, "良品 4 件已入庫");

  await page.goto("/inventory?tab=stock&q=吉伊卡哇 吉伊 吊娃");
  const stockRow = page.getByRole("row").filter({ hasText: "吉伊卡哇 吉伊 吊娃" });
  await stockRow.getByRole("button", { name: "自留" }).click();
  await dlg.getByLabel("數量").fill("2");
  await dlg.getByRole("button", { name: "自留 2 件" }).click();
  await toast(page, "已自留 2 件");
  await expect(stockRow.getByRole("cell").nth(4)).toHaveText(String(before.kept + 2)); // 自留
  await expect(stockRow.getByRole("cell").nth(3)).toHaveText(String(before.avail + 1)); // 可售：到貨 3 − 自留 2

  // 直接出售剩下的 1 件 → 出售紀錄 → 更正售價 → 作廢後庫存回來
  await stockRow.getByRole("button", { name: "出售" }).click();
  await dlg.getByLabel("每件售價（台幣）").fill("520");
  await dlg.getByText("選填：買家、日期、備註").click();
  await dlg.getByLabel("成交日期").fill("2025-02-10"); // 過去月份：不影響其他測試的本月報表
  await dlg.getByLabel("備註").fill(`E2E-${tag}`); // 讓出售紀錄可以只搜到本次測試的資料
  await dlg.getByRole("button", { name: "確認出售 NT$520" }).click();
  await expect(dlg.getByText("收入")).toBeVisible();
  await expect(dlg).toContainText("NT$520");
  await dlg.getByRole("button", { name: "完成" }).click();
  await expect(stockRow.getByRole("cell").nth(3)).toHaveText(String(before.avail));

  await page.goto(`/sales?ym=2025-02&q=E2E-${tag}`);
  const sale = page.getByTestId("sale-row").filter({ hasText: "吉伊卡哇 吉伊 吊娃" }).first();
  await expect(sale).toContainText("散客");
  await expect(sale).toContainText("已收款");
  await sale.getByRole("button", { name: "更正" }).click();
  await dlg.getByLabel("每件售價（台幣）").fill("550");
  await dlg.getByLabel("更正原因（必填）").fill("少算 30");
  await dlg.getByRole("button", { name: "作廢舊紀錄並儲存" }).click();
  await toast(page, /已更正：收入 NT\$550/);
  await expect(sale).toContainText("每件 NT$550");
  await sale.getByRole("button", { name: "作廢" }).click();
  await dlg.getByLabel("作廢原因（必填）").fill("沒有成交");
  await dlg.getByRole("button", { name: "作廢" }).click();
  await toast(page, "已作廢");
  await page.getByRole("link", { name: "顯示已作廢" }).click();
  await expect(page.getByTestId("sale-row").filter({ hasText: "已作廢" })).toHaveCount(2);
  await page.goto("/inventory?tab=stock&q=吉伊卡哇 吉伊 吊娃");
  await expect(stockRow.getByRole("cell").nth(3)).toHaveText(String(before.avail + 1));

  // 出售紀錄匯出：包含作廢與有效紀錄、成本與毛利欄位
  const csv = await (await page.request.get("/api/export/sales?format=csv")).text();
  expect(csv).toContain("商品成本");
  expect(csv).toContain("吉伊卡哇 吉伊 吊娃");
  expect(csv).toContain("已作廢");

  // 經過砍單、複製、收貨、自留、出售、更正、作廢後，資料健康檢查必須一致
  await page.goto("/settings");
  await page.getByRole("button", { name: "執行檢查" }).click();
  await expect(page.getByText("資料一致，沒有發現問題。")).toBeVisible();
});
