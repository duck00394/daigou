// 雙人經營責任紀錄（桌面）：改名 → 建團選負責人 → A 付訂金、B 付尾款 → A、B 分批收貨 → 經營者對帳
import { test, expect, type Page } from "@playwright/test";
import { login, toast } from "./helpers";

/** 改經營者名稱；名稱沒變（例如重複執行時）就不需要儲存 */
async function rename(page: Page, code: string, name: string) {
  await page.getByLabel(`經營者 ${code} 名稱`).fill(name);
  const save = page.getByRole("button", { name: `儲存經營者 ${code}` });
  if (await save.isVisible()) {
    await save.click();
    await toast(page, "已更新名稱");
    await expect(save).toBeHidden(); // 存好並重新整理後按鈕才會消失
  }
}

const cell = (page: Page, row: number, col: number) => page.locator(`[data-row="${row}"][data-col="${col}"]`).first();

test("桌面：A 下單、A 付訂金 B 付尾款、A B 分批收貨，對帳依人依幣別分開", async ({ page }) => {
  await login(page);
  // 1. 經營者改名
  await page.goto("/settings");
  await rename(page, "A", "阿珍");
  await rename(page, "B", "阿強");

  // 2. 建立採購團並選負責人
  await page.goto("/inventory/batches/new");
  await page.getByLabel("採購團名稱").fill("E2E 雙人團");
  await page.getByLabel("供應商").selectOption({ label: "日本官網" });
  await page.getByRole("radiogroup", { name: /這團是誰的/ }).getByRole("radio", { name: "阿珍" }).click();
  await page.getByRole("radiogroup", { name: /主要付款負責人/ }).getByRole("radio", { name: "阿珍" }).click();
  await page.getByRole("radiogroup", { name: /收貨負責人/ }).getByRole("radio", { name: "阿強" }).click();
  await page.getByRole("button", { name: "建立採購團" }).click();
  await expect(page.getByRole("heading", { name: /E2E 雙人團/ })).toBeVisible();
  await expect(page.getByTestId("resp-orderedById")).toHaveText("阿珍");
  await expect(page.getByTestId("resp-receivingResponsibleById")).toHaveText("阿強");
  const batchId = page.url().split("/inventory/batches/")[1].split("?")[0];

  // 3. 加入兩個品項
  await page.getByLabel("IP（例：吉伊卡哇）").selectOption({ label: "吉伊卡哇" });
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  await page.getByRole("button", { name: "＋ 小八" }).click();
  await cell(page, 0, 2).fill("1650");
  await cell(page, 0, 4).fill("3");
  await cell(page, 1, 2).fill("990");
  await cell(page, 1, 4).fill("2");
  await page.getByRole("button", { name: "儲存 2 項" }).click();
  await toast(page, /已新增 2 個採購品項/);

  // 4. A 付訂金（日幣、填實際匯率），B 付尾款（日幣、未填匯率）
  const payForm = () => page.getByRole("form", { name: "登記付款" });
  await page.getByRole("button", { name: "＋ 登記付款" }).click();
  await expect(payForm().getByRole("radio", { name: "阿珍" })).toHaveAttribute("aria-checked", "true"); // 預設為主要付款負責人
  await payForm().getByLabel("多少錢").fill("3000");
  if (!(await payForm().getByRole("radio", { name: "日幣" }).isVisible())) await payForm().locator("summary").click(); // 日幣收在「更多」
  await payForm().getByRole("radio", { name: "日幣" }).click();
  await payForm().getByRole("radio", { name: "訂金" }).click();
  await payForm().getByLabel("這筆實際匯率（選填）").fill("0.205");
  await payForm().getByRole("button", { name: "儲存付款" }).click();
  await toast(page, "已登記付款");

  await page.getByRole("button", { name: "＋ 登記付款" }).click();
  await payForm().getByRole("radio", { name: "阿強" }).click();
  await payForm().getByLabel("多少錢").fill("4930");
  if (!(await payForm().getByRole("radio", { name: "日幣" }).isVisible())) await payForm().locator("summary").click(); // 日幣收在「更多」
  await payForm().getByRole("radio", { name: "日幣" }).click();
  await payForm().getByRole("radio", { name: "尾款" }).click();
  await payForm().getByRole("button", { name: "儲存付款" }).click();
  await toast(page, "已登記付款");
  await expect(page.getByLabel("本團實際付款小計")).toContainText("阿珍 已付 ¥3,000");
  await expect(page.getByLabel("本團實際付款小計")).toContainText("阿強 已付 ¥4,930");

  // 修改一筆再看異動紀錄
  await page.locator("li", { hasText: "¥4,930" }).getByRole("button", { name: "修改" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("多少錢").fill("4950");
  await dlg.getByLabel("修改原因（會記錄在異動紀錄）").fill("手續費");
  await dlg.getByRole("button", { name: "儲存修改" }).click();
  await toast(page, /已修改/);
  await page.getByText("異動紀錄（2）").click();
  await expect(page.getByText(/金額 4930 → 4950/)).toBeVisible();

  // 5. A 先收吉伊 2 件（1 件瑕疵），B 再收剩下全部
  const rcvForm = () => page.getByRole("form", { name: "登記收貨" });
  await page.getByRole("button", { name: "＋ 登記這次收貨" }).click();
  await expect(rcvForm().getByRole("radio", { name: "阿強" })).toHaveAttribute("aria-checked", "true");
  await rcvForm().getByRole("radio", { name: "阿珍" }).click();
  await rcvForm().getByLabel("吉伊 吊娃 實收").fill("2");
  await rcvForm().getByLabel("吉伊 吊娃 瑕疵").fill("1");
  await rcvForm().getByLabel("吉伊 吊娃 備註").fill("耳朵脫線");
  await rcvForm().getByRole("button", { name: "儲存收貨" }).click();
  await toast(page, "良品 1 件已入庫");

  await page.getByRole("button", { name: "＋ 登記這次收貨" }).click();
  await rcvForm().getByRole("radio", { name: "阿強" }).click();
  await rcvForm().getByRole("button", { name: "全部到齊" }).click();
  await expect(rcvForm().getByLabel("吉伊 吊娃 實收")).toHaveValue("2");
  await rcvForm().getByRole("button", { name: "儲存收貨" }).click();
  await toast(page, "良品 4 件已入庫");
  await expect(page.getByRole("button", { name: "已全部到貨" })).toBeVisible();

  // 6. 經營者對帳（只看這一團，避免其他測試資料干擾）
  await page.goto(`/operators?batch=${batchId}`);
  await expect(page.getByTestId("paid-A-JPY")).toHaveText("¥3,000");
  await expect(page.getByTestId("paid-B-JPY")).toHaveText("¥4,950");
  const a = page.getByTestId("op-card-A");
  await expect(a).toContainText("依各筆實際匯率約 NT$615");
  await expect(a).toContainText("實收 2 件（瑕疵 1）");
  await expect(page.getByTestId("op-card-B")).toContainText("實收 4 件");
  await expect(page.getByText(/不是.*合夥人之間的成本分攤/)).toBeVisible();
  // 點進原始付款紀錄
  await page.getByTestId("paid-B-JPY").click();
  await expect(page.getByRole("heading", { name: /付款紀錄：阿強／日幣/ })).toBeVisible();
  await page.getByRole("link", { name: /E2E 雙人團/ }).first().click();
  await expect(page.getByRole("heading", { name: /E2E 雙人團/ })).toBeVisible();

  // 7. 改名後歷史仍屬同一人
  await page.goto("/settings");
  await rename(page, "A", "珍珍");
  await page.goto(`/operators?batch=${batchId}`);
  await expect(page.getByTestId("op-card-A")).toContainText("珍珍");
  await expect(page.getByTestId("paid-A-JPY")).toHaveText("¥3,000");

  // 8. 沿用負責人建立新團：必須確認，且不複製付款
  await page.goto(`/inventory/batches/new?from=${batchId}`); // 進階表單仍可沿用某一團的負責人
  await expect(page.getByRole("button", { name: "建立採購團" })).toBeDisabled();
  await page.getByLabel("採購團名稱").fill("E2E 雙人第二團");
  await page.getByLabel(/已確認負責人/).check();
  await page.getByRole("button", { name: "建立採購團" }).click();
  await expect(page.getByRole("heading", { name: /E2E 雙人第二團/ })).toBeVisible();
  await expect(page.getByTestId("resp-orderedById")).toHaveText("珍珍");
  await expect(page.getByText("還沒有付給供應商的款項")).toBeVisible();
});
