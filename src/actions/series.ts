"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { prisma, tx } from "@/server/db";
import * as sr from "@/server/services/series";

const currency = z.enum(["JPY", "TWD"]);

export async function saveSeriesAction(id: string | null, input: { name: string; notes?: string | null; active?: boolean }) {
  return run((a) => tx((t) => sr.saveSeries(t, a, id, input)).then((r) => ({ id: r.id, name: r.name })));
}
export async function addSeriesCharactersAction(seriesId: string, input: { characterIds?: string[]; newNames?: string[] }) {
  return run((a) =>
    tx((t) => sr.addCharactersToSeries(t, a, seriesId, { characterIds: z.array(z.string()).max(200).parse(input.characterIds ?? []), newNames: z.array(z.string().max(50)).max(200).parse(input.newNames ?? []) })).then((x) => x.length),
  );
}
export async function removeSeriesCharacterAction(seriesId: string, characterId: string) {
  return run((a) => tx((t) => sr.removeCharacterFromSeries(t, a, seriesId, characterId)));
}
export async function moveSeriesCharacterAction(seriesId: string, characterId: string, dir: -1 | 1) {
  return run(() => tx((t) => sr.moveSeriesCharacter(t, seriesId, characterId, dir)));
}
export async function copyRosterAction(fromSeriesId: string, toSeriesId: string) {
  return run((a) => tx((t) => sr.copySeriesRoster(t, a, fromSeriesId, toSeriesId)).then((x) => x.length));
}
export async function saveTemplateAction(input: { seriesId: string; name: string; productTypeId: string | null; items: { characterId: string; spec?: string | null }[] }) {
  return run((a) => tx((t) => sr.saveTemplate(t, a, { ...input, items: z.array(z.object({ characterId: z.string(), spec: z.string().max(100).nullish() })).max(200).parse(input.items) })).then((r) => ({ id: r.id })));
}
export async function deleteTemplateAction(id: string) {
  return run((a) => tx((t) => sr.deleteTemplate(t, a, id)));
}
export async function saveSupplierAction(id: string | null, input: { name: string; defaultCurrency: "JPY" | "TWD"; contact?: string | null; notes?: string | null; active?: boolean }) {
  return run((a) => tx((t) => sr.saveSupplier(t, a, id, { ...input, defaultCurrency: currency.parse(input.defaultCurrency) })).then((r) => ({ id: r.id, name: r.name })));
}
export async function saveCharacterQuickAction(name: string) {
  return run((a) => tx((t) => sr.ensureCharacter(t, a, z.string().max(50).parse(name))).then((r) => ({ id: r.character.id, name: r.character.name, created: r.created })));
}
export async function saveProductTypeQuickAction(name: string) {
  return run(async (a) => {
    const n = z.string().min(1).max(50).parse(name.trim());
    const row = await prisma.productType.upsert({ where: { name: n }, update: {}, create: { name: n } });
    await prisma.auditLog.create({ data: { actorId: a.userId, action: "productType.save", entity: "ProductType", entityId: row.id, data: { name: n } } });
    return { id: row.id, name: row.name };
  });
}

export async function rowDefaultsAction(input: { seriesId: string; productTypeId: string | null; supplierId: string | null; characterIds: string[]; specs?: Record<string, string | null> }) {
  return run(() => sr.rowDefaults(prisma, { ...input, characterIds: z.array(z.string()).max(200).parse(input.characterIds) }), "read");
}
export async function lastUsedRosterAction(seriesId: string, excludeBatchId: string | null) {
  return run(() => sr.lastUsedRoster(prisma, { seriesId, excludeBatchId }), "read");
}
export async function seriesRosterAction(seriesId: string) {
  return run(async () => {
    const [roster, templates] = await Promise.all([
      prisma.seriesCharacter.findMany({ where: { seriesId }, orderBy: [{ sortOrder: "asc" }], include: { character: true } }),
      prisma.seriesTemplate.findMany({ where: { seriesId }, orderBy: { name: "asc" } }),
    ]);
    return {
      characters: roster.map((r) => ({ id: r.character.id, name: r.character.name, active: r.character.active })),
      templates: templates.map((t) => ({ id: t.id, name: t.name, productTypeId: t.productTypeId, items: t.items as { characterId: string; spec: string | null }[] })),
    };
  }, "read");
}

const bulkRow = z.object({
  rowKey: z.string().min(1).max(60),
  characterId: z.string().nullish(),
  newCharacterName: z.string().max(60).nullish(),
  spec: z.string().max(120).nullish(),
  unitCost: z.number().nullable(),
  currency,
  qty: z.number().nullable(),
  salePriceTwd: z.number().nullish(),
});
export async function bulkAddAction(input: { batchId: string; seriesId: string; productTypeId: string | null; submissionKey: string; rows: z.infer<typeof bulkRow>[] }) {
  return run((a) => sr.bulkAddSeriesItems(a, { ...input, rows: z.array(bulkRow).max(300).parse(input.rows) }));
}

const updRow = z.object({
  itemId: z.string(),
  qty: z.number().int().min(0).optional(),
  unitCost: z.number().int().min(0).optional(),
  actualUnitCost: z.number().int().min(0).nullish(),
  currency: currency.optional(),
  salePriceTwd: z.number().int().min(0).nullish(),
});
export async function bulkUpdateItemsAction(batchId: string, rows: z.infer<typeof updRow>[]) {
  return run((a) => sr.bulkUpdateBatchItems(a, batchId, z.array(updRow).max(300).parse(rows)));
}
