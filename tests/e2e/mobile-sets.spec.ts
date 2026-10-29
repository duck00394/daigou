// 手機：新增採購時設定「一整套」，庫存頁的品項列顯示可湊幾套、多出哪幾隻
import { test, expect } from "@playwright/test";
import { login, toast, pickIp, newSupplierPick, openSeries } from "./helpers";

test("手機：一整套設定與庫存套數", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const cat = `E2E 套 ${tag}`;
  await login(page);
  await page.goto("/purchase");
  const meBtn = page.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) await meBtn.click();
  await openSeries(page);
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  await page.getByLabel(/新系列名稱/).fill(cat);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByTestId("chosen-series")).toContainText(cat);
  await pickIp(page);
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await expect(page.getByTestId("type-set")).toContainText("還沒設定");
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  await page.getByRole("button", { name: "＋ 小八" }).click();
  await page.getByTestId("type-set").getByRole("button", { name: "勾的 2 隻＝一整套" }).click();
  await toast(page, /一整套 2 隻/);
  await expect(page.getByTestId("type-set")).toContainText("吊娃一整套 2 隻");
  await expect(page.getByTestId("type-set")).toContainText("吉伊・小八");

  const grid = page.getByRole("table", { name: "批次新增採購品項" });
  for (const [n, q] of [["第 1 列", "3"], ["第 2 列", "2"]] as const) {
    const r = grid.getByRole("row").filter({ hasText: n });
    await r.getByLabel("單價").fill("500");
    await r.getByLabel("數量").fill(q);
  }
  await newSupplierPick(page, `套代購 ${tag}`);
  await page.getByRole("button", { name: "儲存 2 項" }).click();
  await toast(page, /已新增 2 個採購品項/);
  // 存好後這個系列的吊娃有了吉伊、小八 → 只列這兩隻，其他角色收起來
  const chips = page.getByTestId("char-chips");
  await expect(chips.getByRole("button", { name: "＋ 吉伊" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "＋ 小八" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "＋ 兔兔" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加入 吊娃 全部角色（2）" })).toBeVisible();
  await page.getByTestId("other-chars-toggle").click();
  await expect(page.getByTestId("other-chars").getByRole("button", { name: "＋ 兔兔" })).toBeVisible();
  await page.screenshot({ path: "test-results/mobile_item_chars.png" });
  // 換一個這個系列還沒設角色的品項：先列這個系列用到的角色（吉伊、小八），其他收起來，並提示去哪裡設
  const typeSel = page.getByLabel("品項", { exact: true });
  await typeSel.selectOption("__new__");
  await page.getByLabel("新品項名稱").fill(`E2E 品項 ${tag}`);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(typeSel).toHaveValue(/.+/);
  await expect(page.getByTestId("item-chars-hint")).toContainText("先列這個系列用到的角色");
  await expect(page.getByTestId("item-chars-hint").getByRole("link", { name: "到系列目錄設定 ›" })).toHaveAttribute("href", /\/catalog\?open=/);
  await expect(chips.getByRole("button", { name: "＋ 吉伊" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "＋ 兔兔" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/mobile_series_chars.png" });
  await typeSel.selectOption({ label: "吊娃" });
  await page.getByRole("link", { name: "看這一團" }).click();
  await expect(page).toHaveURL(/\/inventory\/batches\//);
  await page.goto(page.url().replace(/\/inventory\/batches\//, "/reconcile/").replace(/[?#].*$/, ""));
  await page.getByRole("button", { name: "這團全部買到" }).click();
  await page.getByRole("button", { name: /^儲存/ }).click();
  await toast(page, /這團對完了/);

  await page.goto("/categories");
  await page.getByLabel("找系列", { exact: true }).fill(cat);
  const href = await page.getByTestId("series-search-hits").getByTestId(`cat-card-${cat}`).getAttribute("href");
  const id = href!.split("/").pop()!.split("?")[0];
  await page.goto(`/inventory?tab=stock&v=1&cat=${id}`);
  await expect(page.getByTestId("stock-sets").first()).toHaveText("2 套，多 吉伊 1");
  await page.getByRole("table", { name: "庫存表" }).screenshot({ path: "test-results/mobile_stock_sets.png" });
});
