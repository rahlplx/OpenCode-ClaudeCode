import { ref, computed, watch, type Ref } from "vue";
import { api } from "@/api/gateway";
import type {
  Session,
  Message,
  Model,
  Notification,
  ServerRequest,
  ProviderType,
} from "@/types";

const EVENT_SYNC_DEBOUNCE_MS = 220;

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(`occ.${key}`);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown): void {
  localStorage.setItem(`occ.${key}`, JSON.stringify(value));
}

export function useAgentState() {
  // --- Core State ---
  const sessions = ref<Session[]>([]);
  const selectedSessionId: Ref<string | null> = ref(
    loadFromStorage<string | null>("selected-session", null),
  );
  const persistedMessages = ref<Map<string, Message[]>>(new Map());
  const liveStreamMessages = ref<Map<string, Message[]>>(new Map());

  // --- Models & Provider ---
  const availableModels = ref<Model[]>([]);
  const selectedModelBySession = ref<Map<string, string>>(
    new Map(
      Object.entries(
        loadFromStorage<Record<string, string>>("model-preferences", {}),
      ),
    ),
  );
  const activeProvider = ref<ProviderType>(
    loadFromStorage<ProviderType>("provider", "zen"),
  );

  // --- UI State ---
  const sidebarCollapsed = ref(
    loadFromStorage<boolean>("sidebar-collapsed", false),
  );
  const pendingApprovals = ref<ServerRequest[]>([]);
  const isGenerating = ref<Map<string, boolean>>(new Map());
  const errorState = ref<string | null>(null);
  const inputText = ref("");

  // --- WebSocket ---
  let ws: WebSocket | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Computed ---
  const selectedSession = computed(() =>
    sessions.value.find((s) => s.id === selectedSessionId.value) || null,
  );

  const currentMessages = computed((): Message[] => {
    const sid = selectedSessionId.value;
    if (!sid) return [];
    const persisted = persistedMessages.value.get(sid) || [];
    const live = liveStreamMessages.value.get(sid) || [];
    return [...persisted, ...live];
  });

  const currentModel = computed(() => {
    const sid = selectedSessionId.value;
    if (!sid) return availableModels.value[0]?.id || "";
    return selectedModelBySession.value.get(sid) || availableModels.value[0]?.id || "";
  });

  const isCurrentSessionGenerating = computed(() => {
    const sid = selectedSessionId.value;
    return sid ? isGenerating.value.get(sid) === true : false;
  });

  const sessionsByProject = computed(() => {
    const groups = new Map<string, Session[]>();
    for (const session of sessions.value) {
      const project = session.projectPath || "default";
      const list = groups.get(project) || [];
      list.push(session);
      groups.set(project, list);
    }
    return groups;
  });

  // --- Watchers ---
  watch(selectedSessionId, (id) => {
    saveToStorage("selected-session", id);
  });

  watch(sidebarCollapsed, (val) => {
    saveToStorage("sidebar-collapsed", val);
  });

  watch(activeProvider, (val) => {
    saveToStorage("provider", val);
  });

  // --- Actions ---
  async function initialize(): Promise<void> {
    try {
      const [sessionList, models] = await Promise.all([
        api.listSessions().catch(() => [] as Session[]),
        api.listModels().catch(() => [] as Model[]),
      ]);

      sessions.value = sessionList;
      availableModels.value = models;

      connectNotifications();
    } catch (err) {
      errorState.value = err instanceof Error ? err.message : String(err);
    }
  }

  function connectNotifications(): void {
    ws = api.connectWebSocket(handleNotification);
  }

  function handleNotification(notification: Notification): void {
    switch (notification.type) {
      case "message.delta":
        applyMessageDelta(notification);
        break;
      case "message.complete":
        applyMessageComplete(notification);
        break;
      case "tool.request":
        applyToolRequest(notification);
        break;
      case "session.created":
      case "session.updated":
        queueSync();
        break;
      case "error":
        errorState.value = (notification.data as { message?: string })?.message || "Unknown error";
        break;
      case "rate_limit":
        handleRateLimit(notification);
        break;
    }
  }

  function applyMessageDelta(notification: Notification): void {
    const sid = notification.sessionId;
    if (!sid) return;

    const delta = notification.data as { text?: string; content?: string; id?: string };
    const text = delta.text || delta.content || "";
    if (!text) return;

    const live = liveStreamMessages.value.get(sid) || [];
    const lastMsg = live[live.length - 1];

    if (lastMsg && lastMsg.isStreaming) {
      lastMsg.content += text;
    } else {
      live.push({
        id: delta.id || `live-${Date.now()}`,
        sessionId: sid,
        role: "assistant",
        content: text,
        timestamp: Date.now(),
        isStreaming: true,
      });
    }

    liveStreamMessages.value.set(sid, [...live]);
  }

  function applyMessageComplete(notification: Notification): void {
    const sid = notification.sessionId;
    if (!sid) return;

    const message = notification.data as Message;
    const persisted = persistedMessages.value.get(sid) || [];
    persisted.push({ ...message, isStreaming: false });
    persistedMessages.value.set(sid, [...persisted]);

    liveStreamMessages.value.set(sid, []);
    isGenerating.value.set(sid, false);
  }

  function applyToolRequest(notification: Notification): void {
    const request = notification.data as ServerRequest;
    pendingApprovals.value = [...pendingApprovals.value, request];
  }

  function handleRateLimit(notification: Notification): void {
    const data = notification.data as {
      provider: ProviderType;
      retryAfter?: number;
    };
    errorState.value = `Rate limited by ${data.provider}. ${
      data.retryAfter ? `Retry after ${data.retryAfter}s` : "Please wait."
    }`;
  }

  function queueSync(): void {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        sessions.value = await api.listSessions();
      } catch {
        // silent sync failure
      }
    }, EVENT_SYNC_DEBOUNCE_MS);
  }

  async function selectSession(sessionId: string): Promise<void> {
    selectedSessionId.value = sessionId;
    errorState.value = null;

    if (!persistedMessages.value.has(sessionId)) {
      // Messages would be loaded from the session
      // For now, initialize empty
      persistedMessages.value.set(sessionId, []);
    }
  }

  async function createSession(projectPath?: string): Promise<Session> {
    const optimisticId = `temp-${Date.now()}`;
    const optimistic: Session = {
      id: optimisticId,
      title: "New Session",
      projectPath: projectPath || "/",
      modelId: currentModel.value,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
      inProgress: false,
    };

    sessions.value = [optimistic, ...sessions.value];
    selectedSessionId.value = optimisticId;

    try {
      const session = (await api.createSession(
        optimistic.projectPath,
        currentModel.value,
      )) as Session;

      sessions.value = sessions.value.map((s) =>
        s.id === optimisticId ? session : s,
      );
      selectedSessionId.value = session.id;
      return session;
    } catch (err) {
      sessions.value = sessions.value.filter((s) => s.id !== optimisticId);
      throw err;
    }
  }

  async function sendMessage(content: string): Promise<void> {
    let sid = selectedSessionId.value;
    if (!sid) {
      const session = await createSession();
      sid = session.id;
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      sessionId: sid,
      role: "user",
      content,
      timestamp: Date.now(),
    };

    const persisted = persistedMessages.value.get(sid) || [];
    persisted.push(userMessage);
    persistedMessages.value.set(sid, [...persisted]);

    isGenerating.value.set(sid, true);
    errorState.value = null;
    inputText.value = "";

    try {
      const response = await api.sendMessage(sid, content, (delta) => {
        applyMessageDelta({
          type: "message.delta",
          data: { text: delta },
          sessionId: sid!,
        });
      });

      applyMessageComplete({
        type: "message.complete",
        data: response,
        sessionId: sid,
      });
    } catch (err) {
      isGenerating.value.set(sid, false);
      errorState.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function abortGeneration(): Promise<void> {
    const sid = selectedSessionId.value;
    if (!sid) return;

    try {
      await api.abortGeneration(sid);
      isGenerating.value.set(sid, false);
      liveStreamMessages.value.set(sid, []);
    } catch {
      // best effort
    }
  }

  async function approveRequest(requestId: string): Promise<void> {
    await api.respondToServerRequest(requestId, true);
    pendingApprovals.value = pendingApprovals.value.filter(
      (r) => r.id !== requestId,
    );
  }

  async function denyRequest(requestId: string): Promise<void> {
    await api.respondToServerRequest(requestId, false);
    pendingApprovals.value = pendingApprovals.value.filter(
      (r) => r.id !== requestId,
    );
  }

  function setModel(sessionId: string, modelId: string): void {
    selectedModelBySession.value.set(sessionId, modelId);
    saveToStorage(
      "model-preferences",
      Object.fromEntries(selectedModelBySession.value),
    );
  }

  function setProvider(provider: ProviderType): void {
    activeProvider.value = provider;
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function clearError(): void {
    errorState.value = null;
  }

  return {
    // State
    sessions,
    selectedSessionId,
    selectedSession,
    currentMessages,
    availableModels,
    currentModel,
    activeProvider,
    sidebarCollapsed,
    pendingApprovals,
    isCurrentSessionGenerating,
    sessionsByProject,
    errorState,
    inputText,

    // Actions
    initialize,
    selectSession,
    createSession,
    sendMessage,
    abortGeneration,
    approveRequest,
    denyRequest,
    setModel,
    setProvider,
    toggleSidebar,
    clearError,
  };
}
