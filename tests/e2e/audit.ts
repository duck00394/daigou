// 全頁巡檢：每一頁實際打開，檢查伺服器錯誤、前端錯誤、整頁橫向捲動，並截圖留存
import { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";
import { login } from "./helpers";
import { seedStock } from "./seed";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

const STATIC = [
  "/", "/purchase", "/sell", "/rush", "/rush/new", "/rush/notify", "/categories", "/inventory?tab=batches", "/inventory?tab=stock&v=1", "/inventory?tab=stock&only=all&v=1",
  "/inventory?tab=demand", "/inventory?tab=batches&pay=due", "/inventory?tab=batches&late=1", "/inventory?tab=batches&settle=1", "/reconcile", "/reconcile?open=refund", "/sales", "/sales?ym=all", "/help",
  "/paste", "/orders", "/orders/new", "/payments", "/shipping", "/shipping?tab=done", "/buyers", "/buyers/new", "/groupbuys", "/import",
  "/catalog", "/catalog?order=1", "/products", "/products/new", "/series", "/suppliers", "/reports", "/tags", "/settings", "/operators", "/search?q=吉伊", "/inventory/batches/new",
];

async function dynamicRoutes() {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [b, jb, p, buyer, cat, order, series, rush] = await Promise.all([
      prisma.purchaseBatch.findFirst({ where: { items: { some: {} } }, orderBy: { createdAt: "desc" }, select: { id: true } }),
      prisma.purchaseBatch.findFirst({ where: { ownership: "JOINT" }, select: { id: true } }),
      prisma.product.findFirst({ select: { id: true } }),
      prisma.buyer.findFirst({ select: { id: true } }),
      prisma.category.findFirst({ select: { id: true } }),
      prisma.order.findFirst({ select: { id: true } }),
      prisma.series.findFirst({ select: { id: true } }),
      prisma.rushEvent.findFirst({ select: { id: true } }),
    ]);
    return [
      b && `/inventory/batches/${b.id}`, jb && `/inventory/batches/${jb.id}`, b && `/reconcile/${b.id}`, p && `/products/${p.id}`, buyer && `/buyers/${buyer.id}`, buyer && `/shipping/pack?buyerId=${buyer.id}`,
      cat && `/categories/${cat.id}`, cat && `/categories/${cat.id}?tab=batches`, cat && `/categories/${cat.id}?tab=catalog`, order && `/orders/${order.id}`, series && `/series/${series.id}`,
      rush && `/rush/${rush.id}`, rush && `/rush/${rush.id}/edit`,
    ].filter((x): x is string => !!x);
  } finally {
    await prisma.$disconnect();
  }
}

export async function crawl(page: Page, tag: string) {
  await seedStock(`巡檢商品 ${tag}`, 3, 400, 600); // 至少有一點資料
  await login(page);
  const routes = [...STATIC, ...(await dynamicRoutes())];
  const problems: string[] = [];
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of 404/.test(m.text())) errs.push(`console: ${m.text().slice(0, 200)}`);
  });
  // 打開頁面時不能在背景跑匯出或備份（以前「匯出」按鈕會被預先載入）
  page.on("request", (q) => {
    if (/\/api\/(export|backup)/.test(q.url())) errs.push(`背景請求: ${q.url().replace(/^https?:\/\/[^/]+/, "")}`);
  });
  const rows: string[] = [];
  for (const r of routes) {
    errs.length = 0;
    const t0 = Date.now();
    const res = await page.goto(r, { waitUntil: "load", timeout: 60_000 }).catch((e) => { errs.push(`goto: ${String(e).slice(0, 120)}`); return null; });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const ms = Date.now() - t0;
    const status = res?.status() ?? 0;
    const body = (await page.locator("body").innerText()).slice(0, 4000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const appErr = /Application error|Internal Server Error|發生錯誤|Unhandled Runtime Error/.test(body);
    const file = r.replace(/[/?=&]/g, "_").replace(/^_/, "") || "home";
    await page.screenshot({ path: `${process.env.AUDIT_DIR ?? "test-results/audit"}/${tag}-${file}.png`, fullPage: true });
    const bad = !res || status >= 400 || appErr || overflow > 1 || errs.length > 0;
    rows.push(`${bad ? "✗" : "✓"} ${r} status=${status} ${ms}ms overflow=${overflow}${errs.length ? " " + errs.join(" | ") : ""}${appErr ? " APP-ERROR" : ""}`);
    if (bad) problems.push(rows[rows.length - 1]);
    console.log(rows[rows.length - 1]);
  }
  console.log(`\n[巡檢 ${tag}] ${routes.length} 頁\n${rows.join("\n")}`);
  expect(problems, problems.join("\n")).toEqual([]);
}
