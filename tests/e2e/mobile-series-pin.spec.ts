// 手機：常用系列——排序頁打 1、2、3 自動跳到「常用」；新增採購選系列時最上面一排；清空常用
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast, openSeries } from "./helpers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：常用系列", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const names = [`常用醫生${tag}`, `常用本舖${tag}`, `常用市集${tag}`];
  try {
    await prisma.category.create({ data: { name: names[0], type: "GENERAL" } });
    await prisma.category.create({ data: { name: names[1], type: "CUSTOM", customType: `店舖${tag}` } });
    await prisma.category.create({ data: { name: names[2], type: "FESTIVAL" } });
  } finally {
    await prisma.$disconnect();
  }
  await login(page);
  await page.goto("/catalog?order=1");
  const box = page.getByTestId("pinned-box");
  await expect(box).toBeVisible();
  // 還沒選「我是誰」：在常用這裡就能選（常用是各自的）
  const meBtn = box.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) {
    await meBtn.click();
    await expect(box.getByRole("button", { name: /^我是/ })).toHaveCount(0);
  }
  // 先把以前留下的常用清掉
  const clear = box.getByRole("button", { name: "清空常用" });
  if (await clear.isVisible()) {
    await clear.click();
    await page.getByRole("dialog").getByRole("button", { name: "清空" }).click();
    await toast(page, "已清空常用");
  }
  for (const [i, n] of names.entries()) {
    const input = page.getByLabel(`${n} 常用順序`);
    await input.fill(String(i + 1));
    await input.press("Enter");
    await toast(page, `「${n}」放在常用第 ${i + 1}`);
  }
  const rows = box.getByTestId("pinned-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(names[0]);
  await expect(rows.nth(2)).toContainText(names[2]);
  // 打了數字的不再出現在下面的種類裡
  await expect(page.getByTestId("reorder-series").filter({ hasText: names[0] })).toHaveCount(0);
  // 在常用裡改號碼：市集改成 1 → 排到最前面
  const xm = box.getByLabel(`${names[2]} 常用順序`);
  await xm.fill("1");
  await xm.press("Enter");
  await toast(page, `「${names[2]}」放在常用第 1`);
  await expect(rows.nth(0)).toContainText(names[2]);
  await expect(rows.nth(1)).toContainText(names[0]);
  await page.screenshot({ path: "test-results/mobile_series_pin.png", fullPage: false });

  // 新增採購：常用一排，點一下就選好
  await page.goto("/purchase");
  await openSeries(page);
  const pins = page.getByTestId("pinned-series");
  await expect(pins.getByRole("button")).toHaveText([names[2], names[0], names[1]]);
  await pins.getByRole("button", { name: names[1] }).click();
  await expect(page.getByTestId("chosen-series")).toContainText(names[1]);

  // 清空
  await page.goto("/catalog?order=1");
  await box.getByRole("button", { name: "清空常用" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "清空" }).click();
  await toast(page, "已清空常用");
  await expect(rows).toHaveCount(0);
});
