<script setup lang="ts">
import type { Session } from "@/types";

defineProps<{
  sessions: Session[];
  selectedSessionId: string | null;
  sessionsByProject: Map<string, Session[]>;
}>();

const emit = defineEmits<{
  selectSession: [sessionId: string];
  createSession: [];
  toggleSidebar: [];
}>();

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function projectName(path: string): string {
  return path.split("/").filter(Boolean).pop() || "default";
}
</script>

<template>
  <aside
    class="flex flex-col w-64 border-r overflow-hidden"
    style="background: var(--bg-secondary); border-color: var(--border)"
  >
    <div class="flex items-center justify-between px-3 py-2 border-b" style="border-color: var(--border)">
      <span class="text-sm font-semibold text-[var(--text-primary)]">Sessions</span>
      <div class="flex gap-1">
        <button
          class="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
          title="New session"
          @click="emit('createSession')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          class="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
          title="Collapse sidebar"
          @click="emit('toggleSidebar')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      <template v-for="[project, projectSessions] in sessionsByProject" :key="project">
        <div class="px-3 py-1.5 text-xs text-[var(--text-muted)] uppercase tracking-wider">
          {{ projectName(project) }}
        </div>

        <button
          v-for="session in projectSessions"
          :key="session.id"
          class="w-full text-left px-3 py-2 text-sm transition-colors"
          :class="
            session.id === selectedSessionId
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
          "
          @click="emit('selectSession', session.id)"
        >
          <div class="truncate">{{ session.title }}</div>
          <div class="text-xs text-[var(--text-muted)] mt-0.5">
            {{ formatTime(session.updatedAt) }}
          </div>
        </button>
      </template>

      <div
        v-if="sessions.length === 0"
        class="px-3 py-8 text-center text-sm text-[var(--text-muted)]"
      >
        No sessions yet.<br />
        Start a new conversation.
      </div>
    </div>
  </aside>
</template>
