// 稽核：用固定亂數種子跑一連串真實操作（開團、對單、收貨、賣出／預訂、自留、作廢、取消預訂、改跟誰訂），
// 每一步之後都做健康檢查，並核對：庫存不為負、看每個人的「庫存」加起來跟全部一致、沒有非預期的系統錯誤。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx, BizError } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { sellToCustomer } from "@/server/services/sell";
import { keepStock, inventorySummary } from "@/server/services/inventory";
import { saveReconcile } from "@/server/services/reconcile";
import { voidQuickSale } from "@/server/services/quick-sale";
import { cancelOrder } from "@/server/services/orders";
import { setDemandOwner, openDemandRows } from "@/server/services/demand-owner";
import { createShipment } from "@/server/services/shipping";
import { stockLeft, shortProducts } from "@/server/services/stock-left";

const OPS = ["op_a", "op_b"];
let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

async function runScenario(seed: number, steps: number) {
  const r = rng(seed);
  const pick = <T,>(l: T[]) => l[Math.floor(r() * l.length)];
  const products = [s.p1.id, s.p2.id];
  const log: string[] = [];
  let k = 0;
  for (let i = 0; i < steps; i++) {
    const op = pick(["buy", "buy", "reconcile", "receive", "receive", "sell", "sell", "keep", "void", "cancel", "owner", "ship", "ship"]);
    const who = pick(OPS);
    const key = `fz${seed}-${k++}`;
    try {
      if (op === "buy") {
        const b = await tx((t) => createBatch(t, actor, { name: `團${key}`, supplier: "代購", orderedById: who }));
        for (const p of products) if (r() < 0.8) await tx((t) => addBatchItem(t, actor, b.id, { productId: p, qty: 1 + Math.floor(r() * 4), unitCost: 100 + Math.floor(r() * 500), currency: "TWD" }));
      } else if (op === "reconcile") {
        const b = await prisma.purchaseBatch.findFirst({ where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, skip: Math.floor(r() * 3), include: { items: true } });
        if (!b || !b.items.length) continue;
        const rows = b.items.map((it) => ({ itemId: it.id, bought: Math.floor(r() * (it.qty - it.cancelledQty + 1)), cutRest: r() < 0.4 }));
        await tx((t) => saveReconcile(t, actor, b.id, { rows, reason: "AGENT_CANCEL" }));
      } else if (op === "receive") {
        const open = await prisma.purchaseBatch.findMany({ where: { status: { in: ["ORDERED", "PARTIAL_RECEIVED", "DRAFT"] } }, orderBy: { createdAt: "asc" }, include: { items: { include: { movements: { where: { kind: "RECEIVE" } } } } } });
        if (!open.length) continue;
        const b = pick(open);
        const lines = b.items
          .map((it) => ({ it, left: it.qty - it.cancelledQty - it.movements.reduce((a, m) => a + m.onHandDelta, 0) }))
          .filter((x) => x.left > 0)
          .map((x) => ({ batchItemId: x.it.id, receivedQty: 1 + Math.floor(r() * x.left) }));
        if (!lines.length) continue;
        await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: who, lines, dedupeKey: key }));
      } else if (op === "sell") {
        await tx((t) => sellToCustomer(t, actor, { buyerName: pick(["小美", "阿婷", "小王"]), owner: r() < 0.8 ? who : null, lines: [{ productId: pick(products), qty: 1 + Math.floor(r() * 3), unitPrice: 500 }], idemKey: `${key}-sell` }));
      } else if (op === "keep") {
        await tx((t) => keepStock(t, actor, { productId: pick(products), delta: r() < 0.7 ? 1 : -1, owner: who, dedupeKey: `${key}-keep` }));
      } else if (op === "void") {
        const o = await prisma.order.findFirst({ where: { source: "QUICK", confirmation: "CONFIRMED" }, orderBy: { createdAt: "desc" } });
        if (!o) continue;
        await tx((t) => voidQuickSale(t, actor, o.id, "稽核作廢"));
      } else if (op === "cancel") {
        const o = await prisma.order.findFirst({ where: { confirmation: "CONFIRMED", source: { not: "QUICK" } }, orderBy: { createdAt: "asc" } });
        if (!o) continue;
        await tx((t) => cancelOrder(t, actor, { orderId: o.id, reason: "稽核取消" }));
      } else if (op === "ship") {
        // 出貨：挑一筆還沒給的預訂，出 1 件（保留不夠就自動從可用庫存保留），扣誰的貨隨機
        const rows = (await openDemandRows(prisma, products)).get(pick(products)) ?? [];
        if (!rows.length) continue;
        const d = pick(rows);
        const it = await prisma.orderItem.findUniqueOrThrow({ where: { id: d.id }, select: { order: { select: { buyerId: true } } } });
        await tx((t) => createShipment(t, actor, { buyerId: it.order.buyerId, items: [{ orderItemId: d.id, qty: 1 }], autoReserve: true, dedupeKey: `${key}-ship`, owner: r() < 0.5 ? null : pick([...OPS, "joint"]) }));
      } else if (op === "owner") {
        const rows = (await openDemandRows(prisma, products)).get(pick(products)) ?? [];
        if (!rows.length) continue;
        await tx((t) => setDemandOwner(t, actor, pick(rows).id, pick([...OPS, "joint", null])));
      }
      log.push(`${i}:${op}:ok`);
    } catch (e) {
      if (e instanceof BizError) {
        log.push(`${i}:${op}:biz:${e.message}`);
        continue;
      }
      throw new Error(`種子 ${seed} 第 ${i} 步 ${op} 發生非預期錯誤：${(e as Error).message}\n${log.slice(-8).join("\n")}`);
    }
    const issues = await checkIntegrity(prisma);
    if (issues.length) throw new Error(`種子 ${seed} 第 ${i} 步 ${op} 之後健康檢查有問題：${JSON.stringify(issues.slice(0, 3))}\n${log.slice(-8).join("\n")}`);
  }
  // 結尾核對：庫存不為負；首頁「客人訂的比庫存多」跟庫存頁「庫存」欄一致
  const inv = await tx((t) => inventorySummary(t, products));
  for (const p of products) {
    const v = inv.get(p)!;
    expect(v.onHand).toBeGreaterThanOrEqual(0);
    expect(v.kept).toBeGreaterThanOrEqual(0);
    expect(v.available).toBeGreaterThanOrEqual(0);
  }
  const all = await tx((t) => stockLeft(t, products, null));
  const short = await tx((t) => shortProducts(t, null));
  for (const p of products) {
    const left = all.byProduct.get(p)!.left;
    expect(short.find((x) => x.productId === p)?.short ?? 0).toBe(left < 0 ? -left : 0);
  }
  return log;
}

