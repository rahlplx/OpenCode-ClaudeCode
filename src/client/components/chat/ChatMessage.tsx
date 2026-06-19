import { useMemo, useCallback } from "react";
import type { Message } from "@/types";

interface ChatMessageProps {
  message: Message;
}

interface Block {
  type: "text" | "code";
  content: string;
  language?: string;
}

function parseCodeBlocks(content: string): Block[] {
  const blocks: Block[] = [];
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

  return blocks.length > 0 ? blocks : [{ type: "text", content }];
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const blocks = useMemo(() => parseCodeBlocks(message.content || ""), [message.content]);

  const copyCode = useCallback((code: string) => {
    navigator.clipboard?.writeText(code);
  }, []);

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-1"
          style={{ background: isTool ? "var(--warning)" : "var(--accent)", color: "white" }}
        >
          {isTool ? "T" : "AI"}
        </div>
      )}

      <div
        className="max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed"
        style={{
          background: isUser ? "var(--bg-tertiary)" : "var(--bg-surface)",
          border: "1px solid var(--border)",
        }}
      >
        {blocks.map((block, i) =>
          block.type === "text" ? (
            <p
              key={i}
              className={`whitespace-pre-wrap ${
                isUser ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
              }`}
            >
              {block.content}
            </p>
          ) : (
            <div key={i} className="my-2 rounded overflow-hidden" style={{ background: "var(--code-bg)" }}>
              <div
                className="flex items-center justify-between px-3 py-1.5 text-xs"
                style={{ background: "rgba(255,255,255,0.05)" }}
              >
                <span className="text-[var(--text-muted)]">{block.language || "code"}</span>
                <button
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  onClick={() => copyCode(block.content)}
                >
                  Copy
                </button>
              </div>
              <pre className="px-3 py-2 text-xs overflow-x-auto">
                <code className="text-[var(--text-primary)]">{block.content}</code>
              </pre>
            </div>
          ),
        )}

        {message.isStreaming && (
          <span
            className="inline-block w-1.5 h-4 ml-0.5 animate-pulse"
            style={{ background: "var(--accent)" }}
          />
        )}
      </div>

      {isUser && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-1"
          style={{
            background: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          U
        </div>
      )}
    </div>
  );
}
