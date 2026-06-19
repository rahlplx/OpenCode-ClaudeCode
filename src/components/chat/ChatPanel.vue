<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from "vue";
import type { Message, ServerRequest } from "@/types";
import ChatMessage from "./ChatMessage.vue";
import ApprovalDialog from "./ApprovalDialog.vue";

const props = defineProps<{
  messages: Message[];
  isGenerating: boolean;
  pendingApprovals: ServerRequest[];
  error: string | null;
  inputText: string;
}>();

const emit = defineEmits<{
  send: [content: string];
  abort: [];
  approve: [requestId: string];
  deny: [requestId: string];
  clearError: [];
  "update:inputText": [value: string];
}>();

const messagesContainer = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

function handleSend(): void {
  const content = props.inputText.trim();
  if (!content || props.isGenerating) return;
  emit("send", content);
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function autoResize(): void {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

function scrollToBottom(): void {
  nextTick(() => {
    const el = messagesContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(() => props.messages.length, scrollToBottom);
watch(
  () => props.messages[props.messages.length - 1]?.content,
  scrollToBottom,
);

onMounted(() => {
  textareaRef.value?.focus();
});
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0">
    <!-- Messages -->
    <div
      ref="messagesContainer"
      class="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      style="background: var(--bg-primary)"
    >
      <div
        v-if="messages.length === 0"
        class="flex flex-col items-center justify-center h-full text-center"
      >
        <div class="text-4xl mb-4 opacity-20">&#9679;</div>
        <h2 class="text-lg font-semibold text-[var(--text-primary)] mb-2">
          OpenCode-ClaudeCode
        </h2>
        <p class="text-sm text-[var(--text-muted)] max-w-md">
          AI coding agent powered by OpenCode. Free AI tokens via Zen API and OpenRouter.
          Start typing to begin.
        </p>
      </div>

      <ChatMessage
        v-for="message in messages"
        :key="message.id"
        :message="message"
      />

      <div
        v-if="isGenerating"
        class="flex items-center gap-2 text-sm text-[var(--text-muted)]"
      >
        <span class="inline-flex gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style="animation-delay: 0.15s" />
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style="animation-delay: 0.3s" />
        </span>
        Generating...
      </div>
    </div>

    <!-- Pending Approvals -->
    <ApprovalDialog
      v-for="request in pendingApprovals"
      :key="request.id"
      :request="request"
      @approve="emit('approve', $event)"
      @deny="emit('deny', $event)"
    />

    <!-- Error Banner -->
    <div
      v-if="error"
      class="mx-4 mb-2 px-3 py-2 rounded text-sm flex items-center justify-between"
      style="background: rgba(239, 68, 68, 0.1); border: 1px solid var(--error)"
    >
      <span class="text-[var(--error)]">{{ error }}</span>
      <button
        class="text-[var(--error)] hover:text-[var(--accent-hover)] text-xs"
        @click="emit('clearError')"
      >
        Dismiss
      </button>
    </div>

    <!-- Input -->
    <div
      class="px-4 py-3 border-t"
      style="border-color: var(--border); background: var(--bg-secondary)"
    >
      <div
        class="flex items-end gap-2 rounded-lg border px-3 py-2"
        style="background: var(--bg-surface); border-color: var(--border)"
      >
        <textarea
          ref="textareaRef"
          :value="inputText"
          placeholder="Send a message... (Enter to send, Shift+Enter for newline)"
          rows="1"
          class="flex-1 bg-transparent resize-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          style="max-height: 200px"
          @input="emit('update:inputText', ($event.target as HTMLTextAreaElement).value); autoResize()"
          @keydown="handleKeydown"
        />

        <button
          v-if="isGenerating"
          class="p-1.5 rounded text-[var(--error)] hover:bg-[rgba(239,68,68,0.1)]"
          title="Stop generation"
          @click="emit('abort')"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
        <button
          v-else
          class="p-1.5 rounded transition-colors"
          :class="
            inputText.trim()
              ? 'text-[var(--accent)] hover:bg-[rgba(233,69,96,0.1)]'
              : 'text-[var(--text-muted)] cursor-not-allowed'
          "
          :disabled="!inputText.trim()"
          title="Send message"
          @click="handleSend"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
