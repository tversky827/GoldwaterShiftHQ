import { CalendarPlus } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { requireActor } from "@/server/context";

export const metadata = { title: "Pick up shifts" };

export default async function PickUpPage() {
  await requireActor();
  return (
    <div>
      <h1 className="text-[32px] font-semibold tracking-tight">Pick up shifts</h1>
      <EmptyState
        icon={<CalendarPlus />}
        title="Coming with the next release"
        description="Soon, open shifts you’re qualified and authorized for will appear here, and you’ll be able to claim one with a single tap."
      />
    </div>
  );
}
