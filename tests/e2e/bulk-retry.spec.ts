// 電腦版：第二輪驗收 B1～B4
// B1：送出後伺服器已經存好、但瀏覽器沒收到回應（網路斷掉）→ 使用者再加一列（換另一個品項）重送 → 已存的不會重複、新的照常新增
// B2：參考單價照「那一列的品項＋角色」；換角色時不會留著別的角色的參考價
// B3：存範本只存現在選的品項；兩份範本互不混；套用範本後品項、角色正確
// B4：切回原本的品項再加一列，會排進原本那一組
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast, pickIp, newSupplierPick, pickSupplier, openSeries } from "./helpers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

async function itemsOf(prisma: PrismaClient, supplier: string) {
  const b = await prisma.purchaseBatch.findMany({ where: { supplierRef: { name: supplier } }, include: { items: { include: { product: { include: { productType: true, characters: { include: { character: true } } } } } } } });
  return b.flatMap((x) => x.items.map((i) => `${i.product.productType?.name}|${i.product.characters[0]?.character.name}|${i.qty}|${i.estUnitCost}`)).sort();
}

test("批次採購：斷線重送不重複、參考價、範本、分組", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const cat = `E2E 重送 ${tag}`;
  const sup = `重送代購 ${tag}`;
  const sType = `S娃 ${tag}`;
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
    await newSupplierPick(page, sup);
    await page.getByLabel("賣貨便運費").fill("0");
    await pickIp(page);
    const typeSel = page.getByLabel("品項", { exact: true });
    const grid = page.getByRole("table", { name: "批次新增採購品項" });
    const row = (n: number) => grid.getByRole("row").filter({ hasText: `第 ${n} 列` });

    // ── B1：吊娃 吉伊、小八 → 送出，伺服器存好但回應被切斷 ──
    await typeSel.selectOption({ label: "吊娃" });
    await page.getByRole("button", { name: "＋ 吉伊" }).click();
    await page.getByRole("button", { name: "＋ 小八" }).click();
    await row(1).getByLabel("單價").fill("650");
    await row(2).getByLabel("單價").fill("600");
    let cut = 0;
    await page.route("**/purchase", async (route) => {
      const req = route.request();
      if (cut === 0 && req.method() === "POST" && (req.postData() ?? "").includes("submissionKey")) {
        cut++;
        await route.fetch(); // 真的送到伺服器、寫進資料庫
        return route.abort("failed"); // 但瀏覽器收不到回應
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "儲存 2 項" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "網路或伺服器沒有回應" }).first()).toBeVisible();
    await page.unroute("**/purchase");
    expect(cut).toBe(1);
    expect(await itemsOf(prisma, sup)).toEqual(["吊娃|吉伊|1|650", "吊娃|小八|1|600"]); // 伺服器其實存好了
    await expect(row(1).getByLabel("單價")).toHaveValue("650"); // 畫面上的列還在

    // 使用者以為沒存到：換另一個品項再加一列，重按儲存
    await typeSel.selectOption("__new__");
    await page.getByLabel("新品項名稱").fill(sType);
    await page.getByRole("button", { name: "建立", exact: true }).click();
    await page.getByRole("button", { name: "＋ 吉伊" }).click();
    await row(3).getByLabel("單價").fill("380");
    await expect(page.getByTestId("type-group")).toHaveCount(2);
    await page.getByRole("button", { name: "儲存 3 項" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^沒問題，儲存 3 項/ }).click();
    await toast(page, "已新增 1 個採購品項（2 列先前已建立）");
    expect(await itemsOf(prisma, sup)).toEqual([`${sType}|吉伊|1|380`, "吊娃|吉伊|1|650", "吊娃|小八|1|600"]); // 沒有重複

    // ── B2：再開一團，參考價照「品項＋角色」 ──
    await page.getByTestId("saved-banner").getByRole("button", { name: "再開新的一團" }).click();
    await pickSupplier(page, sup);
    await typeSel.selectOption({ label: sType });
    await page.getByRole("button", { name: "＋ 吉伊" }).click();
    await expect(row(1).getByLabel("單價")).toHaveValue("380"); // S 娃的吉伊
    await typeSel.selectOption({ label: "吊娃" });
    await page.getByRole("button", { name: "＋ 吉伊" }).click();
    await page.getByRole("button", { name: "＋ 小八" }).click();
    await expect(row(2).getByLabel("單價")).toHaveValue("650"); // 吊娃的吉伊
    await expect(row(3).getByLabel("單價")).toHaveValue("600"); // 吊娃的小八
    // S 娃那列換成小八：S 娃小八沒買過 → 單價清空，不能留著吉伊的 380、也不能帶吊娃小八的 600
    await row(1).getByLabel("角色／款式").selectOption({ label: "小八" });
    await expect(row(1).getByLabel("單價")).toHaveValue("");
    await expect(row(2).getByLabel("單價")).toHaveValue("650"); // 別列不動
    await expect(row(3).getByLabel("單價")).toHaveValue("600");
    // 自己打過的單價，換角色不會被清掉
    await row(1).getByLabel("單價").fill("399");
    await row(1).getByLabel("角色／款式").selectOption({ label: "吉伊" });
    await expect(row(1).getByLabel("單價")).toHaveValue("399");
    await row(1).getByLabel("角色／款式").selectOption({ label: "小八" });

    // ── B3：範本只存現在的品項 ──
    const tplBox = page.locator("details", { hasText: "常買同一組角色？存成範本" });
    await tplBox.locator("summary").click();
    await page.getByPlaceholder("範本名稱，例：三本柱").fill(`吊娃範本${tag}`);
    await page.getByRole("button", { name: "儲存範本" }).click();
    await toast(page, `已儲存範本「吊娃範本${tag}」`);
    await typeSel.selectOption({ label: sType });
    await page.getByPlaceholder("範本名稱，例：三本柱").fill(`S娃範本${tag}`);
    await page.getByRole("button", { name: "儲存範本" }).click();
    await toast(page, `已儲存範本「S娃範本${tag}」`);
    const tpls = await prisma.seriesTemplate.findMany({ where: { name: { in: [`吊娃範本${tag}`, `S娃範本${tag}`] } } });
    const typeName = async (id: string | null) => (id ? (await prisma.productType.findUnique({ where: { id } }))?.name : null);
    const names = async (ids: { characterId: string }[]) => (await prisma.character.findMany({ where: { id: { in: ids.map((x) => x.characterId) } } })).map((c) => c.name).sort();
    const tD = tpls.find((t) => t.name.startsWith("吊娃"))!;
    const tS = tpls.find((t) => t.name.startsWith("S娃"))!;
    expect([await typeName(tD.productTypeId), await names(tD.items as { characterId: string }[])]).toEqual(["吊娃", ["吉伊", "小八"]]);
    expect([await typeName(tS.productTypeId), await names(tS.items as { characterId: string }[])]).toEqual([sType, ["小八"]]);

    // 清空後套用吊娃範本：品項切回吊娃、兩隻角色都在吊娃那組
    await page.getByRole("button", { name: "清空" }).click();
    await page.getByLabel("套用系列範本").selectOption({ label: `吊娃範本${tag}（2）` });
    await expect(typeSel).toHaveValue(tD.productTypeId!);
    await expect(row(1).getByLabel("角色／款式")).toHaveValue(/.+/);
    await expect(row(2).getByLabel("角色／款式")).toHaveValue(/.+/);
    await expect(page.getByTestId("type-group")).toHaveCount(0); // 只有一個品項，不分組

    // ── B4：切到 S 娃加一列，再切回吊娃「新增一列」→ 排進吊娃那組 ──
    await typeSel.selectOption({ label: sType });
    await page.getByRole("button", { name: "＋ 吉伊" }).click();
    await typeSel.selectOption({ label: "吊娃" });
    await page.getByRole("button", { name: "新增一列" }).click();
    await row(4).getByLabel("單價").fill("777");
    const groups = page.getByTestId("type-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toContainText("吊娃");
    await expect(groups.nth(0)).toContainText("3 列");
    await expect(row(3).getByLabel("單價")).toHaveValue("777"); // 排到吊娃最後，S 娃那列往後
    await expect(groups.nth(1)).toContainText(sType);
    await page.screenshot({ path: "test-results/desktop_bulk_groups.png", fullPage: true });
    await page.getByRole("button", { name: "清空" }).click();
  } finally {
    await prisma.$disconnect();
  }
});

