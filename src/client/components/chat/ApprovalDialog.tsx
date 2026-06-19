import type { ServerRequest } from "@/types";

interface ApprovalDialogProps {
  request: ServerRequest;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

function typeLabel(type: string): string {
  switch (type) {
    case "command": return "Run Command";
    case "file_write": return "Write File";
    case "file_read": return "Read File";
    case "tool": return "Tool Call";
    default: return type;
  }
}

export function ApprovalDialog({ request, onApprove, onDeny }: ApprovalDialogProps) {
  return (
    <div
      className="mx-4 mb-2 rounded-lg border p-3"
      style={{ background: "rgba(245, 158, 11, 0.05)", borderColor: "var(--warning)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className="text-sm font-semibold text-[var(--warning)]">
          {typeLabel(request.type)}
        </span>
      </div>

      <p className="text-sm text-[var(--text-secondary)] mb-3">
        {request.description}
      </p>

      {request.args && Object.keys(request.args).length > 0 && (
        <pre
          className="text-xs rounded px-2 py-1.5 mb-3 overflow-x-auto"
          style={{ background: "var(--code-bg)", color: "var(--text-muted)" }}
        >
          {JSON.stringify(request.args, null, 2)}
        </pre>
      )}

      <div className="flex gap-2">
        <button
          className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
          style={{ background: "var(--success)", color: "white" }}
          onClick={() => onApprove(request.id)}
        >
          Approve
        </button>
        <button
          className="px-3 py-1.5 rounded text-xs font-medium transition-colors border"
          style={{ borderColor: "var(--error)", color: "var(--error)" }}
          onClick={() => onDeny(request.id)}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
