import { expect, type Page } from "@playwright/test";

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("密碼").fill("e2e-password-123");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL("/");
}

/** 等待提示訊息 */
export async function toast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

/** 新增採購／加商品：只有一個 IP 時不用選；有好幾個才選吉伊卡哇 */
export async function pickIp(page: Page) {
  await page.getByLabel("品項", { exact: true }).last().waitFor();
  const ip = page.getByLabel("IP（例：吉伊卡哇）");
  if (await ip.isVisible()) await ip.selectOption({ label: "吉伊卡哇" });
}

/** 新增採購：系列已經帶入（縮成一行）時，按「換」打開選單 */
export async function openSeries(page: Page) {
  const chosen = page.getByTestId("chosen-series");
  await page.getByRole("heading", { name: "1. 系列" }).waitFor();
  if (await chosen.isVisible()) await chosen.getByRole("button", { name: "換" }).click();
}

/** 新增採購：打開「更多」（實體店、到哪了、運費、訂金…） */
export async function openMore(page: Page) {
  const d = page.locator("details", { hasText: "更多：實體店買的" });
  if ((await d.getAttribute("open")) === null) await d.locator("summary").click();
}

/** 新增採購：打開代購（或店家）清單，按最下面的「＋ 新增」建立 */
export async function newSupplierPick(page: Page, name: string, store = false) {
  await page.getByRole("button", { name: store ? "哪家店" : "向哪個代購買", exact: true }).click();
  await page.getByTestId("supplier-panel").getByRole("button", { name: store ? "＋ 新增店家" : "＋ 新增代購", exact: true }).click();
  await page.getByLabel(store ? "店名" : "代購名稱", { exact: true }).fill(name);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByTestId("supplier-current")).toHaveText(name);
}

/** 新增採購：打開代購清單，打字找，按一下選好 */
export async function pickSupplier(page: Page, name: string) {
  await page.getByRole("button", { name: "向哪個代購買", exact: true }).click();
  await page.getByLabel("搜尋代購").fill(name);
  await page.getByTestId("supplier-panel").getByRole("option", { name, exact: true }).click();
  await expect(page.getByTestId("supplier-current")).toHaveText(name);
}

/** 系列列表：打字找系列，按一下進系列頁 */
export async function openSeriesPage(page: Page, name: string) {
  await page.goto("/categories");
  await page.getByLabel("找系列", { exact: true }).fill(name);
  await page.getByTestId("series-search-hits").getByTestId(`cat-card-${name}`).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
