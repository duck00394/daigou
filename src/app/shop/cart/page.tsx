import { prisma } from "@/server/db";
import { currentCustomer } from "@/server/shop-auth";
import { isOpen } from "@/server/services/shop";
import { BackCircle, Eyebrow, SerifTitle } from "../ui";
import { CartView } from "./view";

export const metadata = { title: "購物車" };

export default async function CartPage() {
  const customer = await currentCustomer();
  const [buyer, methods, cats] = await Promise.all([
    customer ? prisma.buyer.findUnique({ where: { id: customer.id }, select: { name: true, recipientPhone: true, shippingMethod: true } }) : null,
    prisma.shippingMethod.findMany({ where: { active: true, kind: "TW_DOMESTIC_SHIPPING" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true } }),
    prisma.shopCategory.findMany({ where: { enabled: true }, select: { categoryId: true, enabled: true, openAt: true, category: { select: { name: true } } } }),
  ]);
  const shipping = [...new Set([...methods.map((m) => m.name), "面交"])];
  const status = Object.fromEntries(cats.map((c) => [c.categoryId, { open: isOpen(c), openAt: c.openAt?.toISOString() ?? null, name: c.category.name }]));
  return (
    <>
      <header className="flex items-center gap-3 px-4 py-3">
        <BackCircle href="/shop" label="繼續選購" />
        <div>
          <Eyebrow>MY CART</Eyebrow>
          <SerifTitle size={22}>購物車</SerifTitle>
        </div>
      </header>
      <CartView
        loggedIn={!!customer}
        defaults={{ name: buyer?.name ?? customer?.name ?? "", phone: buyer?.recipientPhone ?? "", shipping: buyer?.shippingMethod && shipping.includes(buyer.shippingMethod) ? buyer.shippingMethod : shipping[0] }}
        returning={!!buyer?.recipientPhone}
        shippingOptions={shipping}
        status={status}
      />
    </>
  );
}
