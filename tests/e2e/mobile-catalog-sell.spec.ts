// 手機：系列目錄（種類 › 系列 › 品項 › 角色、預設售價）→ 實體店買進 → 賣給客人（現貨＋預訂）→ 庫存選了才看
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast, pickIp, newSupplierPick, openSeries, openMore, choose, chosen } from "./helpers";

const dbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：系列目錄、賣給客人、庫存階層", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const kind = `常設E2E${tag}`;
  const series = `肉包${tag}`;
  await login(page);

  // 系列目錄：新種類＋新系列，加品項（預設售價）和角色
  await page.goto("/catalog");
  await page.getByLabel("種類", { exact: true }).selectOption({ label: "＋ 新種類…" });
  await page.getByLabel("新的種類叫什麼").fill(kind);
  await page.getByLabel(/系列名稱/).fill(series);
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await toast(page, `已新增系列「${series}」`);
  const card = page.getByTestId("catalog-series").filter({ hasText: series });
  await card.getByRole("button", { name: /＋ 加品項/ }).click();
  await card.getByLabel("新品項").selectOption({ label: "吊娃" });
  await card.getByLabel("預設售價").fill("650");
  await card.getByRole("button", { name: "加入" }).click();
  await toast(page, "已加品項");
  const item = card.getByTestId("catalog-item").filter({ hasText: "吊娃" });
  for (const ch of ["吉伊", "小八"]) {
    if (!(await item.getByLabel("角色名字").isVisible())) await item.getByRole("button", { name: "＋ 角色" }).click();
    await item.getByLabel("角色名字").fill(ch);
    await item.getByRole("button", { name: "加", exact: true }).click();
    await toast(page, `已加「${ch}」`);
  }
  await expect(item.getByRole("link", { name: "吉伊" })).toBeVisible();
  // 加錯的角色：按 × 刪掉
  if (!(await item.getByLabel("角色名字").isVisible())) await item.getByRole("button", { name: "＋ 角色" }).click();
  await item.getByLabel("角色名字").fill("加錯的");
  await item.getByRole("button", { name: "加", exact: true }).click();
  await toast(page, "已加「加錯的」");
  await item.getByRole("button", { name: "刪除「加錯的」" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "刪除", exact: true }).click();
  await toast(page, "已刪除「加錯的」");
  await expect(item.getByRole("link", { name: "加錯的" })).toHaveCount(0);
  // 加錯的角色：按 × 刪掉
  if (!(await item.getByLabel("角色名字").isVisible())) await item.getByRole("button", { name: "＋ 角色" }).click();
  await item.getByLabel("角色名字").fill("加錯的");
  await item.getByRole("button", { name: "加", exact: true }).click();
  await toast(page, "已加「加錯的」");
  await item.getByRole("button", { name: "刪除「加錯的」" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "刪除", exact: true }).click();
  await toast(page, "已刪除「加錯的」");
  await expect(item.getByRole("link", { name: "加錯的" })).toHaveCount(0);
  // 第二個系列（之後同一團一起買）
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  await page.getByLabel(/系列名稱/).fill(`幽靈${tag}`);
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await toast(page, `已新增系列「幽靈${tag}」`);
  // 種類、系列改名：按 ✎ 就能改
  await page.getByRole("button", { name: "✎ 改名" }).click();
  await page.getByLabel("種類新名稱").fill(`${kind}店`);
  await page.getByRole("button", { name: "存", exact: true }).click();
  await toast(page, `種類改成「${kind}店」`);
  await expect(page.getByLabel("種類", { exact: true }).locator("option:checked")).toHaveText(`${kind}店`);
  await page.getByRole("button", { name: "✎ 改名" }).click();
  await page.getByLabel("種類新名稱").fill(kind);
  await page.getByRole("button", { name: "存", exact: true }).click();
  await toast(page, `種類改成「${kind}」`);
  // 金額欄：一點就清空，沒打就恢復原本的
  const price = item.getByLabel("吊娃 預設售價");
  await price.focus();
  await expect(price).toHaveValue("");
  await price.blur();
  await expect(price).toHaveValue("650");
  await page.screenshot({ path: "test-results/mobile_catalog.png", fullPage: true });

  // 實體店買 2 個吉伊（選種類 › 系列）
  await page.goto("/purchase");
  const meBtn = page.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) await meBtn.click();
  await openSeries(page);
  await page.getByLabel("種類", { exact: true }).selectOption({ label: kind });
  await page.getByLabel("系列", { exact: true }).selectOption({ label: series });
  await expect(chosen(page, "哪一團")).toHaveText("開新的一團");
  await openMore(page);
  await choose(page, "在哪裡買的", "實體店買");
  await newSupplierPick(page, `常設店 ${tag}`, true);
  await pickIp(page);
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  const r1 = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });
  await r1.getByLabel("單價").fill("400");
  await r1.getByLabel("數量").fill("2");
  await page.getByRole("button", { name: "儲存 1 項" }).click();
  await expect(page.getByTestId("saved-banner")).toContainText("已進庫存");
  // 同一團再加另一個系列：換系列就好，運費、付款還是同一團
  await page.getByTestId("saved-banner").getByRole("link", { name: "看這一團" }).click();
  await page.getByRole("button", { name: "＋ 加商品" }).click();
  await page.getByRole("button", { name: "換系列" }).click();
  await page.getByLabel("這批商品的系列", { exact: true }).selectOption({ label: `幽靈${tag}` });
  await expect(page.getByTestId("items-series-name")).toHaveText(`幽靈${tag}`);
  await pickIp(page);
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  const r2 = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });
  await r2.getByLabel("單價").fill("300");
  await r2.getByLabel("數量").fill("1");
  await page.getByRole("button", { name: "儲存 1 項" }).click();
  await toast(page, /已新增 1 個採購品項/);
  const dlg = page.getByRole("dialog");
  if (await dlg.isVisible()) await dlg.getByRole("button", { name: /知道了|關閉/ }).first().click();
  await expect(page.getByTestId("items-series")).toHaveText([series, `幽靈${tag}`]);
  await page.screenshot({ path: "test-results/mobile_multi_series.png", fullPage: true });

  // 賣給客人：吉伊 1（現貨）、小八 1（沒貨→預訂），單價帶預設 650
  await page.goto("/sell");
  // 跟著「現在看誰的」：不用選，只提醒是誰的訂單
  await expect(page.getByTestId("seller")).toContainText("這是");
  await expect(page.getByTestId("seller")).toContainText("的訂單");
  await page.getByLabel("種類", { exact: true }).selectOption({ label: kind });
  await page.getByLabel("系列", { exact: true }).selectOption({ label: series });
  const chii = page.locator(`[data-testid="sell-row"][data-name="${series}:吊娃:吉伊"]`);
  await expect(chii.getByLabel("吉伊 單價")).toHaveValue("650");
  await chii.getByLabel("吉伊 數量").fill("1");
  const hachi = page.locator(`[data-testid="sell-row"][data-name="${series}:吊娃:小八"]`);
  await hachi.getByLabel("小八 數量").fill("1");
  await expect(chii).toContainText("現貨 1");
  await expect(hachi).toContainText("預訂 1");
  // 同一位客人再加一個系列（幽靈）
  await page.getByLabel("系列", { exact: true }).selectOption({ label: `幽靈${tag}` });
  // 上次用過的系列可能會先帶出來；只看這個測試建的兩個系列
  await expect(page.locator(`[data-testid="sell-sheet"][data-name="${series}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-testid="sell-sheet"][data-name="幽靈${tag}"]`)).toHaveCount(1);
  const ghost = page.locator(`[data-testid="sell-row"][data-name="幽靈${tag}:吊娃:吉伊"]`);
  await ghost.getByLabel("吉伊 數量").fill("1");
  await ghost.getByLabel("吉伊 單價").fill("300");
  await choose(page, "販售平台", "賣貨便");
  await page.getByLabel("客人", { exact: true }).fill(`小美${tag}`);
  await page.screenshot({ path: "test-results/mobile_sell.png", fullPage: true });
  await page.getByRole("button", { name: /登記：3 件 NT\$1,600（現貨 2・預訂 1）/ }).click();
  // 送出前有確認表：看得到每一項、合計；按「確認送出」才送
  await expect(page.getByTestId("sell-confirm")).toContainText(`小美${tag}`);
  await expect(page.getByTestId("sell-confirm-total")).toHaveText("NT$1,600");
  await page.screenshot({ path: "test-results/mobile_sell_confirm.png" });
  await page.getByRole("button", { name: "確認送出" }).click();
  await expect(page.getByTestId("sell-done")).toContainText("賣出 2 件、預訂 1 件");
  await expect(page.getByTestId("sell-done")).toContainText(`賣貨便・小美${tag}`);
  // 平台記住了；賺多少看得到是哪個平台賣的，也可以用平台搜尋
  await expect(page.getByLabel("販售平台", { exact: true }).locator("option:checked")).toHaveText("賣貨便");
  await page.goto(`/sales?ym=all&q=小美${tag}`);
  await expect(page.getByTestId("sale-row").first()).toContainText(`賣貨便・小美${tag}`);
  // 以前的客人：到買家基本資料改平台，以前的單一起改
  await page.goto(`/buyers?q=${encodeURIComponent(`小美${tag}`)}`);
  await page.getByRole("link", { name: `小美${tag}` }).first().click();
  await expect(page.getByTestId("buyer-channel")).toHaveText("賣貨便");
  await page.getByRole("link", { name: "基本資料" }).click();
  await choose(page, "販售平台", "蝦皮");
  await expect(page.getByLabel(/以前的單也一起改/)).toBeChecked();
  await page.getByRole("button", { name: "儲存買家" }).click();
  await toast(page, "已儲存買家");
  await expect(page.getByTestId("buyer-channel")).toHaveText("蝦皮");
  await page.goto(`/sales?ym=all&q=小美${tag}`);
  await expect(page.getByTestId("sale-row").first()).toContainText(`蝦皮・小美${tag}`);
  await page.goto("/sell");
  await expect(page.locator("main")).toContainText("客人預訂還沒給");
  // 賺多少：客人預訂預估可賺，看得到每位客人
  await page.goto("/sales");
  const pre = page.getByTestId("preorder-card");
  await expect(pre).toBeVisible();
  await pre.getByText("看每位客人").click();
  await expect(pre.getByTestId("pre-buyers").locator(`[data-name="小美${tag}"]`)).toContainText("1 件");
  // 依系列看：這個系列有一列，合計等於上面的預估可賺
  await pre.getByText("依系列看").click();
  await expect(pre.getByTestId("pre-series").locator(`tr[data-name="${series}"]`)).toContainText("1 件");
  await expect(pre.getByTestId("pre-series-total")).toHaveText((await pre.getByTestId("pre-profit").textContent()) ?? "");
  await pre.screenshot({ path: "test-results/mobile_pre_series.png" });

  // 庫存：一打開不列，選好按查看才列；種類 › 系列 › 品項 › 角色
  await page.goto("/inventory?tab=stock");
  await expect(page.getByTestId("stock-row")).toHaveCount(0);
  await page.getByLabel("種類", { exact: true }).selectOption({ label: kind });
  await page.getByRole("button", { name: "查看" }).click();
  await expect(page).toHaveURL(/v=1/);
  await expect(page.getByTestId("stock-series").filter({ hasText: series })).toBeVisible();
  await expect(page.getByTestId("stock-type").first()).toHaveText(/^吊娃/);
  // 庫存＝現有＋一定到 − 客人訂：小八沒貨但客人預訂 1 → -1（不寫「缺」）
  const hachiRow = page.locator(`[data-testid="stock-row"][data-name="${series}小八 吊娃"]`);
  await expect(hachiRow.locator('[data-k="onhand"]')).toHaveText("0");
  await expect(hachiRow.locator('[data-k="ordered"]')).toHaveText("1");
  await expect(hachiRow.locator('[data-k="free"]')).toHaveText("-1");
  await page.screenshot({ path: "test-results/mobile_stock_tree.png", fullPage: true });
  // 首頁待辦「客人訂的比庫存多」→ 點進去只列庫存是負的
  const stockUrl = page.url();
  await page.goto("/");
  const shortTodo = page.getByTestId("home-todo").getByRole("link", { name: /項商品客人訂的比庫存多/ });
  await expect(shortTodo).toBeVisible();
  await shortTodo.click();
  await expect(page).toHaveURL(/only=short/);
  await expect(page.getByTestId("stock-short-note")).toBeVisible();
  await expect(hachiRow.locator('[data-k="free"]')).toHaveText("-1");
  for (const v of await page.locator('[data-testid="stock-row"] [data-k="free"]').allTextContents()) expect(Number(v)).toBeLessThan(0);
  await page.goto(stockUrl);

  // 客人訂：點數字只看到自己的；「不是我的」→ 再確認一次才改 → 改給別人後，自己這邊就不顯示
  await hachiRow.getByTestId("demand-open").click();
  const drow = page.getByRole("dialog").locator(`[data-testid="demand-row"][data-buyer="小美${tag}"]`);
  await expect(drow).toContainText("× 1");
  await expect(drow).not.toHaveAttribute("data-owner", ""); // 賣給客人時預設記成「現在看誰的」那個人
  await page.screenshot({ path: "test-results/mobile_demand.png" });
  await drow.getByRole("button", { name: "不是我的" }).click();
  await expect(page.getByTestId("demand-confirm")).toContainText(`小美${tag}`);
  await page.getByRole("button", { name: "確定改" }).click();
  await toast(page, /改成跟.+訂的/);
  await page.reload();
  // 小八沒有自己的貨、也沒有自己的預訂了 → 不列出來（別人的預訂不顯示）
  await expect(hachiRow).toHaveCount(0);
  await expect(page.locator(`[data-testid="stock-row"][data-name="${series}吉伊 吊娃"]`)).toBeVisible();

  // 訂單：沒開接單也在選單裡；多選一次改代購團
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const gbName = `E2E 代購團 ${tag}`;
  try {
    await prisma.groupBuy.create({ data: { code: `E2E-GB-${tag}`, name: gbName, status: "OPEN" } });
  } finally {
    await prisma.$disconnect();
  }
  await page.goto(`/orders?q=${encodeURIComponent(`小美${tag}`)}`);
  await page.getByRole("checkbox", { name: "全選本頁" }).check();
  await page.getByLabel("選好的改成哪個代購團").selectOption({ label: gbName });
  await page.getByRole("button", { name: "改代購團" }).click();
  await toast(page, new RegExp(`張訂單改成「${gbName}」`));
  await expect(page.locator("tbody")).toContainText(gbName);

  // 賣給客人：運費預設 0，要收再填；確認表的合計含運費
  await page.goto("/sell");
  await page.getByLabel("種類", { exact: true }).selectOption({ label: kind });
  await page.getByLabel("系列", { exact: true }).selectOption({ label: series });
  await page.locator(`[data-testid="sell-row"][data-name="${series}:吊娃:小八"]`).getByLabel("小八 數量").fill("1");
  await page.getByLabel("客人", { exact: true }).fill(`小美${tag}`);
  await choose(page, "代購團（選填）", gbName);
  await expect(page.getByLabel("運費", { exact: true })).toHaveValue("0"); // 賣東西不預設運費
  await page.getByLabel("運費", { exact: true }).fill("50");
  await page.getByRole("button", { name: /^登記：/ }).click();
  await expect(page.getByTestId("sell-confirm")).toContainText("運費");
  await expect(page.getByTestId("sell-confirm-total")).toHaveText("NT$700");
  await page.getByRole("button", { name: "返回修改" }).click();
  await expect(page.getByTestId("sell-confirm")).toHaveCount(0);

  // 已過期：不在下拉選單，用搜尋找得到
  await page.goto("/catalog");
  await page.getByLabel("種類", { exact: true }).selectOption({ label: kind });
  const c2 = page.getByTestId("catalog-series").filter({ hasText: series });
  if (!(await c2.getByLabel("已過期").isVisible())) await c2.getByRole("button", { name: new RegExp(`^${series}`) }).click();
  await c2.getByLabel("已過期").check();
  await toast(page, "設成已過期");
  await page.goto("/sell");
  await expect(page.getByLabel("系列", { exact: true }).locator("option", { hasText: series })).toHaveCount(0);
  await page.getByLabel("找系列", { exact: true }).fill(series);
  await page.getByRole("button", { name: new RegExp(series) }).click();
  await expect(page.locator(`[data-testid="sell-sheet"][data-name="${series}"]`)).toBeVisible();
});
