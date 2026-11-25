"use client";

/** Last-resort error screen (when even the main layout fails). Plain HTML on purpose. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0, background: "#f5f5f7", color: "#1d1d1f" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>ShiftHQ is having trouble</h1>
          <p style={{ color: "#6e6e73", fontSize: 15 }}>Please try again in a moment. If it keeps happening, tell your administrator.</p>
          {error.digest && <p style={{ fontFamily: "monospace", fontSize: 12, color: "#86868b" }}>Reference: {error.digest}</p>}
          <button onClick={reset} style={{ marginTop: 16, background: "#0071e3", color: "white", border: 0, borderRadius: 999, padding: "10px 20px", fontSize: 15 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
