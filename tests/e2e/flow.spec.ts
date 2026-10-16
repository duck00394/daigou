// 完整流程：LINE 貼上 → 訂單 → 付款 → 採購 → 到貨 → 部分出貨 → 報表
import { test, expect } from "@playwright/test";
import * as XLSX from "@e965/xlsx";
import { login, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

test("未登入時會被導向登入頁，API 回傳 401", async ({ page, request }) => {
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/login$/);
  const r = await request.get("/api/export/orders");
  expect(r.status()).toBe(401);
  const b = await request.get("/api/backup");
  expect(b.status()).toBe(401);
  // 偽造的 Cookie 只能通過第一層，頁面仍會要求登入
  await page.context().addCookies([{ name: "dg_session", value: "fake-token", url: "http://localhost:3100" }]);
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/login$/);
  const r2 = await page.request.get("/api/export/orders");
  expect(r2.status()).toBe(401);
  await page.context().clearCookies();
});

test("密碼錯誤會顯示錯誤訊息", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("密碼").fill("wrong-password");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByText("密碼錯誤")).toBeVisible();
});

test("新增商品與分類", async ({ page }) => {
  await login(page);
  await page.goto("/products/new");
  await page.getByLabel("商品名稱（必填）").fill("小八 S 娃");
  await page.getByLabel("代購售價（台幣）").fill("300");
  await page.getByLabel("日本官方售價（日幣）").fill("990");
  await page.getByRole("button", { name: /萬聖節/ }).click();
  await page.getByRole("button", { name: /上海限定/ }).click();
  await page.getByRole("button", { name: "新增商品" }).click();
  await expect(page.getByRole("heading", { name: "小八 S 娃" })).toBeVisible();
  // 新增別名
  await page.getByLabel("新增別名").fill("小八娃娃");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await toast(page, "已新增別名");
  await expect(page.getByText("小八娃娃")).toBeVisible();
});

