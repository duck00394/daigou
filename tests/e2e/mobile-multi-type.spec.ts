// 手機：同一團一次買吊娃＋另一個品項，表格照品項分組；儲存列直接填已付，確認清單分組，存好後付款一起記好
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast, pickIp, newSupplierPick, openSeries } from "./helpers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：一次買兩個品項＋已付", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const cat = `E2E 多品項 ${tag}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
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
    const typeSel = page.getByLabel("品項", { exact: true });
    const grid = page.getByRole("table", { name: "批次新增採購品項" });
    const row = (n: number) => grid.getByRole("row").filter({ hasText: `第 ${n} 列` });

    // 吊娃：吉伊、小八
    await typeSel.selectOption({ label: "吊娃" });
    await page.getByRole("button", { name: "＋ 吉伊" }).click();
    await page.getByRole("button", { name: "＋ 小八" }).click();
    await row(1).getByLabel("單價").fill("650");
    await row(1).getByLabel("數量").fill("2");
    await row(2).getByLabel("單價").fill("650");
    // 換一個品項：吉伊（同一隻角色在不同品項可以各一列）
    await typeSel.selectOption("__new__");
    await page.getByLabel("新品項名稱").fill(`S娃 ${tag}`);
    await page.getByRole("button", { name: "建立", exact: true }).click();
    await expect(page.getByRole("button", { name: "＋ 吉伊" })).toHaveAttribute("aria-pressed", "false"); // ✓ 只看現在的品項
    await page.getByRole("button", { name: "＋ 吉伊" }).click();
    await row(3).getByLabel("單價").fill("380");
    const groups = page.getByTestId("type-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toContainText("吊娃");
    await expect(groups.nth(0)).toContainText("2 列・3 件");
    await expect(groups.nth(1)).toContainText(`S娃 ${tag}`);
    await page.screenshot({ path: "test-results/mobile_multi_type.png", fullPage: true });

    await newSupplierPick(page, `多品項代購 ${tag}`);
    // 總額＝650×3＋380＋運費 38＝2,368；已付打太多會提醒
    await page.getByLabel("已付多少").fill("9999");
    await expect(page.getByTestId("overpaid")).toBeVisible();
    await page.getByLabel("已付多少").fill("2368");
    await expect(page.getByTestId("overpaid")).toHaveCount(0);
    await page.getByRole("button", { name: "儲存 3 項" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByTestId("confirm-group")).toHaveCount(2);
    await expect(dlg.getByTestId("confirm-pay")).toContainText("NT$2,368");
    await expect(dlg.getByTestId("confirm-pay")).toContainText("會記成這團的付款");
    await dlg.getByRole("button", { name: /^沒問題，儲存 3 項/ }).click();
    await toast(page, /已新增 3 個採購品項/);

    const batch = await prisma.purchaseBatch.findFirstOrThrow({ where: { supplierRef: { name: `多品項代購 ${tag}` } }, include: { items: { include: { product: { include: { productType: true } } } }, supplierPayments: true } });
    expect(batch.items.map((i) => i.product.productType?.name).sort()).toEqual(["S娃 " + tag, "吊娃", "吊娃"].sort());
    expect(batch.supplierPayments.filter((p) => !p.voidedAt).map((p) => p.amount)).toEqual([2368]);
  } finally {
    await prisma.$disconnect();
  }
});
