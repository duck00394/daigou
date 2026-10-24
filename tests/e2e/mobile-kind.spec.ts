// 手機：系列頁的種類可以改名、刪除；點開種類直接排裡面系列的順序
import { test, expect, type Page } from "@playwright/test";
import { login, toast, choose } from "./helpers";

async function newSeries(page: Page, name: string, kind: string, first: boolean) {
  await page.goto("/categories");
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("名稱", { exact: true }).fill(name);
  if (first) {
    await choose(dlg, "類型", "＋ 自訂…");
    await dlg.getByLabel("自訂類型叫什麼").fill(kind);
  } else await choose(dlg, "類型", kind);
  await dlg.getByRole("button", { name: "新增" }).click();
  await expect(page).toHaveURL(/\/categories\/./); // 建好會進到系列頁
}

test("手機：種類改名、排順序、刪除", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const kind = `K${tag}`;
  await login(page);
  await page.goto("/categories");
  await newSeries(page, `甲${tag}`, kind, true);
  await newSeries(page, `乙${tag}`, kind, false);
  await page.goto("/categories");

  const group = (label: string) => page.getByTestId("series-kind").filter({ has: page.locator("summary", { hasText: label }) });
  await group(kind).locator("summary").click();
  // 排順序：乙移到最上面
  await group(kind).getByRole("button", { name: "排順序" }).click();
  const rows = group(kind).getByTestId("sort-row");
  await expect(rows).toHaveCount(2);
  const second = await rows.nth(1).getAttribute("data-name");
  await group(kind).getByRole("button", { name: `${second} 上移` }).click();
  await expect(rows.first()).toHaveAttribute("data-name", second!);
  await group(kind).screenshot({ path: "test-results/mobile_kind_sort.png" });
  await group(kind).getByRole("button", { name: "排好了" }).click();

  // 改名稱
  await group(kind).getByRole("button", { name: "改名稱" }).click();
  await page.getByRole("dialog").getByLabel("種類名稱").fill(`${kind}新`);
  await page.getByRole("dialog").getByRole("button", { name: "儲存" }).click();
  await toast(page, "已改名");
  await expect(group(`${kind}新`)).toHaveCount(1);

  // 刪除：系列移到一般分類
  await group(`${kind}新`).locator("summary").click();
  await group(`${kind}新`).getByRole("button", { name: "刪除" }).click();
  const dlg = page.getByRole("dialog");
  await choose(dlg, /要怎麼辦/, /一般分類/);
  await dlg.getByRole("button", { name: "刪除種類" }).click();
  await toast(page, "已刪除種類");
  await expect(group(`${kind}新`)).toHaveCount(0);
  await expect(page.getByTestId("series-kind").filter({ has: page.locator("summary", { hasText: "一般" }) }).getByTestId(`cat-card-甲${tag}`)).toHaveCount(1);
});
