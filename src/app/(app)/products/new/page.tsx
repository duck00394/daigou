import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section } from "@/components/ui";
import { ProductFormView } from "../form";

export const metadata = { title: "新增商品" };

export default async function NewProduct({ searchParams }: { searchParams: Promise<{ name?: string; categoryId?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [categories, characters, types] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.character.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.productType.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="新增商品" back={{ href: "/products", label: "商品" }} />
      <Section>
        <ProductFormView
          id={null}
          isNew
          categories={categories}
          characters={characters}
          types={types}
          initial={{
            name: sp.name ?? "",
            status: "PREORDER",
            imageUrl: null,
            series: null,
            spec: null,
            productTypeId: null,
            officialPriceJpy: null,
            salePriceTwd: null,
            estCostTwd: null,
            weightGrams: null,
            sourceName: null,
            sourceUrl: null,
            releaseDate: null,
            expectedArrivalDate: null,
            actualArrivalDate: null,
            notes: null,
            characterIds: [],
            categoryIds: sp.categoryId ? [sp.categoryId] : [],
          }}
        />
      </Section>
    </div>
  );
}
