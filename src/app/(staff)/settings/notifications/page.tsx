import { NotificationSettingsForm } from "@/components/notifications/settings-form";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { requireStaff } from "@/server/context";
import { myNotificationSettings } from "@/server/notifications";

export const metadata = { title: "My notifications" };
export const dynamic = "force-dynamic";

export default async function MyNotificationsPage() {
  const actor = await requireStaff();
  const v = await myNotificationSettings(await getDb(), actor);
  return (
    <Card className="max-w-2xl">
      <CardHeader title="My notifications" description="How you hear about pick-up requests, swaps and callouts." />
      <CardBody>
        <NotificationSettingsForm v={v} />
      </CardBody>
    </Card>
  );
}
