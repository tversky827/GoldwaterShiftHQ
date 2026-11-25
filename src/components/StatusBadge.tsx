import type { DisplayStatus } from "@/lib/integrations/sync";

const TEXT: Record<DisplayStatus, string> = {
  connected: "● Connected",
  needs_attention: "▲ Needs attention",
  disconnected: "✕ Disconnected",
  syncing: "⟳ Synchronization in progress",
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={`badge ${status}`}>{TEXT[status]}</span>;
}
