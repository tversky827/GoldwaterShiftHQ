import { StatusBadge } from "@/components/StatusBadge";
import { getPaycorConfig } from "@/lib/config";
import { summarize, type IntegrationSummary } from "@/lib/integrations/sync";
import { readDb } from "@/lib/store/db";

export const dynamic = "force-dynamic";

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");

function ModeFlag({ mode }: { mode: string }) {
  if (mode.startsWith("mock")) return <span className="mockflag">MOCK DATA — NOT REAL</span>;
  if (mode.includes("production")) return <span className="prodflag">PRODUCTION — REAL DATA</span>;
  return <span className="badge syncing">{mode}</span>;
}

function IntegrationCard({ s, children }: { s: IntegrationSummary; children?: React.ReactNode }) {
  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h2 style={{ margin: 0 }}>{s.label}</h2>
        <StatusBadge status={s.status} />
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>{s.statusReason}</p>
      <dl className="kv">
        <dt>Mode</dt><dd><ModeFlag mode={s.mode} /></dd>
        <dt>Last successful sync</dt><dd>{fmt(s.state.lastSuccessAt)}</dd>
        <dt>Last sync failure</dt><dd>{fmt(s.state.lastFailureAt)}{s.state.lastFailureMessage ? <div className="sev-high">{s.state.lastFailureMessage}</div> : null}</dd>
        <dt>Last connection test</dt><dd>{fmt(s.state.lastConnectionTestAt)}{s.state.lastConnectionTestMessage ? <div className={s.state.lastConnectionTestOk ? "" : "sev-high"}>{s.state.lastConnectionTestMessage}</div> : null}</dd>
        <dt>Unresolved errors</dt><dd>{s.openErrors}</dd>
      </dl>
      <div className="actions">
        <form method="post" action={`/api/integrations/${s.system}/test`}><button className="secondary">Test connection</button></form>
        <form method="post" action={`/api/integrations/${s.system}/sync`}><button disabled={s.status === "syncing"}>Sync now</button></form>
      </div>
      {children}
    </section>
  );
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { paycor, aod, counts } = summarize();
  const db = readDb();
  const pc = getPaycorConfig();
  const errors = db.syncErrors.filter((e) => !e.resolved).slice(0, 20);
  const noAdminPassword = !process.env.ADMIN_PASSWORD;

  return (
    <>
      <h1>Integration dashboard</h1>
      <p className="muted">Connections to Paycor (HR) and Attendance on Demand (timekeeping). This app only <em>reads</em> from them — it never changes punches or payroll.</p>

      {noAdminPassword && <div className="warnbox">ADMIN_PASSWORD is not set, so this page is unprotected. That is OK on your own computer for testing, but must be set before hosting. See docs/integrations/05-secure-credentials.md.</div>}
      {sp.msg && <div className={`flash ${sp.ok === "1" ? "ok" : "bad"}`}>{sp.msg}</div>}

      <div className="stats">
        <div className="stat"><div className="n">{counts.employees}</div><div className="l">Employees imported (Paycor)</div></div>
        <div className="stat"><div className="n">{counts.attendance}</div><div className="l">Attendance records imported (AOD)</div></div>
        <div className="stat"><div className="n">{counts.matched}</div><div className="l">Employees matched across systems</div></div>
        <div className="stat"><div className="n">{counts.unmatchedEmployees}</div><div className="l">Unmatched / missing-ID employees</div></div>
        <div className="stat"><div className="n">{counts.pendingErrors}</div><div className="l">Pending sync errors</div></div>
      </div>

      <div className="grid">
        <IntegrationCard s={paycor}>
          {pc.mode !== "mock" && (
            <form method="post" action="/api/integrations/paycor/connect" style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div className="muted" style={{ marginBottom: 6 }}>Authorize this app in Paycor (repeat once per legal entity):</div>
              <input type="number" name="legalEntityId" placeholder="Legal Entity ID" required /> <button>Connect Paycor</button>
              <div className="muted" style={{ fontSize: ".85rem", marginTop: 6 }}>Redirect URL to register in AppCreator: <code>{pc.redirectUri}</code></div>
            </form>
          )}
        </IntegrationCard>
        <IntegrationCard s={aod}>
          {aod.mode.startsWith("file") && (
            <form method="post" action="/api/integrations/aod/upload" encType="multipart/form-data" style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div className="muted" style={{ marginBottom: 6 }}>Upload an Attendance on Demand export (.csv):</div>
              <input type="file" name="file" accept=".csv" required /> <button>Upload</button>
            </form>
          )}
        </IntegrationCard>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Pending synchronization errors</h2>
        {errors.length === 0 ? <p className="muted">None.</p> : (
          <table>
            <thead><tr><th>When</th><th>System</th><th>What happened</th><th></th></tr></thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.id}>
                  <td>{fmt(e.at)}</td><td>{e.system === "paycor" ? "Paycor" : "AOD"}</td>
                  <td>{e.message}{e.detail ? <div className="muted" style={{ fontSize: ".8rem" }}>{e.detail}</div> : null}</td>
                  <td><form method="post" action={`/api/integrations/errors/${e.id}/resolve`}><button className="secondary">Mark resolved</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ fontSize: ".85rem" }}>Stuck? See docs/integrations/07-troubleshooting.md for what each message means.</p>
      </section>
    </>
  );
}
