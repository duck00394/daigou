// 手機：系列目錄「＋ 角色」直接點 IP 的角色，不用一隻一隻打字
import { test, expect } from "@playwright/test";
import { login, toast } from "./helpers";

test("手機：系列目錄點選角色", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const series = `點選${tag}`;
  await login(page);
  await page.goto("/catalog");
  await page.getByLabel("種類", { exact: true }).selectOption({ label: "＋ 新種類…" });
  await page.getByLabel("新的種類叫什麼").fill(`點選種類${tag}`);
  await page.getByLabel(/系列名稱/).fill(series);
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await toast(page, `已新增系列「${series}」`);
  const card = page.getByTestId("catalog-series").filter({ hasText: series });
  await card.getByRole("button", { name: /＋ 加品項/ }).click();
  await card.getByLabel("新品項").selectOption({ label: "吊娃" });
  await card.getByRole("button", { name: "加入" }).click();
  await toast(page, "已加品項");
  const item = card.getByTestId("catalog-item").filter({ hasText: "吊娃" });

  await item.getByRole("button", { name: "＋ 角色" }).click();
  const box = item.getByTestId("add-chars");
  await expect(box).toContainText("的角色：點一下選");
  await box.getByRole("button", { name: "＋ 吉伊" }).click();
  await box.getByRole("button", { name: "＋ 小八" }).click();
  await expect(box.getByRole("button", { name: "✓ 小八" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/mobile_catalog_pick.png", fullPage: false });
  await box.getByRole("button", { name: "加入 2 隻" }).click();
  await toast(page, "已加 2 隻");
  await expect(item.getByRole("link", { name: "吉伊" })).toBeVisible();
  await expect(item.getByRole("link", { name: "小八" })).toBeVisible();
  await expect(box).toHaveCount(0);

  // 再開：已經有的不再列；全部加入
  await item.getByRole("button", { name: "＋ 角色" }).click();
  await expect(box.getByRole("button", { name: "＋ 吉伊" })).toHaveCount(0);
  await box.getByRole("button", { name: /^全部加入/ }).click();
  await toast(page, /已加 \d+ 隻/);
  await expect(item.getByRole("link", { name: "兔兔" })).toBeVisible();
});
