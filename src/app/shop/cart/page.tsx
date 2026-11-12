import { prisma } from "@/server/db";
import { currentCustomer } from "@/server/shop-auth";
import { getContactField, isOpen } from "@/server/services/shop";
import { BackCircle, Eyebrow, SerifTitle } from "../ui";
import { CartView } from "./view";

export const metadata = { title: "購物車" };

export default async function CartPage() {
  const customer = await currentCustomer();
  const [buyer, methods, cats, field] = await Promise.all([
    customer ? prisma.buyer.findUnique({ where: { id: customer.id }, select: { name: true, recipientPhone: true, contact: true, shippingMethod: true } }) : null,
    prisma.shippingMethod.findMany({ where: { active: true, kind: "TW_DOMESTIC_SHIPPING" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true } }),
    prisma.shopCategory.findMany({ where: { enabled: true }, select: { categoryId: true, enabled: true, openAt: true, payUrl: true, payTiming: true, payHours: true, category: { select: { name: true } } } }),
    getContactField(prisma),
  ]);
  const prevContact = (field.mode === "phone" ? buyer?.recipientPhone : field.mode === "text" ? buyer?.contact : "") ?? "";
  const shipping = [...new Set([...methods.map((m) => m.name), "面交"])];
  const status = Object.fromEntries(cats.map((c) => [c.categoryId, { open: isOpen(c), openAt: c.openAt?.toISOString() ?? null, name: c.category.name, pay: c.payUrl ? { timing: c.payTiming, hours: c.payHours } : null }]));
  // 每個角色的訂金（有設賣貨便連結的系列才算）
  const depRows = await prisma.shopQuota.findMany({ where: { categoryId: { in: cats.filter((c) => c.payUrl).map((c) => c.categoryId) }, deposit: { gt: 0 } }, select: { categoryId: true, productId: true, deposit: true } });
  const deposits = Object.fromEntries(depRows.map((d) => [`${d.categoryId}|${d.productId}`, d.deposit ?? 0]));
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
        lineName={customer?.name ?? null}
        deposits={deposits}
        defaults={{ name: buyer?.name ?? customer?.name ?? "", phone: prevContact, shipping: buyer?.shippingMethod && shipping.includes(buyer.shippingMethod) ? buyer.shippingMethod : shipping[0] }}
        returning={!!buyer?.shippingMethod}
        field={field}
        shippingOptions={shipping}
        status={status}
      />
    </>
  );
}
