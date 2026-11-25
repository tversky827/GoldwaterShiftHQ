import { redirect } from "next/navigation";
import { getActor } from "@/server/context";
import { can, isStaff } from "@/server/rbac/access";

export const dynamic = "force-dynamic";

/** Sends each person to the experience that matches their permissions. */
export default async function Home() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (isStaff(actor)) redirect(can(actor, "facilities.view") ? "/overview" : "/employees");
  if (actor.employeeId) redirect("/app");
  redirect("/forbidden");
}
