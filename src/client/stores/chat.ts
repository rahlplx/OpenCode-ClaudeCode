import { create } from "zustand";
import type { Message, ServerRequest, Notification, ProviderType } from "@/types";
import { api } from "@/client/api";
import { useSessionsStore } from "./sessions";

interface ChatState {
  messagesBySession: Map<string, Message[]>;
  liveMessages: Map<string, Message[]>;
  pendingApprovals: ServerRequest[];
  generatingSessions: Set<string>;
  error: string | null;
  inputText: string;
  activeProvider: ProviderType;

  currentMessages: () => Message[];
  isGenerating: () => boolean;
  sendMessage: (content: string) => Promise<void>;
  abortGeneration: () => Promise<void>;
  approveRequest: (requestId: string) => Promise<void>;
  denyRequest: (requestId: string) => Promise<void>;
  setProvider: (provider: ProviderType) => void;
  setInputText: (text: string) => void;
  clearError: () => void;
  handleNotification: (notification: Notification) => void;
}

const SYNC_DEBOUNCE_MS = 220;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  messagesBySession: new Map(),
  liveMessages: new Map(),
  pendingApprovals: [],
  generatingSessions: new Set(),
  error: null,
  inputText: "",
  activeProvider: "zen",

  currentMessages() {
    const sid = useSessionsStore.getState().selectedId;
    if (!sid) return [];
    const persisted = get().messagesBySession.get(sid) || [];
    const live = get().liveMessages.get(sid) || [];
    return [...persisted, ...live];
  },

  isGenerating() {
    const sid = useSessionsStore.getState().selectedId;
    return sid ? get().generatingSessions.has(sid) : false;
  },

  async sendMessage(content: string) {
    let sid = useSessionsStore.getState().selectedId;
    if (!sid) {
      const session = await useSessionsStore.getState().create();
      sid = session.id;
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      sessionId: sid,
      role: "user",
      content,
      timestamp: Date.now(),
    };

    set((s) => {
      const msgs = new Map(s.messagesBySession);
      const existing = msgs.get(sid!) || [];
      msgs.set(sid!, [...existing, userMessage]);
      const generating = new Set(s.generatingSessions);
      generating.add(sid!);
      return {
        messagesBySession: msgs,
        generatingSessions: generating,
        error: null,
        inputText: "",
      };
    });

    try {
      const response = await api.sendMessage(sid, content, (delta) => {
        get().handleNotification({
          type: "message.delta",
          data: { text: delta },
          sessionId: sid!,
        });
      });

      get().handleNotification({
        type: "message.complete",
        data: response,
        sessionId: sid!,
      });
    } catch (err) {
      set((s) => {
        const generating = new Set(s.generatingSessions);
        generating.delete(sid!);
        return {
          generatingSessions: generating,
          error: err instanceof Error ? err.message : String(err),
        };
      });
    }
  },

  async abortGeneration() {
    const sid = useSessionsStore.getState().selectedId;
    if (!sid) return;
    try {
      await api.abortGeneration(sid);
      set((s) => {
        const generating = new Set(s.generatingSessions);
        generating.delete(sid);
        const live = new Map(s.liveMessages);
        live.set(sid, []);
        return { generatingSessions: generating, liveMessages: live };
      });
    } catch {
      // best effort
    }
  },

  async approveRequest(requestId: string) {
    await api.respondToServerRequest(requestId, true);
    set((s) => ({
      pendingApprovals: s.pendingApprovals.filter((r) => r.id !== requestId),
    }));
  },

  async denyRequest(requestId: string) {
    await api.respondToServerRequest(requestId, false);
    set((s) => ({
      pendingApprovals: s.pendingApprovals.filter((r) => r.id !== requestId),
    }));
  },

  setProvider(provider: ProviderType) {
    set({ activeProvider: provider });
  },

  setInputText(text: string) {
    set({ inputText: text });
  },

  clearError() {
    set({ error: null });
  },

  handleNotification(notification: Notification) {
    switch (notification.type) {
      case "message.delta": {
        const sid = notification.sessionId;
        if (!sid) return;
        const delta = notification.data as { text?: string; content?: string; id?: string };
        const text = delta.text || delta.content || "";
        if (!text) return;

        set((s) => {
          const live = new Map(s.liveMessages);
          const msgs = [...(live.get(sid) || [])];
          const last = msgs[msgs.length - 1];

          if (last?.isStreaming) {
            msgs[msgs.length - 1] = { ...last, content: last.content + text };
          } else {
            msgs.push({
              id: delta.id || `live-${Date.now()}`,
              sessionId: sid,
              role: "assistant",
              content: text,
              timestamp: Date.now(),
              isStreaming: true,
            });
          }
          live.set(sid, msgs);
          return { liveMessages: live };
        });
        break;
      }

      case "message.complete": {
        const sid = notification.sessionId;
        if (!sid) return;
        const message = notification.data as Message;

        set((s) => {
          const msgs = new Map(s.messagesBySession);
          const existing = msgs.get(sid) || [];
          msgs.set(sid, [...existing, { ...message, isStreaming: false }]);

          const live = new Map(s.liveMessages);
          live.set(sid, []);

          const generating = new Set(s.generatingSessions);
          generating.delete(sid);

          return {
            messagesBySession: msgs,
            liveMessages: live,
            generatingSessions: generating,
          };
        });
        break;
      }

      case "tool.request": {
        const request = notification.data as ServerRequest;
        set((s) => ({
          pendingApprovals: [...s.pendingApprovals, request],
        }));
        break;
      }

      case "session.created":
      case "session.updated": {
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
          useSessionsStore.getState().load();
        }, SYNC_DEBOUNCE_MS);
        break;
      }

      case "error": {
        const data = notification.data as { message?: string };
        set({ error: data?.message || "Unknown error" });
        break;
      }

      case "rate_limit": {
        const data = notification.data as { provider: ProviderType; retryAfter?: number };
        set({
          error: `Rate limited by ${data.provider}. ${
            data.retryAfter ? `Retry after ${data.retryAfter}s` : "Please wait."
          }`,
        });
        break;
      }
    }
  },
}));