test("批次採購：送出後沒收到結果、重新整理 → 帶回草稿前提醒「可能已經存好」並給那一團的連結", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const sup = `重整代購 ${tag}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await login(page);
    await page.goto("/purchase");
    const meBtn = page.getByRole("button", { name: /^我是/ }).first();
    if (await meBtn.isVisible()) await meBtn.click();
    await openSeries(page);
    await page.getByRole("button", { name: "＋ 新系列" }).click();
    await page.getByLabel(/新系列名稱/).fill(`E2E 重整 ${tag}`);
    await page.getByRole("button", { name: "建立", exact: true }).click();
    await newSupplierPick(page, sup);
    // 報表測試看的是整月的賺多少：這裡不收運費，免得影響別的測試
    await page.getByLabel("賣貨便運費").fill("0");
    await pickIp(page);
    await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
    await page.getByRole("button", { name: "＋ 吉伊" }).click();
    const r1 = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });
    await r1.getByLabel("單價").fill("650");
    let cut = 0;
    await page.route("**/purchase", async (route) => {
      const req = route.request();
      if (cut === 0 && req.method() === "POST" && (req.postData() ?? "").includes("submissionKey")) {
        cut++;
        await route.fetch();
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "儲存 1 項" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "網路或伺服器沒有回應" }).first()).toBeVisible();
    await page.unroute("**/purchase");
    const batch = await prisma.purchaseBatch.findFirstOrThrow({ where: { supplierRef: { name: sup } }, include: { items: true } });
    expect(batch.items).toHaveLength(1); // 其實已經存好了
    await page.waitForTimeout(600); // 草稿存好
    await page.reload();
    const banner = page.getByTestId("bulk-draft");
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId("bulk-draft-sent")).toContainText("可能已經存好了");
    await expect(banner.getByRole("link", { name: "看那一團" })).toHaveAttribute("href", `/inventory/batches/${batch.id}`);
    await banner.getByRole("button", { name: "不要了" }).click();
    await expect(banner).toHaveCount(0);
  } finally {
    await prisma.$disconnect();
  }
});
