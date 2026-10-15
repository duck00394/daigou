// 建立匯入預覽（只寫入暫存區，不建立正式訂單）
import { createHash } from "node:crypto";
import { BizError, prisma } from "@/server/db";
import { normalizeKey } from "@/lib/normalize";
import { parseLineMessage } from "@/lib/parser/line";
import { autoMap, cellText, FIELDS, listSheets, missingRequired, parseDateCell, parseIntCell, readWorkbook, sheetMatrix, type Mapping } from "@/lib/parser/excel";
import { loadLexicon, parseHintsFromLexicon, matchBuyer } from "@/server/services/matching";
import type { Actor } from "@/server/services/common";
import { hashOf, initialResolution, revalidateBatch } from "./engine";
import type { RowParsed } from "./types";
import type { Prisma } from "@prisma/client";

const MAX_LINE_TEXT = 50_000;

export async function stageLine(actor: Actor, input: { text: string; groupBuyId?: string | null; idempotencyKey: string; replaceBatchId?: string | null }) {
  const text = input.text ?? "";
  if (!text.trim()) throw new BizError("請貼上訊息內容");
  if (text.length > MAX_LINE_TEXT) throw new BizError("內容太長，請分批貼上（上限 5 萬字）");
  const existing = await prisma.importBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing; // 連點兩次只會建立一個預覽批次

  const lex = await loadLexicon(prisma);
  const entries = parseLineMessage(text, parseHintsFromLexicon(lex));
  const rows: Prisma.ImportRowCreateManyBatchInput[] = [];
  for (const e of entries) {
    const items = e.items.length > 0 ? e.items : [null];
    items.forEach((it, seq) => {
      const parsed: RowParsed = {
        buyerText: e.buyerText,
        productText: it?.text ?? null,
        qty: it?.qty ?? null,
        qtyText: it ? String(it.qty) : null,
        append: e.append,
        qtyMissing: it?.qtyMissing ?? false,
        vague: it?.vague ?? false,
        parseIssues: e.issues,
      };
      const { resolution, candidates } = initialResolution(lex, parsed, { groupBuyId: input.groupBuyId ?? null });
      rows.push({
        rowNo: e.lineNo,
        seq,
        raw: { text: e.raw, lineNo: e.lineNo, lineEnd: e.lineEnd },
        parsed: { ...parsed, candidates } as unknown as Prisma.InputJsonValue,
        resolution: resolution as unknown as Prisma.InputJsonValue,
        status: "PENDING_REVIEW",
        rowHash: hashOf("LINE", normalizeKey(e.buyerText ?? ""), normalizeKey(it?.text ?? ""), it?.qty ?? null),
      });
    });
  }
  if (rows.length === 0) throw new BizError("沒有辨識到任何內容");

  const batch = await prisma.$transaction(async (t) => {
    if (input.replaceBatchId) {
      const old = await t.importBatch.findUnique({ where: { id: input.replaceBatchId } });
      if (old && old.status === "DRAFT") await t.importBatch.update({ where: { id: old.id }, data: { status: "DISCARDED" } });
    }
    return t.importBatch.create({
      data: {
        kind: "LINE",
        rawText: text,
        groupBuyId: input.groupBuyId ?? null,
        idempotencyKey: input.idempotencyKey,
        createdById: actor.userId,
        rows: { createMany: { data: rows } },
      },
    });
  });
  await revalidateBatch(prisma, batch.id);
  return batch;
}

/** 讀取檔案的工作表與表頭（不寫入資料庫） */
export function inspectWorkbook(fileName: string, buf: Uint8Array) {
  const wb = readWorkbook(fileName, buf);
  const sheets = listSheets(wb);
  return sheets.map((s) => ({ ...s, mapping: autoMap(s.headers), missing: missingRequired(autoMap(s.headers)) }));
}