describe("稽核：隨機操作流程", () => {
  // FUZZ_SEEDS=多少個種子、FUZZ_STEPS=每個幾步（平常跑 5 個種子 × 60 步）
  const seeds = process.env.FUZZ_SEEDS ? Array.from({ length: Number(process.env.FUZZ_SEEDS) }, (_, i) => 1000 + i) : [1, 7, 42, 2026, 31337];
  const steps = Number(process.env.FUZZ_STEPS ?? 60);
  for (const seed of seeds) {
    it(`種子 ${seed}：${steps} 步之後資料仍一致`, async () => {
      const log = await runScenario(seed, steps);
      if (process.env.FUZZ_LOG) console.log("BIZ", [...new Set(log.filter((x) => x.includes(":biz:")).map((x) => x.split(":").slice(1).join(":")))].join(" | "));
      if (process.env.FUZZ_LOG) console.log(seed, Object.entries(log.reduce<Record<string, number>>((a, x) => ((a[x.split(":").slice(1, 3).join(":")] = (a[x.split(":").slice(1, 3).join(":")] ?? 0) + 1), a), {})).map(([k, v]) => `${k}=${v}`).join(" "));
      expect(log.filter((x) => x.endsWith(":ok")).length).toBeGreaterThan(10);
    }, 600_000);
  }
});
