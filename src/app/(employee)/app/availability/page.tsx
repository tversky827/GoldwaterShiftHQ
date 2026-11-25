import { getDb } from "@/db";
import { requireActor } from "@/server/context";
import { myAvailability } from "@/server/me";
import { AvailabilityForm } from "./availability-form";

export const metadata = { title: "My availability" };
export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const actor = await requireActor();
  const a = await myAvailability(await getDb(), actor);
  return (
    <div>
      <h1 className="mb-6 text-[32px] font-semibold tracking-tight">My availability</h1>
      <AvailabilityForm {...a} />
    </div>
  );
}
