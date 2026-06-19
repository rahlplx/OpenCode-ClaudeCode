import { useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { useChatStore } from "@/client/stores/chat";
import { ChatMessage } from "./ChatMessage";
import { ApprovalDialog } from "./ApprovalDialog";

export function ChatPanel() {
  const messages = useChatStore((s) => s.currentMessages());
  const isGenerating = useChatStore((s) => s.isGenerating());
  const pendingApprovals = useChatStore((s) => s.pendingApprovals);
  const error = useChatStore((s) => s.error);
  const inputText = useChatStore((s) => s.inputText);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortGeneration = useChatStore((s) => s.abortGeneration);
  const approveRequest = useChatStore((s) => s.approveRequest);
  const denyRequest = useChatStore((s) => s.denyRequest);
  const clearError = useChatStore((s) => s.clearError);
  const setInputText = useChatStore((s) => s.setInputText);

  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = messagesRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, messages[messages.length - 1]?.content, scrollToBottom]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const content = inputText.trim();
    if (!content || isGenerating) return;
    sendMessage(content);
  }, [inputText, isGenerating, sendMessage]);

  const handleKeydown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        ref={messagesRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        style={{ background: "var(--bg-primary)" }}
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-4 opacity-20">&#9679;</div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              OpenCode-ClaudeCode
            </h2>
            <p className="text-sm text-[var(--text-muted)] max-w-md">
              AI coding agent powered by OpenCode. Free AI tokens via Zen API and OpenRouter.
              Start typing to begin.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {isGenerating && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <span className="inline-flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: "0.15s" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: "0.3s" }} />
            </span>
            Generating...
          </div>
        )}
      </div>

      {pendingApprovals.map((request) => (
        <ApprovalDialog
          key={request.id}
          request={request}
          onApprove={approveRequest}
          onDeny={denyRequest}
        />
      ))}

      {error && (
        <div
          className="mx-4 mb-2 px-3 py-2 rounded text-sm flex items-center justify-between"
          style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid var(--error)" }}
        >
          <span className="text-[var(--error)]">{error}</span>
          <button
            className="text-[var(--error)] hover:text-[var(--accent-hover)] text-xs"
            onClick={clearError}
          >
            Dismiss
          </button>
        </div>
      )}

      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
      >
        <div
          className="flex items-end gap-2 rounded-lg border px-3 py-2"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
        >
          <textarea
            ref={textareaRef}
            value={inputText}
            placeholder="Send a message... (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            style={{ maxHeight: 200 }}
            onChange={(e) => {
              setInputText(e.target.value);
              autoResize();
            }}
            onKeyDown={handleKeydown}
          />

          {isGenerating ? (
            <button
              className="p-1.5 rounded text-[var(--error)] hover:bg-[rgba(239,68,68,0.1)]"
              title="Stop generation"
              onClick={abortGeneration}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className={`p-1.5 rounded transition-colors ${
                inputText.trim()
                  ? "text-[var(--accent)] hover:bg-[rgba(233,69,96,0.1)]"
                  : "text-[var(--text-muted)] cursor-not-allowed"
              }`}
              disabled={!inputText.trim()}
              title="Send message"
              onClick={handleSend}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