test("LINE 貼上：預覽、人工確認、建立訂單、重複送出不重複", async ({ page }) => {
  await login(page);
  await page.goto("/paste");
  await page.getByLabel("從 LINE 複製的訊息").fill("小美 吉伊吊娃 2、小八娃娃 1\n\n阿婷\n吉伊吊娃 3");
  await page.getByRole("button", { name: "解析訊息" }).click();
  await expect(page.getByRole("heading", { name: "確認貼上的訂單" })).toBeVisible();
  // 小美的兩筆可建立；阿婷不存在，待確認
  await expect(page.getByText("可建立 2", { exact: true })).toBeVisible();
  await expect(page.getByText("待確認 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新增買家「阿婷」" }).click();
  await expect(page.getByText("將新增買家「阿婷」", { exact: true })).toBeVisible();
  await expect(page.getByText("可建立 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "建立訂單" }).click();
  await page.getByRole("button", { name: "確認建立" }).click();
  await expect(page.getByRole("heading", { name: "建立結果" })).toBeVisible();
  await expect(page.locator("dl").filter({ hasText: "新增買家" })).toContainText("新增買家1成功列數3失敗列數0");
  await page.getByRole("button", { name: "知道了" }).click();
  await page.reload();
  await expect(page.getByText("已建立 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "建立訂單" })).toHaveCount(0);
  await page.goto("/orders");
  await expect(page.getByRole("cell", { name: /小美/ })).toHaveCount(1);
  await expect(page.getByRole("cell", { name: /阿婷/ })).toHaveCount(1);
});

test("訂單：部分付款、取消一件、建立與完成退款", async ({ page }) => {
  await login(page);
  await page.goto("/orders?q=小美");
  await page.locator("a.num").first().click();
  await expect(page.getByText("應收").first()).toBeVisible();
  // 應收 500×2 + 300 = 1300
  await expect(page.getByText("NT$1,300").first()).toBeVisible();
  await page.getByLabel("金額", { exact: true }).fill("1300");
  await page.getByRole("button", { name: "登記收款" }).click();
  await toast(page, "已登記收款");
  await expect(page.getByText("已付款").first()).toBeVisible();
  // 取消吉伊吊娃 1 件 → 應退 500
  const row = page.getByRole("row", { name: /吉伊吊娃/ });
  await row.getByRole("button", { name: "取消數量" }).click();
  await page.getByLabel("取消原因").fill("買家改單");
  await page.getByRole("button", { name: "確認取消" }).click();
  await toast(page, /需退款 NT\$500/);
  await expect(page.getByText("應退給買家")).toBeVisible();
  await page.getByRole("button", { name: "建立退款" }).click();
  await page.getByRole("button", { name: "建立待退款" }).click();
  await toast(page, "已建立待退款");
  await expect(page.getByText("退款處理中").first()).toBeVisible();
  await page.getByRole("button", { name: "標記已退款" }).click();
  await page.getByRole("button", { name: "已退款", exact: true }).click();
  await toast(page, "已標記退款完成");
  await expect(page.getByText("部分退款").first()).toBeVisible();
});

test("採購、到貨、分配、部分出貨與報表", async ({ page }) => {
  await login(page);
  await page.goto("/inventory?tab=demand");
  await page.getByRole("button", { name: "建立採購團" }).click();
  await page.getByLabel("採購團名稱").fill("10 月官網");
  await page.getByLabel("匯率（1 日圓 = ? 台幣）").fill("0.2");
  await page.getByRole("button", { name: "建立採購團並標記訂單為已下單" }).click();
  await expect(page.getByRole("heading", { name: /10 月官網/ })).toBeVisible();
  // 國際運費：預設不攤；兩人一起付時才選「每件平均攤」
  await page.getByRole("button", { name: "＋ 加運費" }).click();
  const fee = page.getByRole("dialog");
  await expect(fee.getByText("不攤進商品成本，單獨記一筆")).toBeVisible();
  await fee.getByLabel("金額", { exact: true }).fill("100");
  await fee.getByRole("radiogroup", { name: "誰付的" }).getByRole("radio", { name: "兩人一起付" }).click();
  await expect(fee.getByLabel("經營者 A 付多少")).toHaveValue("50");
  await expect(fee.getByLabel("經營者 B 付多少")).toHaveValue("50");
  await fee.getByRole("radiogroup", { name: "要不要攤進商品成本" }).getByRole("radio", { name: "每件平均攤" }).click();
  await fee.getByRole("button", { name: "儲存" }).click();
  await toast(page, "已記下這筆費用");
  await expect(page.getByTestId("fee-row")).toContainText("兩人一起付：經營者 A NT$50、經營者 B NT$50");
  await expect(page.getByTestId("fee-row")).toContainText("攤進商品成本：每件平均攤");

  // 吉伊吊娃到貨 2 件（小美 1 件、阿婷 3 件，先下單的優先）
  await page.goto("/inventory?tab=receive");
  await page.getByLabel("商品", { exact: true }).click();
  await page.getByLabel("商品", { exact: true }).fill("吉伊");
  await page.getByRole("button", { name: /吉伊吊娃/ }).first().click();
  await page.getByLabel("到貨來源").selectOption({ index: 1 });
  await page.getByLabel("到貨數量").fill("2");
  // 採購團到貨必須選收貨確認人
  await page.getByRole("button", { name: "登記到貨" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "請選擇收貨確認人" })).toBeVisible();
  await page.getByRole("radiogroup", { name: /收貨確認人/ }).getByRole("radio", { name: "經營者 A" }).click();
  await page.getByRole("button", { name: "登記到貨" }).click();
  await expect(page.getByRole("heading", { name: "分配給待出貨的訂單" })).toBeVisible();
  await page.getByRole("button", { name: "確認保留" }).click();
  await toast(page, "已保留 2 件給訂單");

  // 小美只出貨已到貨的吉伊吊娃；小八還沒到
  await page.goto("/shipping");
  const card = page.locator("section").filter({ hasText: "小美" });
  await expect(card.getByRole("button", { name: /出貨 1 件/ })).toBeVisible();
  await card.getByRole("button", { name: /出貨 1 件/ }).click();
  await page.getByLabel("物流單號").fill("TW123456");
  await page.getByRole("button", { name: "確認出貨" }).click();
  await toast(page, "已建立出貨單");
  // 小美還有小八 1 件待出貨
  await expect(page.locator("section").filter({ hasText: "小美" })).toContainText("小八 S 娃");

  await page.goto("/reports");
  // 小美出貨吉伊吊娃 1 件：營收 500；成本 = (1650 × 4 × 0.2 + 運費分攤 80) ÷ 4 = 350
  await expect(page.getByText("已實現營收", { exact: true }).first().locator("..")).toContainText("NT$500");
  await expect(page.getByText("銷貨成本", { exact: true }).first().locator("..")).toContainText("NT$350");
  await expect(page.getByText("已實現利潤", { exact: true }).first().locator("..")).toContainText("NT$150");
});

test("Excel 匯入：欄位配對、預覽、錯誤列號、建立", async ({ page }) => {
  await login(page);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["品名", "數量", "客人", "訂單號碼"],
      ["吉伊吊娃", 1, "小美", "X-1"],
      ["吉伊吊娃", "abc", "小美", "X-2"],
    ]),
    "工作表1",
  );
  const buf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
  await page.goto("/import");
  await page.locator("input[type=file]").setInputFiles({ name: "orders.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: buf });
  await expect(page.getByText("3. 確認欄位對應")).toBeVisible();
  await expect(page.getByLabel("商品名稱＊")).toHaveValue("0");
  await expect(page.getByLabel("買家姓名＊")).toHaveValue("2");
  await page.getByRole("button", { name: "4. 產生預覽" }).click();
  await expect(page.getByRole("heading", { name: "匯入預覽" })).toBeVisible();
  await expect(page.getByText("可建立 1", { exact: true })).toBeVisible();
  await expect(page.getByText("錯誤 1", { exact: true })).toBeVisible();
  const errRow = page.getByRole("row").filter({ hasText: "abc" });
  await expect(errRow.getByRole("cell").first()).toHaveText("3");
  await page.getByRole("button", { name: "建立訂單" }).click();
  await page.getByRole("button", { name: "確認建立" }).click();
  await expect(page.getByRole("heading", { name: "建立結果" })).toBeVisible();
  await page.getByRole("button", { name: "知道了" }).click();
  await page.goto("/orders?q=X-1");
  await expect(page.getByRole("cell", { name: /小美/ })).toHaveCount(1);
});

test("買家標籤提醒不會阻擋建單；匯出與備份需要登入且可下載", async ({ page }) => {
  await login(page);
  await page.goto("/buyers?q=阿婷");
  await page.getByRole("link", { name: "阿婷" }).click();
  await page.getByLabel("選擇標籤").selectOption({ label: "建議不接" });
  await page.getByLabel("原因").fill("上次棄單");
  await page.getByRole("button", { name: "加上標籤" }).click();
  await toast(page, "已加上標籤");
  await page.getByRole("link", { name: "新增訂單" }).click();
  await expect(page.getByText(/標籤提醒：建議不接/)).toBeVisible();
  await page.getByLabel("商品 1").click();
  await page.getByLabel("商品 1").fill("吉伊");
  await page.getByRole("button", { name: /吉伊吊娃/ }).first().click();
  await page.getByRole("button", { name: "建立訂單" }).click();
  await toast(page, /已建立訂單/);

  const exp = await page.request.get("/api/export/orders?format=csv");
  expect(exp.status()).toBe(200);
  expect(await exp.text()).toContain("阿婷");
  const bk = await page.request.get("/api/backup");
  expect(bk.status()).toBe(200);
  const json = await bk.json();
  expect(json.format).toBe("daigou-backup");
  expect(json.counts.order).toBeGreaterThanOrEqual(4);
});

test("資料重新整理後仍存在", async ({ page }) => {
  await login(page);
  await page.goto("/categories");
  await expect(page.getByRole("link", { name: "萬聖節", exact: true })).toBeVisible();
  await page.reload();
  const row = page.getByRole("row").filter({ hasText: "萬聖節" });
  await expect(row).toBeVisible();
});
