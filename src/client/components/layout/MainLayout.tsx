import { useState } from "react";
import { useConnectionStore } from "@/client/stores/connection";
import { useChatStore } from "@/client/stores/chat";
import { Sidebar } from "@/client/components/sidebar/Sidebar";
import { ChatPanel } from "@/client/components/chat/ChatPanel";

export function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const connectionStatus = useConnectionStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const activeProvider = useChatStore((s) => s.activeProvider);
  const setProvider = useChatStore((s) => s.setProvider);

  return (
    <div className="flex h-full w-full">
      {sidebarOpen && (
        <Sidebar onToggle={() => setSidebarOpen(false)} />
      )}

      <main className="flex-1 flex flex-col min-w-0">
        <header
          className="flex items-center gap-3 px-4 py-2 border-b"
          style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
        >
          {!sidebarOpen && (
            <button
              className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
              onClick={() => setSidebarOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
          )}

          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--accent)] font-semibold">OpenCode</span>
            <span className="text-[var(--text-muted)]">&times;</span>
            <span className="text-[var(--text-secondary)]">ClaudeCode</span>
          </div>

          <div className="ml-auto flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <select
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-secondary)] text-xs"
              value={activeProvider}
              onChange={(e) => setProvider(e.target.value as "zen" | "openrouter" | "custom")}
            >
              <option value="zen">Zen (Free)</option>
              <option value="openrouter">OpenRouter (Free)</option>
              <option value="custom">Custom</option>
            </select>

            <div
              className={`w-2 h-2 rounded-full ${
                error ? "bg-[var(--error)]" : connectionStatus === "connected" ? "bg-[var(--success)]" : "bg-[var(--warning)]"
              }`}
            />
          </div>
        </header>

        <ChatPanel />
      </main>
    </div>
  );
}
