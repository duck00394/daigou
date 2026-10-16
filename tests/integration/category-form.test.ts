import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { listCustomCategoryTypes, saveCategory } from "@/server/services/catalog";

describe("新增／編輯活動", () => {
  beforeEach(async () => {
    await resetDb();
    await seedBasics();
  });

  it("自訂類型沒名字就當一般分類，存好後會變成下次的選項", async () => {
    const old = await tx((t) => saveCategory(t, actor, null, { name: "舊的", type: "CUSTOM", customType: "  " }));
    expect(old.type).toBe("GENERAL");
    await tx((t) => saveCategory(t, actor, null, { name: "快閃A", type: "CUSTOM", customType: " 快閃店 " }));
    await tx((t) => saveCategory(t, actor, null, { name: "快閃B", type: "CUSTOM", customType: "快閃店" }));
    await tx((t) => saveCategory(t, actor, null, { name: "ANA", type: "GENERAL" }));
    expect(await tx((t) => listCustomCategoryTypes(t))).toEqual(["快閃店"]);
  });

  it("編輯可以改名，不會把排序歸零", async () => {
    const c = await tx((t) => saveCategory(t, actor, null, { name: "ANA", type: "GENERAL", sortOrder: 5 }));
    await tx((t) => saveCategory(t, actor, c.id, { name: "ANA 聯名", type: "GENERAL" }));
    const row = await prisma.category.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.name).toBe("ANA 聯名");
    expect(row.sortOrder).toBe(5);
  });
});
