// 手機：邊界與誤操作——負數、小數、0、連點兩次、重新整理後資料還在、按返回回到上一頁
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast, pickIp, newSupplierPick, openSeries } from "./helpers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：邊界值、連點、重新整理、返回", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const cat = `E2E 邊界 ${tag}`;
  await login(page);
  await page.goto("/purchase");
  const meBtn = page.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) await meBtn.click();
  await openSeries(page);
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  await page.getByLabel(/新系列名稱/).fill(cat);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByTestId("chosen-series")).toContainText(cat);
  await newSupplierPick(page, `邊界代購 ${tag}`);
  await pickIp(page);
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  // 點角色那一排可以直接「＋ 新角色」：只加在這個系列，加好就多一個角色按鈕、一列；再點一次拿掉
  await page.getByTestId("new-char-chip").click();
  await page.getByLabel("新角色名字").fill(`邊界角色${tag}`);
  await page.getByRole("button", { name: "加", exact: true }).click();
  const chip = page.getByRole("button", { name: `✓ 邊界角色${tag}` });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole("button", { name: `＋ 邊界角色${tag}` })).toBeVisible();
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  const r1 = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });
  const save = page.getByRole("button", { name: /^儲存 \d+ 項$/ });

  // 負數、小數、0：擋下來並說是哪個角色
  for (const [price, qty, msg] of [["-5", "1", "單價必須是不小於 0 的整數"], ["12.5", "1", "單價必須是不小於 0 的整數"], ["500", "0", "數量必須是正整數"], ["500", "1.5", "數量必須是正整數"]]) {
    await r1.getByLabel("單價").fill(price);
    await r1.getByLabel("數量").fill(qty);
    await save.click();
    await expect(r1.getByRole("alert")).toContainText(`吉伊：${msg}`);
  }
  // 正常值：連點兩次只新增一次
  await r1.getByLabel("單價").fill("500");
  await r1.getByLabel("數量").fill("2");
  await save.dblclick();
  await toast(page, /已新增 1 個採購品項/);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const batch = await prisma.purchaseBatch.findFirstOrThrow({ where: { supplierRef: { name: `邊界代購 ${tag}` } }, include: { items: true } });
    expect(batch.items.length).toBe(1);
    expect(batch.items[0].qty).toBe(2);

    // 團頁面：付清連點兩次只記一筆；重新整理後還在
    await page.goto(`/inventory/batches/${batch.id}`);
    await page.getByRole("button", { name: "付清" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /登記已付/ }).dblclick();
    await toast(page, /已登記付款/);
    await page.reload();
    await expect(page.getByTestId("batch-due")).toHaveText("NT$0");
    expect(await prisma.supplierPayment.count({ where: { batchId: batch.id, status: "PAID" } })).toBe(1);

    // 對單：付了多少填得比已付少 → 擋下來，資料不變
    await page.goto(`/reconcile/${batch.id}`);
    await page.getByLabel("總共付了多少").fill("100");
    await expect(page.getByTestId("reconcile-pay-note")).toContainText("要改少");
    await page.getByRole("button", { name: /^儲存|下一團|回對單清單/ }).click();
    await page.waitForTimeout(800);
    expect(await prisma.supplierPayment.count({ where: { batchId: batch.id, status: "PAID" } })).toBe(1);

    // 從團頁面點系列，再按返回：回到團頁面（不是首頁）
    await page.goto(`/inventory/batches/${batch.id}`);
    await page.getByRole("link", { name: cat }).first().click();
    await expect(page).toHaveURL(/\/categories\//);
    await page.getByTestId("back").click();
    await expect(page).toHaveURL(new RegExp(`/inventory/batches/${batch.id}`));
  } finally {
    await prisma.$disconnect();
  }
});
