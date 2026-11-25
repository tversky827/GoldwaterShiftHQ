import { employeeMatchField } from "@/lib/config";
import { EXCEPTION_LABELS, findExceptions, hoursComparison } from "@/lib/reconciliation/exceptions";
import { ISSUE_LABELS, matchEmployees } from "@/lib/reconciliation/matching";
import { readDb } from "@/lib/store/db";

export const dynamic = "force-dynamic";

export default function ReconciliationPage() {
  const db = readDb();
  const field = employeeMatchField();
  const match = matchEmployees(db.employees, db.aodEmployees, db.attendance, field);
  const exceptions = findExceptions(db.employees, match.keyToEmployee, db.attendance, db.schedules);
  const hours = hoursComparison(db.employees, match.keyToEmployee, db.attendance, db.schedules);
  const anyMock = db.employees.some((e) => e.isMock) || db.attendance.some((a) => a.isMock);
  const h = (n: number) => n.toFixed(1);

  return (
    <>
      <h1>Reconciliation &amp; exceptions</h1>
      <p className="muted">Matching Attendance on Demand employees to Paycor employees by <code>{field}</code>. Nothing here changes any punch, employee, or payroll record — these are items for a person to review.</p>
      {anyMock && <div className="warnbox"><span className="mockflag">MOCK DATA — NOT REAL</span> Results below include fake test data.</div>}

      <section className="card">
        <h2>Employee matching ({match.matched.length} matched, {match.issues.length} issues)</h2>
        {match.issues.length === 0 ? <p className="muted">No issues.</p> : (
          <table>
            <thead><tr><th>Severity</th><th>Issue</th><th>Details</th></tr></thead>
            <tbody>{match.issues.map((i, n) => (
              <tr key={n}><td className={`sev-${i.severity}`}>{i.severity}</td><td>{ISSUE_LABELS[i.type]}</td><td>{i.message}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Timekeeping exceptions ({exceptions.length})</h2>
        {exceptions.length === 0 ? <p className="muted">No exceptions.</p> : (
          <table>
            <thead><tr><th>Severity</th><th>Type</th><th>Date</th><th>Facility</th><th>Details</th></tr></thead>
            <tbody>{exceptions.map((x, n) => (
              <tr key={n}><td className={`sev-${x.severity}`}>{x.severity}</td><td>{EXCEPTION_LABELS[x.type]}</td><td>{x.date ?? ""}</td><td>{x.facility ?? ""}</td><td>{x.message}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Hours this workweek</h2>
        <table>
          <thead><tr><th>Employee</th><th>Scheduled</th><th>Clocked</th><th>Approved</th><th>Payroll (Paycor)</th><th>Projected OT</th><th>Actual OT</th></tr></thead>
          <tbody>{hours.map((r) => (
            <tr key={r.employeeName}><td>{r.employeeName}</td><td>{h(r.scheduled)}</td><td>{h(r.clocked)}</td><td>{h(r.approved)}</td>
              <td className="muted">{r.payroll === null ? "not yet available" : h(r.payroll)}</td>
              <td className={r.projectedOvertime > 0 ? "sev-medium" : ""}>{h(r.projectedOvertime)}</td><td className={r.actualOvertime > 0 ? "sev-high" : ""}>{h(r.actualOvertime)}</td></tr>
          ))}</tbody>
        </table>
        <p className="muted" style={{ fontSize: ".85rem" }}>Payroll hours appear once a Paycor payroll-hours endpoint is confirmed for your account. Workweek is assumed Sunday–Saturday; confirm with payroll.</p>
      </section>
    </>
  );
}
