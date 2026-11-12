// 手機：設定販售平台抽成（KOCA 2%）
import { test, expect } from "@playwright/test";
import { login, toast } from "./helpers";

test("手機：販售平台抽成設定", async ({ page }) => {
  const name = `KOCA${Date.now().toString(36).slice(-4)}`;
  await login(page);
  await page.goto("/settings");
  const box = page.getByTestId("platform-fees");
  await box.getByLabel("新平台名稱").fill(name);
  await box.getByRole("button", { name: "加" }).click();
  await toast(page, `已加 ${name}（先填 1%，再改成實際的）`);
  const pct = box.getByLabel(`${name} 抽幾 %`);
  await expect(pct).toHaveValue("1");
  await pct.fill("2");
  await pct.press("Enter");
  await toast(page, `${name} 抽 2%`);
  await page.reload();
  await expect(page.getByTestId("platform-fees").getByLabel(`${name} 抽幾 %`)).toHaveValue("2");
  // 清空＝不抽
  await page.waitForLoadState("networkidle"); // 重新整理後等畫面接好再打字
  const p2 = page.getByTestId("platform-fees").getByLabel(`${name} 抽幾 %`);
  await p2.fill("");
  await p2.press("Enter");
  await toast(page, `${name} 不抽`);
  await expect(page.getByTestId("platform-fees").getByLabel(`${name} 抽幾 %`)).toHaveValue("0"); // 留在清單裡
});
