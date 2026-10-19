import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { PushSetup } from "@/components/push-setup";
import { vapidPublicKey } from "@/server/push";

export const metadata = { title: "開啟搶購通知" };

export default async function NotifyPage() {
  await requireUser();
  return (
    <div className="space-y-3">
      <PageHeader title="開啟搶購通知" back={{ href: "/rush", label: "搶購提醒" }} sub="iPhone 要先把 App 加到主畫面、從主畫面打開，才能收到通知（Apple 的規定，iOS 16.4 以上）。" />
      <PushSetup vapidKey={vapidPublicKey()} />
    </div>
  );
}
