import { prisma } from "@/server/db";

/** 代購團、系列的選項（選或打字用） */
export async function rushOptions() {
  const [suppliers, series] = await Promise.all([
    prisma.supplier.findMany({ where: { active: true }, orderBy: [{ favorite: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.category.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  // 以前搶購記過、但不是代購資料裡的名字也列出來
  const past = await prisma.rushEvent.findMany({ distinct: ["supplierName"], select: { supplierName: true }, orderBy: { createdAt: "desc" }, take: 30 });
  for (const p of past) if (!suppliers.some((s) => s.name === p.supplierName)) suppliers.push({ id: "", name: p.supplierName });
  return { suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })), series };
}
