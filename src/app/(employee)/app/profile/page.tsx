import { LogOut } from "lucide-react";
import { Avatar, Badge } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { EMPLOYMENT_TYPE_LABEL, formatDate } from "@/lib/format";
import { requireActor } from "@/server/context";
import { getEmployeeProfile } from "@/server/employees";
import { myNotificationSettings } from "@/server/notifications";
import { NotificationSettingsForm } from "@/components/notifications/settings-form";
import { signOutAction } from "../../../(public)/actions";

export const metadata = { title: "My profile" };
export const dynamic = "force-dynamic";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 px-1 text-[13px] font-medium uppercase tracking-wide text-faint">{title}</h2>
      <div className="divide-y divide-line rounded-2xl border border-black/[0.04] bg-surface px-4 shadow-card">{children}</div>
    </section>
  );
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 text-[15px]">
      <span className="text-ink-2">{label}</span>
      <span className="text-right text-muted">{value ?? "—"}</span>
    </div>
  );
}

export default async function ProfilePage() {
  const actor = await requireActor();
  const db = await getDb();
  const [p, notes] = await Promise.all([getEmployeeProfile(db, actor, actor.employeeId!), myNotificationSettings(db, actor)]);
  const e = p.employee;
  const name = `${e.preferredName ?? e.firstName} ${e.lastName}`;
  return (
    <div className="space-y-7">
      <div className="flex flex-col items-center pt-2 text-center">
        <Avatar name={name} className="size-20 text-[24px]" />
        <h1 className="mt-3 text-[26px] font-semibold tracking-tight">{name}</h1>
        <p className="text-[15px] text-muted">{p.positions.find((x) => x.isPrimary)?.name ?? e.paycorPosition}</p>
      </div>

      <section>
        <h2 className="mb-1.5 px-1 text-[13px] font-medium uppercase tracking-wide text-faint">Notifications</h2>
        <div className="rounded-2xl border border-black/[0.04] bg-surface p-4 shadow-card">
          <NotificationSettingsForm v={notes} />
        </div>
      </section>

      <Group title="Employment">
        <Row label="Home facility" value={e.isRegionalPool ? "Regional staffing pool" : p.facilityName} />
        <Row label="Department" value={p.departmentName} />
        <Row label="Employment type" value={EMPLOYMENT_TYPE_LABEL[e.employmentType]} />
        <Row label="Employee #" value={e.employeeNumber} />
        <Row label="Hire date" value={formatDate(e.hireDate)} />
      </Group>

      <Group title="Job classifications">
        <div className="flex flex-wrap gap-1.5 py-3.5">
          {p.positions.length ? p.positions.map((x) => <Badge key={x.id} tone={x.isPrimary ? "accent" : "neutral"}>{x.name}</Badge>) : <span className="text-[15px] text-muted">None on file</span>}
        </div>
      </Group>

      <Group title="Credentials">
        {p.credentials.length === 0 ? (
          <Row label="No credentials on file" value="" />
        ) : (
          p.credentials.map(({ credential: c, typeName }) => <Row key={c.id} label={typeName} value={<span>{c.status === "verified" ? "Verified" : "Pending"} · exp. {formatDate(c.expiresOn)}</span>} />)
        )}
      </Group>

      <Group title="Facilities I can work at">
        {!e.isRegionalPool && p.facilityName && <Row label={p.facilityName} value="Home" />}
        {p.authorizations.map((a) => (
          <Row key={a.authorization.id} label={a.facilityName} value="Authorized" />
        ))}
      </Group>

      <p className="px-1 text-[13px] text-faint">Your details come from Paycor. If something is wrong, let HR know and it will update here automatically.</p>

      <form action={signOutAction}>
        <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-surface py-3.5 text-[16px] font-medium text-critical shadow-card">
          <LogOut className="size-4" /> Sign out
        </button>
      </form>
    </div>
  );
}