export async function stageExcel(
  actor: Actor,
  input: { fileName: string; buf: Uint8Array; sheetName: string; mapping: Mapping; groupBuyId?: string | null; idempotencyKey: string },
) {
  const existing = await prisma.importBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  const missing = missingRequired(input.mapping);
  if (missing.length) throw new BizError(`缺少必要欄位：${missing.join("、")}`);
  const wb = readWorkbook(input.fileName, input.buf);
  const sheet = listSheets(wb).find((s) => s.name === input.sheetName);
  if (!sheet) throw new BizError(`找不到工作表「${input.sheetName}」`);
  const matrix = sheetMatrix(wb, input.sheetName);
  const fileHash = createHash("sha256").update(input.buf).digest("hex");

  const lex = await loadLexicon(prisma);
  const [groupBuys, categories] = await Promise.all([prisma.groupBuy.findMany(), prisma.category.findMany()]);
  const get = (row: unknown[], k: keyof Mapping) => (input.mapping[k] === undefined ? null : (row[input.mapping[k]!] ?? null));

  const rows: Prisma.ImportRowCreateManyBatchInput[] = [];
  for (let i = sheet.headerRowIndex + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    if (!row.some((c) => cellText(c) !== "")) continue;
    const excelRowNo = i + 1; // Excel 列號（1 起算）
    const issues: string[] = [];
    const qty = parseIntCell(get(row, "qty"));
    const unitPrice = parseIntCell(get(row, "unitPrice"));
    const subtotal = parseIntCell(get(row, "subtotal"));
    const paid = parseIntCell(get(row, "paidAmount"));
    const ship = parseIntCell(get(row, "shippingFee"));
    if (Number.isNaN(unitPrice.value)) issues.push(`單價「${unitPrice.text}」不是有效的整數金額`);
    if (Number.isNaN(subtotal.value)) issues.push(`小計「${subtotal.text}」不是有效的整數金額`);
    if (Number.isNaN(ship.value)) issues.push(`運費「${ship.text}」不是有效的整數金額`);
    const rawDate = get(row, "orderDate");
    const orderDate = parseDateCell(rawDate);
    if (cellText(rawDate) && !orderDate) issues.push(`日期「${cellText(rawDate)}」無法辨識`);
    const payText = cellText(get(row, "paymentStatus"));
    let paidAmount = paid.value !== null && !Number.isNaN(paid.value) ? paid.value : null;
    if (Number.isNaN(paid.value)) issues.push(`已付金額「${paid.text}」不是有效的整數金額`);

    const parsed: RowParsed = {
      buyerText: cellText(get(row, "buyerName")) || null,
      lineNameText: cellText(get(row, "lineName")) || null,
      productText: cellText(get(row, "productName")) || null,
      specText: cellText(get(row, "spec")) || null,
      qty: qty.value === null || Number.isNaN(qty.value) ? null : qty.value,
      qtyText: qty.text,
      unitPrice: unitPrice.value === null || Number.isNaN(unitPrice.value) ? null : unitPrice.value,
      subtotal: subtotal.value === null || Number.isNaN(subtotal.value) ? null : subtotal.value,
      externalRef: cellText(get(row, "externalRef")) || null,
      orderDate,
      paidAmount: null,
      paymentStatusText: payText || null,
      shipStatusText: cellText(get(row, "shipStatus")) || null,
      groupBuyText: cellText(get(row, "groupBuy")) || null,
      categoryText: cellText(get(row, "category")) || null,
      shippingFee: ship.value === null || Number.isNaN(ship.value) ? null : ship.value,
      notes: cellText(get(row, "notes")) || null,
      parseIssues: issues,
    };
    if (!parsed.buyerText && parsed.lineNameText) parsed.buyerText = parsed.lineNameText;
    const { resolution, candidates } = initialResolution(lex, parsed, { groupBuyId: input.groupBuyId ?? null });
    // 付款狀態文字為「已付款」且沒有已付金額欄時，視為付清（在建立時以小計計算）
    if (paidAmount === null && /^(已付|已付款|已收|已匯|付清|yes|y|v|✓|是)$/i.test(payText) && resolution.qty && (resolution.unitPrice ?? null) !== null) {
      paidAmount = resolution.unitPrice! * resolution.qty;
    }
    resolution.paidAmount = paidAmount;
    if (parsed.groupBuyText) {
      const k = normalizeKey(parsed.groupBuyText);
      const gb = groupBuys.find((g) => normalizeKey(g.name) === k || normalizeKey(g.code) === k);
      if (gb) resolution.groupBuyId = gb.id;
      else issues.push(`找不到代購團「${parsed.groupBuyText}」，已改用預設`);
    }
    if (parsed.categoryText) {
      const k = normalizeKey(parsed.categoryText);
      const c = categories.find((x) => normalizeKey(x.name) === k);
      if (c) resolution.categoryId = c.id;
      else issues.push(`找不到分類「${parsed.categoryText}」，銷售歸屬將自動判斷`);
    }
    // 買家 LINE 暱稱補充比對
    if (!resolution.buyerId && parsed.lineNameText) {
      const m = matchBuyer(lex, parsed.lineNameText);
      if (m.status === "exact") resolution.buyerId = m.match.id;
    }
    rows.push({
      rowNo: excelRowNo,
      seq: 0,
      raw: { cells: Object.fromEntries(sheet.headers.map((h, idx) => [h, cellText(row[idx] ?? null)])) },
      parsed: { ...parsed, candidates } as unknown as Prisma.InputJsonValue,
      resolution: resolution as unknown as Prisma.InputJsonValue,
      status: "PENDING_REVIEW",
      rowHash: hashOf("EXCEL", ...row.map((c) => normalizeKey(cellText(c)))),
    });
  }
  if (rows.length === 0) throw new BizError("工作表沒有資料列");

  const fieldLabels = Object.fromEntries(FIELDS.map((f) => [f.key, input.mapping[f.key] === undefined ? null : sheet.headers[input.mapping[f.key]!]]));
  const batch = await prisma.importBatch.create({
    data: {
      kind: "EXCEL",
      fileName: input.fileName,
      fileHash,
      sheetName: input.sheetName,
      mapping: fieldLabels as Prisma.InputJsonValue,
      groupBuyId: input.groupBuyId ?? null,
      idempotencyKey: input.idempotencyKey,
      createdById: actor.userId,
      rows: { createMany: { data: rows } },
    },
  });
  await revalidateBatch(prisma, batch.id);
  return batch;
}

