<script setup lang="ts">
import { computed } from "vue";
import type { Message } from "@/types";

const props = defineProps<{
  message: Message;
}>();

const isUser = computed(() => props.message.role === "user");
const isAssistant = computed(() => props.message.role === "assistant");
const isTool = computed(() => props.message.role === "tool");

const codeBlocks = computed(() => {
  const content = props.message.content;
  const blocks: Array<{ type: "text" | "code"; content: string; language?: string }> = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }
    blocks.push({ type: "code", content: match[2], language: match[1] || undefined });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    blocks.push({ type: "text", content: content.slice(lastIndex) });
  }

  return blocks.length > 0 ? blocks : [{ type: "text" as const, content }];
});

function copyCode(code: string): void {
  navigator.clipboard.writeText(code);
}
</script>

<template>
  <div
    class="flex gap-3"
    :class="isUser ? 'justify-end' : 'justify-start'"
  >
    <div
      v-if="!isUser"
      class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-1"
      :style="{
        background: isTool ? 'var(--warning)' : 'var(--accent)',
        color: 'white',
      }"
    >
      {{ isTool ? 'T' : 'AI' }}
    </div>

    <div
      class="max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed"
      :style="{
        background: isUser ? 'var(--bg-tertiary)' : 'var(--bg-surface)',
        border: `1px solid var(--border)`,
      }"
    >
      <template v-for="(block, i) in codeBlocks" :key="i">
        <p
          v-if="block.type === 'text'"
          class="whitespace-pre-wrap"
          :class="isUser ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
        >{{ block.content }}</p>

        <div v-else class="my-2 rounded overflow-hidden" style="background: var(--code-bg)">
          <div class="flex items-center justify-between px-3 py-1.5 text-xs" style="background: rgba(255,255,255,0.05)">
            <span class="text-[var(--text-muted)]">{{ block.language || 'code' }}</span>
            <button
              class="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              @click="copyCode(block.content)"
            >
              Copy
            </button>
          </div>
          <pre class="px-3 py-2 text-xs overflow-x-auto"><code class="text-[var(--text-primary)]">{{ block.content }}</code></pre>
        </div>
      </template>

      <div
        v-if="message.isStreaming"
        class="inline-block w-1.5 h-4 ml-0.5 animate-pulse"
        style="background: var(--accent)"
      />
    </div>

    <div
      v-if="isUser"
      class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-1"
      style="background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border)"
    >
      U
    </div>
  </div>
</template>
