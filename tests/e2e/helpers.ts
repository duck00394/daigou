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

/** 新增採購：在代購（或店家）下拉選單選「＋ 新代購…」並建立 */
export async function newSupplierPick(page: Page, name: string, store = false) {
  const sel = page.getByLabel(store ? "哪家店" : "向哪個代購買", { exact: true });
  await sel.selectOption("__new__");
  await page.getByLabel(store ? "店名" : "代購名稱", { exact: true }).fill(name);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(sel.locator("option:checked")).toHaveText(name);
}