/** 同一份檔案是否曾經匯入（不論成功與否） */
export async function previousImportsOfFile(fileHash: string, excludeId?: string) {
  return prisma.importBatch.findMany({
    where: { fileHash, id: excludeId ? { not: excludeId } : undefined, status: { in: ["COMMITTED", "PARTIAL"] } },
    select: { id: true, createdAt: true, status: true, fileName: true },
    orderBy: { createdAt: "desc" },
  });
}

/** 新增商品或買家後，重新比對尚未確認的列 */
export async function rematchBatch(batchId: string) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { rows: true } });
  if (batch.status !== "DRAFT" && batch.status !== "PARTIAL") throw new BizError("這個批次目前不能修改");
  const lex = await loadLexicon(prisma);
  for (const r of batch.rows) {
    if (r.status === "COMMITTED" || r.status === "EXCLUDED") continue;
    const parsed = r.parsed as unknown as RowParsed;
    const res = (r.resolution ?? {}) as Record<string, unknown>;
    const { resolution, candidates } = initialResolution(lex, parsed, { groupBuyId: (res.groupBuyId as string) ?? null });
    const next = { ...res };
    if (!res.buyerId && !res.newBuyerName && resolution.buyerId) next.buyerId = resolution.buyerId;
    if (!res.productId && resolution.productId) next.productId = resolution.productId;
    await prisma.importRow.update({
      where: { id: r.id },
      data: { parsed: { ...parsed, candidates } as unknown as Prisma.InputJsonValue, resolution: next as Prisma.InputJsonValue },
    });
  }
  await revalidateBatch(prisma, batchId);
}
