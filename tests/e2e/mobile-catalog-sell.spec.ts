// 手機：系列目錄（種類 › 系列 › 品項 › 角色、預設售價）→ 實體店買進 → 賣給客人（現貨＋預訂）→ 庫存選了才看
import { test, expect } from "@playwright/test";
import { login, toast, pickIp, newSupplierPick, openSeries, openMore, choose, chosen } from "./helpers";

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

  // 庫存：一打開不列，選好按查看才列；種類 › 系列 › 品項 › 角色
  await page.goto("/inventory?tab=stock");
  await expect(page.getByTestId("stock-row")).toHaveCount(0);
  await page.getByLabel("種類", { exact: true }).selectOption({ label: kind });
  await page.getByRole("button", { name: "查看" }).click();
  await expect(page).toHaveURL(/v=1/);
  await expect(page.getByTestId("stock-series").filter({ hasText: series })).toBeVisible();
  await expect(page.getByTestId("stock-type").first()).toHaveText("吊娃");
  // 現有、客人訂、剩下：小八沒貨但客人預訂 1 → 缺 1
  const hachiRow = page.locator(`[data-testid="stock-row"][data-name="${series}小八 吊娃"]`);
  await expect(hachiRow.locator('[data-k="onhand"]')).toHaveText("0");
  await expect(hachiRow.locator('[data-k="ordered"]')).toHaveText("1");
  await expect(hachiRow.locator('[data-k="free"]')).toHaveText("缺 1");
  await page.screenshot({ path: "test-results/mobile_stock_tree.png", fullPage: true });

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
