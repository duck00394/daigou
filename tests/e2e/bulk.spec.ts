// 批次新增系列商品（桌面版）：建立採購團 → 點選角色 → 表格填價格數量 → 貼上多格 → 確認新增 → 批次修改 → 刪除
import { test, expect, type Page } from "@playwright/test";
import { login, toast } from "./helpers";

// 本檔的測試依序共用資料（後一個測試使用前一個建立的商品、訂單），明確宣告為依序執行
test.describe.configure({ mode: "serial" });

const cell = (page: Page, row: number, col: number) => page.locator(`[data-row="${row}"][data-col="${col}"]`).first();

async function newBatch(page: Page, name: string) {
  await page.goto("/inventory/batches/new");
  await page.getByLabel("採購團名稱").fill(name);
  await page.getByLabel("供應商").selectOption({ label: "日本官網" });
  await page.getByRole("button", { name: "建立採購團" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
}

/** 讀取某商品目前的實際在庫與待到貨（商品還不存在時為 0），讓斷言只看本測試造成的變化 */
async function stockOf(page: Page, name: string) {
  await page.goto(`/inventory?tab=stock&only=all&q=${encodeURIComponent(name)}`);
  const row = page.getByRole("row").filter({ hasText: name });
  if ((await row.count()) === 0) return { onHand: 0, incoming: 0 };
  const cell = async (i: number) => Number((await row.first().getByRole("cell").nth(i).textContent())?.trim() ?? 0);
  return { onHand: await cell(1), incoming: await cell(5) };
}

test("桌面：批次新增 4 個角色（含新角色與貼上），再批次修改與刪除", async ({ page }) => {
  await login(page);
  const before = await stockOf(page, "吉伊卡哇 吉伊 吊娃");
  await newBatch(page, "E2E 批次團");
  await page.getByLabel("IP／系列").selectOption({ label: "吉伊卡哇" });
  await page.getByLabel("商品類型").selectOption({ label: "吊娃" });
  for (const n of ["吉伊", "小八", "兔兔"]) await page.getByRole("button", { name: `＋ ${n}` }).click();
  await expect(page.locator('[data-row="2"][data-col="0"]').first()).toHaveValue(/.+/);

  // 逐格輸入：單價與數量；Enter 移到下一列
  await cell(page, 0, 2).fill("350");
  await cell(page, 0, 4).fill("3");
  await cell(page, 1, 2).fill("350");
  await cell(page, 1, 4).fill("2");
  await cell(page, 1, 4).press("Enter");
  await expect(cell(page, 2, 4)).toBeFocused();
  // 從試算表貼上兩欄（單價、幣別）與數量
  await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('[data-row="2"][data-col="2"]')!;
    const dt = new DataTransfer();
    dt.setData("text/plain", "420\tTWD\t4\n");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(cell(page, 2, 2)).toHaveValue("420");
  await expect(cell(page, 2, 4)).toHaveValue("4");

  // 新角色
  await page.getByRole("button", { name: "新增一列" }).click();
  await cell(page, 3, 0).selectOption("__new__");
  await page.getByLabel("新角色名稱").fill("栗子饅頭");
  await cell(page, 3, 2).fill("380");
  await cell(page, 3, 4).fill("1");
  // 空白列不算
  await page.getByRole("button", { name: "新增一列" }).click();
  // 不合法數量會提示
  await cell(page, 4, 0).selectOption({ label: "吉伊" });
  await cell(page, 4, 1).fill("萬聖節款");
  await cell(page, 4, 2).fill("400");
  await cell(page, 4, 4).fill("-1");
  await expect(page.getByText("數量必須是正整數")).toBeVisible();
  await page.getByRole("button", { name: "刪除第 5 列" }).click();

  await expect(page.getByText(/有效 4 列｜共 10 件/)).toBeVisible();
  await page.getByRole("button", { name: "批次新增 4 列" }).click();
  await expect(page.getByRole("heading", { name: "確認批次新增" })).toBeVisible();
  await expect(page.getByText("（新角色）")).toBeVisible();
  await page.getByRole("button", { name: "確認新增 4 列" }).click();
  await expect(page.getByRole("heading", { name: "批次新增結果" })).toBeVisible();
  await expect(page.getByText(/已新增：吉伊卡哇 兔兔 吊娃/)).toBeVisible();
  await page.getByRole("button", { name: "知道了" }).click();

  // 採購品項表格（按「編輯」才會出現可修改的表格）
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  const table = page.getByRole("table", { name: "採購品項", exact: true });
  await expect(table.getByRole("row")).toHaveCount(5); // 表頭 + 4
  await expect(table).toContainText("吉伊卡哇 栗子饅頭 吊娃");

  // 批次修改：吉伊數量 3 → 5、小八單價 350 → 360
  const rowOf = (name: string) => table.getByRole("row").filter({ hasText: name });
  await rowOf("吉伊卡哇 吉伊 吊娃").getByLabel("數量").fill("5");
  await rowOf("吉伊卡哇 小八 吊娃").getByLabel("預估單價").fill("360");
  await page.getByRole("button", { name: "儲存修改" }).click();
  await toast(page, "已儲存 2 列");
  await page.reload();
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  await expect(rowOf("吉伊卡哇 吉伊 吊娃").getByLabel("數量")).toHaveValue("5");
  await expect(rowOf("吉伊卡哇 小八 吊娃").getByLabel("預估單價")).toHaveValue("360");

  // 刪除一列
  await rowOf("吉伊卡哇 栗子饅頭 吊娃").getByRole("button", { name: "刪除" }).click();
  await page.getByRole("button", { name: "刪除品項" }).click();
  await toast(page, "已刪除品項");
  await expect(table.getByRole("row")).toHaveCount(4);

  // 批次新增不會增加庫存，只增加待到貨（吉伊數量已改成 5）
  const after = await stockOf(page, "吉伊卡哇 吉伊 吊娃");
  expect(after).toEqual({ onHand: before.onHand, incoming: before.incoming + 5 });
});

test("桌面：第二團套用上次使用的角色，價格帶入上次設定且可獨立修改", async ({ page }) => {
  await login(page);
  await newBatch(page, "E2E 第二團");
  await page.getByLabel("IP／系列").selectOption({ label: "吉伊卡哇" });
  await page.getByRole("button", { name: "套用上次使用的角色" }).click();
  await expect(cell(page, 2, 0)).not.toHaveValue("");
  // 小八帶入上次（已修改後）的 360，兔兔 420
  await expect(cell(page, 1, 2)).toHaveValue("360");
  await expect(cell(page, 2, 2)).toHaveValue("420");
  await cell(page, 0, 2).fill("390");
  for (const r of [0, 1, 2]) await cell(page, r, 4).fill("1");
  await page.getByRole("button", { name: "批次新增 3 列" }).click();
  await page.getByRole("button", { name: "確認新增 3 列" }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  // 回到第一團確認價格沒變
  await page.goto("/inventory?tab=batches");
  await page.getByRole("link", { name: /E2E 批次團/ }).first().click(); // 清單依建立時間由新到舊
  await expect(page.getByRole("list", { name: "品項清單" }).getByRole("listitem").filter({ hasText: "吉伊卡哇 吉伊 吊娃" })).toContainText("NT$350 ×");
});
