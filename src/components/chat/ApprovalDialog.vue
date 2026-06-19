<script setup lang="ts">
import type { ServerRequest } from "@/types";

defineProps<{
  request: ServerRequest;
}>();

const emit = defineEmits<{
  approve: [requestId: string];
  deny: [requestId: string];
}>();

function typeLabel(type: string): string {
  switch (type) {
    case "command": return "Run Command";
    case "file_write": return "Write File";
    case "file_read": return "Read File";
    case "tool": return "Tool Call";
    default: return type;
  }
}
</script>

<template>
  <div
    class="mx-4 mb-2 rounded-lg border p-3"
    style="background: rgba(245, 158, 11, 0.05); border-color: var(--warning)"
  >
    <div class="flex items-center gap-2 mb-2">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span class="text-sm font-semibold text-[var(--warning)]">
        {{ typeLabel(request.type) }}
      </span>
    </div>

    <p class="text-sm text-[var(--text-secondary)] mb-3">
      {{ request.description }}
    </p>

    <pre
      v-if="request.args && Object.keys(request.args).length > 0"
      class="text-xs rounded px-2 py-1.5 mb-3 overflow-x-auto"
      style="background: var(--code-bg); color: var(--text-muted)"
    >{{ JSON.stringify(request.args, null, 2) }}</pre>

    <div class="flex gap-2">
      <button
        class="px-3 py-1.5 rounded text-xs font-medium transition-colors"
        style="background: var(--success); color: white"
        @click="emit('approve', request.id)"
      >
        Approve
      </button>
      <button
        class="px-3 py-1.5 rounded text-xs font-medium transition-colors border"
        style="border-color: var(--error); color: var(--error)"
        @click="emit('deny', request.id)"
      >
        Deny
      </button>
    </div>
  </div>
</template>
