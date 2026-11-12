// 電腦版：新增採購「吊娃都是 N 元」——單價沒自己打的列都用它（含之後加的列）；自己打的不動
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast, pickIp, newSupplierPick, openSeries } from "./helpers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("新增採購：同一個價", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const sup = `統一價代購 ${tag}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await login(page);
    await page.goto("/purchase");
    const meBtn = page.getByRole("button", { name: /^我是/ }).first();
    if (await meBtn.isVisible()) await meBtn.click();
    await openSeries(page);
    await page.getByRole("button", { name: "＋ 新系列" }).click();
    await page.getByLabel(/新系列名稱/).fill(`E2E 統一價 ${tag}`);
    await page.getByRole("button", { name: "建立", exact: true }).click();
    await newSupplierPick(page, sup);
    await page.getByLabel("賣貨便運費").fill("0");
    await pickIp(page);
    await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
    await expect(page.getByTestId("same-price")).toContainText("吊娃都是");
    const grid = page.getByRole("table", { name: "批次新增採購品項" });
    const row = (n: number) => grid.getByRole("row").filter({ hasText: `第 ${n} 列` });

    await page.getByLabel("同一個單價").fill("833");
    await page.getByRole("button", { name: "＋ 吉伊" }).click();
    await page.getByRole("button", { name: "＋ 小八" }).click();
    // 跟著統一價的列：格子裡淡淡顯示這個價，直接打字就換成自己的
    await expect(row(1).getByLabel("單價")).toHaveAttribute("placeholder", "833");
    await expect(row(2).getByLabel("單價")).toHaveAttribute("placeholder", "833");
    await expect(row(1)).toContainText("NT$833");
    // 第 2 列自己打 835；改統一價不動它
    await row(2).getByLabel("單價").fill("835");
    await page.getByLabel("同一個單價").fill("900");
    await expect(row(1).getByLabel("單價")).toHaveAttribute("placeholder", "900");
    await expect(row(2).getByLabel("單價")).toHaveValue("835");
    // 之後加的列自動帶
    await page.getByRole("button", { name: "＋ 兔兔" }).click();
    await expect(row(3).getByLabel("單價")).toHaveAttribute("placeholder", "900");
    await page.screenshot({ path: "test-results/desktop_same_price.png", fullPage: true });

    await page.getByRole("button", { name: "儲存 3 項" }).click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: /^沒問題，儲存/ });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await toast(page, /已新增 3 個採購品項/);
    const b = await prisma.purchaseBatch.findFirstOrThrow({ where: { supplierRef: { name: sup } }, include: { items: { include: { product: { include: { characters: { include: { character: true } } } } } } } });
    expect(b.items.map((i) => `${i.product.characters[0]?.character.name}|${i.estUnitCost}`).sort()).toEqual(["兔兔|900", "吉伊|900", "小八|835"]);
  } finally {
    await prisma.$disconnect();
  }
});
