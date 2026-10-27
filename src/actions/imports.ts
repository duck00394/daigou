"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { BizError } from "@/server/db";
import { stageLine, stageExcel, inspectWorkbook, rematchBatch } from "@/server/imports/stage";
import { bulkUpdateRows, commitBatch, discardBatch, updateRowResolution } from "@/server/imports/engine";
import { MAX_FILE_BYTES } from "@/lib/parser/excel";

export async function stageLineAction(input: { text: string; groupBuyId: string | null; idempotencyKey: string; replaceBatchId: string | null }) {
  return run(async (a) => {
    const b = await stageLine(a, input);
    return { id: b.id };
  });
}

async function readUpload(fd: FormData) {
  const f = fd.get("file");
  if (!(f instanceof File)) throw new BizError("請選擇檔案");
  if (f.size > MAX_FILE_BYTES) throw new BizError("檔案超過 10 MB 上限");
  const name = f.name.slice(0, 200);
  return { name, buf: new Uint8Array(await f.arrayBuffer()) };
}

export async function inspectFileAction(fd: FormData) {
  return run(async () => {
    const { name, buf } = await readUpload(fd);
    try {
      return { fileName: name, sheets: inspectWorkbook(name, buf) };
    } catch (e) {
      if (e instanceof BizError) throw e;
      throw new BizError(e instanceof Error ? `無法讀取檔案：${e.message}` : "無法讀取檔案");
    }
  }, "read");
}

export async function stageExcelAction(fd: FormData) {
  return run(async (a) => {
    const { name, buf } = await readUpload(fd);
    const sheetName = String(fd.get("sheetName") ?? "");
    const mapping = z.record(z.string(), z.number().int().min(0).max(500)).parse(JSON.parse(String(fd.get("mapping") ?? "{}")));
    const groupBuyId = (fd.get("groupBuyId") as string) || null;
    const idempotencyKey = String(fd.get("idempotencyKey") ?? "");
    if (!idempotencyKey) throw new BizError("缺少識別碼，請重新整理頁面");
    try {
      const b = await stageExcel(a, { fileName: name, buf, sheetName, mapping, groupBuyId, idempotencyKey });
      return { id: b.id };
    } catch (e) {
      if (e instanceof BizError) throw e;
      if (e instanceof Error && /工作表|檔案|格式|列/.test(e.message)) throw new BizError(e.message);
      throw e;
    }
  });
}

const resolutionPatch = z
  .object({
    buyerId: z.string().nullish(),
    newBuyerName: z.string().max(100).nullish(),
    productId: z.string().nullish(),
    qty: z.number().int().nullish(),
    unitPrice: z.number().int().nullish(),
    specNote: z.string().max(200).nullish(),
    categoryId: z.string().nullish(),
    groupBuyId: z.string().nullish(),
    appendMode: z.enum(["NEW", "APPEND", "NEW_LINKED"]).optional(),
    appendOrderId: z.string().nullish(),
    saveProductAlias: z.boolean().optional(),
    saveBuyerAlias: z.boolean().optional(),
    forceDuplicate: z.boolean().optional(),
    paidAmount: z.number().int().nullish(),
    exclude: z.boolean().optional(),
  })
  .strict();

export async function updateRowAction(batchId: string, rowId: string, patch: z.infer<typeof resolutionPatch>) {
  return run(() => updateRowResolution(batchId, rowId, resolutionPatch.parse(patch)));
}
export async function bulkRowsAction(batchId: string, rowIds: string[], patch: z.infer<typeof resolutionPatch>) {
  return run(() => bulkUpdateRows(batchId, z.array(z.string()).max(25000).parse(rowIds), resolutionPatch.parse(patch)));
}
export async function rematchAction(batchId: string) {
  return run(() => rematchBatch(batchId));
}
export async function commitAction(batchId: string) {
  return run(async (a) => {
    const { getView } = await import("@/server/view");
    const v = await getView();
    return commitBatch(a, batchId, { owner: v.key !== "all" ? v.key : v.me });
  });
}
export async function discardAction(batchId: string) {
  return run((a) => discardBatch(a, batchId));
}
