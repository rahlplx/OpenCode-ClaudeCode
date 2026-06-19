<script setup lang="ts">
import { inject } from "vue";
import type { ReturnType } from "vue";
import Sidebar from "@/components/sidebar/Sidebar.vue";
import ChatPanel from "@/components/chat/ChatPanel.vue";

const state = inject("agentState") as ReturnType<
  typeof import("@/composables/useAgentState").useAgentState
>;
</script>

<template>
  <div class="flex h-full w-full">
    <Sidebar
      v-if="!state.sidebarCollapsed.value"
      :sessions="state.sessions.value"
      :selected-session-id="state.selectedSessionId.value"
      :sessions-by-project="state.sessionsByProject.value"
      @select-session="state.selectSession($event)"
      @create-session="state.createSession()"
      @toggle-sidebar="state.toggleSidebar()"
    />

    <main class="flex-1 flex flex-col min-w-0">
      <header
        class="flex items-center gap-3 px-4 py-2 border-b"
        style="border-color: var(--border); background: var(--bg-secondary)"
      >
        <button
          v-if="state.sidebarCollapsed.value"
          class="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
          @click="state.toggleSidebar()"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>

        <div class="flex items-center gap-2 text-sm">
          <span class="text-[var(--accent)] font-semibold">OpenCode</span>
          <span class="text-[var(--text-muted)]">×</span>
          <span class="text-[var(--text-secondary)]">ClaudeCode</span>
        </div>

        <div class="ml-auto flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <select
            class="bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-secondary)] text-xs"
            :value="state.activeProvider.value"
            @change="state.setProvider(($event.target as HTMLSelectElement).value as 'zen' | 'openrouter' | 'custom')"
          >
            <option value="zen">Zen (Free)</option>
            <option value="openrouter">OpenRouter (Free)</option>
            <option value="custom">Custom</option>
          </select>

          <div
            class="w-2 h-2 rounded-full"
            :class="state.errorState.value ? 'bg-[var(--error)]' : 'bg-[var(--success)]'"
          />
        </div>
      </header>

      <ChatPanel
        :messages="state.currentMessages.value"
        :is-generating="state.isCurrentSessionGenerating.value"
        :pending-approvals="state.pendingApprovals.value"
        :error="state.errorState.value"
        :input-text="state.inputText.value"
        @send="state.sendMessage($event)"
        @abort="state.abortGeneration()"
        @approve="state.approveRequest($event)"
        @deny="state.denyRequest($event)"
        @clear-error="state.clearError()"
        @update:input-text="state.inputText.value = $event"
      />
    </main>
  </div>
</template>
