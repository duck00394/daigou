import { requireUser } from "@/server/auth";
import { PageHeader, Section } from "@/components/ui";
import { BuyerFormView } from "../forms";

export const metadata = { title: "新增買家" };

export default async function NewBuyer() {
  await requireUser();
  return (
    <div>
      <PageHeader title="新增買家" back={{ href: "/buyers", label: "買家" }} />
      <Section>
        <BuyerFormView id={null} initial={{ name: "", lineName: null, contact: null, recipientName: null, recipientPhone: null, address: null, shippingMethod: null, notes: null }} />
      </Section>
    </div>
  );
}
