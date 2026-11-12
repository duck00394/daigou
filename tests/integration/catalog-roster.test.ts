// 系列目錄「＋ 角色」：直接從 IP 角色＋這個系列加過的角色點選；一次加好幾隻
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb } from "../helpers";
import { saveCategory } from "@/server/services/catalog";
import { addCatalogCharacter, addCatalogCharacters, addCatalogItem, catalogRoster } from "@/server/services/catalog-tree";
import { saveSeries, ensureCharacter } from "@/server/services/series";

beforeEach(async () => {
  await resetDb();
});

describe("系列目錄：點選角色", () => {
  it("列 IP 角色＋系列另外加的；一次加好幾隻，不在 IP 預設名單多加", async () => {
    const ip = await tx((t) => saveSeries(t, actor, null, { name: "吉伊卡哇" }));
    for (const [i, n] of ["吉伊", "小八", "兔兔"].entries()) {
      const c = (await tx((t) => ensureCharacter(t, actor, n))).character;
      await prisma.seriesCharacter.create({ data: { seriesId: ip.id, characterId: c.id, sortOrder: i } });
    }
    const doc = await tx((t) => saveCategory(t, actor, null, { name: "醫生&護士", type: "GENERAL" }));
    const nurse = await tx((t) => addCatalogItem(t, actor, { categoryId: doc.id, typeName: "護士吊娃" }));
    const docDoll = await tx((t) => addCatalogItem(t, actor, { categoryId: doc.id, typeName: "醫生吊娃" }));
    await tx((t) => addCatalogCharacter(t, actor, { categoryId: doc.id, typeId: nurse.typeId, characterName: "師傅" }));

    const r = await tx((t) => catalogRoster(t, doc.id));
    expect(r.ipName).toBe("吉伊卡哇");
    expect(r.chars.map((c) => c.name)).toEqual(["吉伊", "小八", "兔兔", "師傅"]);

    const ids = r.chars.filter((c) => ["吉伊", "師傅"].includes(c.name)).map((c) => c.id);
    await tx((t) => addCatalogCharacters(t, actor, { categoryId: doc.id, typeId: docDoll.typeId, characterIds: ids }));
    const ps = await prisma.product.findMany({ where: { productTypeId: docDoll.typeId, categories: { some: { categoryId: doc.id } } }, include: { characters: { include: { character: true } } } });
    expect(ps.map((p) => p.characters[0].character.name).sort()).toEqual(["吉伊", "師傅"].sort());
    expect(await prisma.seriesCharacter.count({ where: { seriesId: ip.id } })).toBe(3);
    // 再加一次同一隻不會多一個商品
    await tx((t) => addCatalogCharacters(t, actor, { categoryId: doc.id, typeId: docDoll.typeId, characterIds: ids.slice(0, 1) }));
    expect(await prisma.product.count({ where: { productTypeId: docDoll.typeId } })).toBe(2);
  });
});
