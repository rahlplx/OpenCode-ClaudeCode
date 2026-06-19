import { useSessionsStore } from "@/client/stores/sessions";
import type { Session } from "@/types";

interface SidebarProps {
  onToggle: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function groupByProject(sessions: Session[]): Map<string, Session[]> {
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const project = session.projectPath || "default";
    const list = groups.get(project) || [];
    list.push(session);
    groups.set(project, list);
  }
  return groups;
}

function projectName(path: string): string {
  return path.split("/").filter(Boolean).pop() || "default";
}

export function Sidebar({ onToggle }: SidebarProps) {
  const sessions = useSessionsStore((s) => s.sessions);
  const selectedId = useSessionsStore((s) => s.selectedId);
  const select = useSessionsStore((s) => s.select);
  const create = useSessionsStore((s) => s.create);
  const groups = groupByProject(sessions);

  return (
    <aside
      className="flex flex-col w-64 border-r overflow-hidden shrink-0"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-sm font-semibold text-[var(--text-primary)]">Sessions</span>
        <div className="flex gap-1">
          <button
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
            title="New session"
            onClick={() => create()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
            title="Collapse sidebar"
            onClick={onToggle}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {Array.from(groups.entries()).map(([project, projectSessions]) => (
          <div key={project}>
            <div className="px-3 py-1.5 text-xs text-[var(--text-muted)] uppercase tracking-wider">
              {projectName(project)}
            </div>
            {projectSessions.map((session) => (
              <button
                key={session.id}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  session.id === selectedId
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                }`}
                onClick={() => select(session.id)}
              >
                <div className="truncate">{session.title}</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  {formatTime(session.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        ))}

        {sessions.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
            No sessions yet.<br />
            Start a new conversation.
          </div>
        )}
      </div>
    </aside>
  );
}
