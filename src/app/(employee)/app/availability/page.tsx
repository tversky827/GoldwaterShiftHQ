import { Clock4 } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { requireActor } from "@/server/context";

export const metadata = { title: "My availability" };

export default async function AvailabilityPage() {
  await requireActor();
  return (
    <div>
      <h1 className="text-[32px] font-semibold tracking-tight">My availability</h1>
      <EmptyState icon={<Clock4 />} title="Coming with the next release" description="Soon you’ll set the days you can work, preferred shifts and facilities, and your maximum weekly hours here." />
    </div>
  );
}
