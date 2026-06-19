import { WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type {
  ClientEnvelope,
  ServerEnvelope,
  SubscriptionTopic,
  ClientCommand,
} from "../shared/protocol.js";
import type { SidebarData, ChatSnapshot, AppSettingsSnapshot, KeybindingsSnapshot, UpdateSnapshot, LocalProjectsSnapshot, LlmProviderKind, AgentProvider } from "../shared/types.js";
import { isClientEnvelope } from "../shared/protocol.js";
import { parseCookies, getUserIdFromToken, COOKIE_NAME } from "./auth.js";
import { ProviderConfigManager } from "./provider-config.js";
import { ChatSessionManager } from "./chat-session-manager.js";
import { circuitBreaker } from "./proxy.js";

interface SubscriptionState {
  id: string;
  topic: SubscriptionTopic;
}

interface KannaClient {
  ws: WebSocket;
  userId: string;
  subscriptions: Map<string, SubscriptionState>;
}

const clients = new Map<WebSocket, KannaClient>();

export const providerConfigManager = new ProviderConfigManager();
export const chatSessionManager = new ChatSessionManager();

const sidebarState: SidebarData = { projectGroups: [] };

const defaultAppSettings: AppSettingsSnapshot = {
  analyticsEnabled: false,
  browserSettingsMigrated: true,
  theme: "system",
  chatSoundPreference: "never",
  chatSoundId: "pop",
  terminal: {
    scrollbackLines: 5000,
    minColumnWidth: 80,
  },
  editor: {
    preset: "vscode",
    commandTemplate: "code --goto ${file}:${line}:${column}",
  },
  defaultProvider: "last_used",
  providerDefaults: {
    claude: {
      model: "claude-sonnet-4-6",
      modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
      planMode: false,
    },
    codex: {
      model: "gpt-5.5",
      modelOptions: { reasoningEffort: "high", fastMode: false },
      planMode: false,
    },
  },
  warning: null,
  filePathDisplay: "~/.opencode/settings.json",
};

const defaultKeybindings: KeybindingsSnapshot = {
  bindings: {
    toggleEmbeddedTerminal: ["cmd+j", "ctrl+`"],
    toggleRightSidebar: ["cmd+b", "ctrl+b"],
    openInFinder: ["cmd+alt+f", "ctrl+alt+f"],
    openInEditor: ["cmd+shift+o", "ctrl+shift+o"],
    addSplitTerminal: ["cmd+/", "ctrl+/"],
    jumpToSidebarChat: ["cmd+alt"],
    createChatInCurrentProject: ["cmd+alt+n"],
    openAddProject: ["cmd+alt+o"],
  },
  warning: null,
  filePathDisplay: "~/.opencode/keybindings.json",
};

const defaultUpdateSnapshot: UpdateSnapshot = {
  currentVersion: process.env.npm_package_version || "0.1.0",
  latestVersion: null,
  status: "idle",
  updateAvailable: false,
  lastCheckedAt: null,
  error: null,
  installAction: "reload",
  reloadRequestedAt: null,
};

const defaultLocalProjects: LocalProjectsSnapshot = {
  machine: {
    id: "local",
    displayName: "Local Machine",
    platform: process.platform,
  },
  projects: [],
};

function sendEnvelope(ws: WebSocket, envelope: ServerEnvelope): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(envelope));
  }
}

function sendSnapshot(ws: WebSocket, id: string, topic: SubscriptionTopic, userId?: string): void {
  switch (topic.type) {
    case "sidebar": {
      const data = userId ? chatSessionManager.getSidebarData(userId) : sidebarState;
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "sidebar", data },
      });
      break;
    }
    case "app-settings":
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "app-settings", data: defaultAppSettings },
      });
      break;
    case "keybindings":
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "keybindings", data: defaultKeybindings },
      });
      break;
    case "update":
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "update", data: defaultUpdateSnapshot },
      });
      break;
    case "local-projects":
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "local-projects", data: defaultLocalProjects },
      });
      break;
    case "chat": {
      const chatData = chatSessionManager.getChat(topic.chatId);
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "chat", data: chatData },
      });
      break;
    }
    case "project-git":
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "project-git", data: null },
      });
      break;
    case "terminal":
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "terminal", data: null },
      });
      break;
  }
}

function handleCommand(client: KannaClient, id: string, command: ClientCommand): void {
  switch (command.type) {
    case "system.ping":
      sendEnvelope(client.ws, { v: 1, type: "ack", id });
      break;
    case "update.check":
      sendEnvelope(client.ws, { v: 1, type: "ack", id, result: defaultUpdateSnapshot });
      break;
    case "settings.readAppSettings":
      sendEnvelope(client.ws, { v: 1, type: "ack", id, result: defaultAppSettings });
      break;
    case "settings.writeAppSettingsPatch": {
      const ALLOWED_PATCH_KEYS = new Set([
        "theme", "chatSoundPreference", "chatSoundId", "terminal",
        "editor", "defaultProvider", "providerDefaults", "analyticsEnabled",
      ]);
      const safePatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(command.patch as Record<string, unknown>)) {
        if (ALLOWED_PATCH_KEYS.has(key)) safePatch[key] = value;
      }
      Object.assign(defaultAppSettings, safePatch);
      sendEnvelope(client.ws, { v: 1, type: "ack", id, result: defaultAppSettings });
      broadcastToSubscribers("app-settings", { type: "app-settings", data: defaultAppSettings }, client.userId);
      break;
    }
    case "settings.readKeybindings":
      sendEnvelope(client.ws, { v: 1, type: "ack", id, result: defaultKeybindings });
      break;
    case "settings.readLlmProvider":
      sendEnvelope(client.ws, {
        v: 1,
        type: "ack",
        id,
        result: providerConfigManager.getSnapshot(),
      });
      break;
    case "settings.writeLlmProvider": {
      const snapshot = providerConfigManager.writeLlmProvider({
        provider: command.provider as LlmProviderKind,
        apiKey: command.apiKey,
        model: command.model,
        baseUrl: command.baseUrl,
      });
      sendEnvelope(client.ws, {
        v: 1,
        type: "ack",
        id,
        result: snapshot,
      });
      break;
    }
    case "settings.validateLlmProvider": {
      const validation = providerConfigManager.validateLlmProvider({
        provider: command.provider as LlmProviderKind,
        apiKey: command.apiKey,
        model: command.model,
        baseUrl: command.baseUrl,
      });
      sendEnvelope(client.ws, {
        v: 1,
        type: "ack",
        id,
        result: validation,
      });
      break;
    }
    case "chat.create": {
      const snapshot = chatSessionManager.createChat(command.projectId, client.userId);
      sendEnvelope(client.ws, { v: 1, type: "ack", id, result: snapshot });
      updateSidebarForUser(client);
      broadcastChatSnapshot(client, snapshot.runtime.chatId);
      break;
    }
    case "chat.send": {
      const chatId = command.chatId;
      if (chatId && !chatSessionManager.canAccess(chatId, client.userId)) {
        sendEnvelope(client.ws, { v: 1, type: "error", id, message: "Access denied" });
        break;
      }
      let targetChatId = chatId;
      if (!targetChatId && command.projectId) {
        const newChat = chatSessionManager.createChat(command.projectId, client.userId);
        targetChatId = newChat.runtime.chatId;
        updateSidebarForUser(client);
      }
      if (!targetChatId) {
        sendEnvelope(client.ws, { v: 1, type: "error", id, message: "No chat or project specified" });
        break;
      }
      const provider = (command.provider as AgentProvider) || "claude";
      const model = command.model || "claude-sonnet-4-6";
      chatSessionManager.addUserMessage(targetChatId, command.content, provider, model);
      sendEnvelope(client.ws, { v: 1, type: "ack", id });
      broadcastChatSnapshot(client, targetChatId);
      handleChatRequest(client, targetChatId, command.content, provider, model);
      break;
    }
    case "chat.cancel": {
      if (!chatSessionManager.canAccess(command.chatId, client.userId)) {
        sendEnvelope(client.ws, { v: 1, type: "error", id, message: "Access denied" });
        break;
      }
      chatSessionManager.cancelChat(command.chatId);
      sendEnvelope(client.ws, { v: 1, type: "ack", id });
      broadcastChatSnapshot(client, command.chatId);
      break;
    }
    case "chat.rename": {
      if (!chatSessionManager.canAccess(command.chatId, client.userId)) {
        sendEnvelope(client.ws, { v: 1, type: "error", id, message: "Access denied" });
        break;
      }
      chatSessionManager.renameChat(command.chatId, command.title);
      sendEnvelope(client.ws, { v: 1, type: "ack", id });
      updateSidebarForUser(client);
      break;
    }
    case "chat.delete": {
      if (!chatSessionManager.canAccess(command.chatId, client.userId)) {
        sendEnvelope(client.ws, { v: 1, type: "error", id, message: "Access denied" });
        break;
      }
      chatSessionManager.deleteChat(command.chatId);
      sendEnvelope(client.ws, { v: 1, type: "ack", id });
      updateSidebarForUser(client);
      break;
    }
    case "chat.archive":
    case "chat.unarchive":
    case "chat.markRead":
    case "chat.setDraftProtection":
    case "chat.fork":
      sendEnvelope(client.ws, { v: 1, type: "ack", id });
      break;
    default:
      sendEnvelope(client.ws, {
        v: 1,
        type: "error",
        id,
        message: `Command not yet implemented: ${command.type}`,
      });
  }
}

function broadcastToSubscribers(topicType: string, snapshot: { type: string; data: unknown }, senderUserId?: string): void {
  for (const client of clients.values()) {
    if (senderUserId && client.userId !== senderUserId) continue;
    for (const [subId, sub] of client.subscriptions) {
      if (sub.topic.type === topicType) {
        sendEnvelope(client.ws, {
          v: 1,
          type: "snapshot",
          id: subId,
          snapshot: snapshot as ServerEnvelope extends { type: "snapshot"; snapshot: infer S } ? S : never,
        });
      }
    }
  }
}

function broadcastChatSnapshot(client: KannaClient, chatId: string): void {
  const snapshot = chatSessionManager.getChat(chatId);
  for (const c of clients.values()) {
    if (c.userId !== client.userId) continue;
    for (const [subId, sub] of c.subscriptions) {
      if (sub.topic.type === "chat" && sub.topic.chatId === chatId) {
        sendEnvelope(c.ws, {
          v: 1,
          type: "snapshot",
          id: subId,
          snapshot: { type: "chat", data: snapshot },
        });
      }
    }
  }
}

function updateSidebarForUser(client: KannaClient): void {
  const sidebarData = chatSessionManager.getSidebarData(client.userId);
  for (const c of clients.values()) {
    if (c.userId !== client.userId) continue;
    for (const [subId, sub] of c.subscriptions) {
      if (sub.topic.type === "sidebar") {
        sendEnvelope(c.ws, {
          v: 1,
          type: "snapshot",
          id: subId,
          snapshot: { type: "sidebar", data: sidebarData },
        });
      }
    }
  }
}

async function handleChatRequest(
  client: KannaClient,
  chatId: string,
  content: string,
  provider: AgentProvider,
  model: string,
): Promise<void> {
  const activeConfig = providerConfigManager.getActiveConfig();
  const chain = providerConfigManager.getFailoverChain();
  const startTime = Date.now();

  const requestBody = {
    model: model || activeConfig.model,
    messages: [{ role: "user" as const, content }],
    stream: false,
  };

  for (const providerKey of chain) {
    if (!circuitBreaker.isAvailable(providerKey)) continue;

    const proxyEntry = providerConfigManager.getProxyEntry(providerKey);
    if (!proxyEntry || !proxyEntry.apiKey) continue;

    try {
      const res = await fetch(proxyEntry.chatUrl, {
        method: "POST",
        headers: proxyEntry.buildHeaders(proxyEntry.apiKey),
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          circuitBreaker.recordFailure(providerKey);
          continue;
        }
        chatSessionManager.addAssistantText(chatId, `Provider returned ${res.status}`);
        chatSessionManager.completeChat(chatId, Date.now() - startTime);
        broadcastChatSnapshot(client, chatId);
        return;
      }

      circuitBreaker.recordSuccess(providerKey);
      const json = await res.json() as Record<string, unknown>;
      const choices = (json.choices as Array<Record<string, unknown>>) || [];
      const message = choices[0]?.message as Record<string, unknown> | undefined;
      const responseText = (message?.content as string) || "No response from provider.";

      chatSessionManager.addAssistantText(chatId, responseText);
      chatSessionManager.completeChat(chatId, Date.now() - startTime);
      broadcastChatSnapshot(client, chatId);
      return;
    } catch {
      circuitBreaker.recordFailure(providerKey);
    }
  }

  chatSessionManager.addAssistantText(chatId, "No provider available. Configure a provider in Settings → LLM Provider.");
  chatSessionManager.completeChat(chatId, 0);
  broadcastChatSnapshot(client, chatId);
}

export function handleKannaConnection(ws: WebSocket, req: IncomingMessage, noPassword: boolean): void {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[COOKIE_NAME];
  const userId = noPassword ? "default" : getUserIdFromToken(token);

  if (!userId) {
    ws.close(1008, "Unauthorized");
    return;
  }

  const client: KannaClient = {
    ws,
    userId,
    subscriptions: new Map(),
  };

  clients.set(ws, client);

  ws.on("message", (data) => {
    let envelope: ClientEnvelope;
    try {
      const parsed = JSON.parse(String(data));
      if (!isClientEnvelope(parsed)) return;
      envelope = parsed;
    } catch {
      return;
    }

    switch (envelope.type) {
      case "subscribe": {
        client.subscriptions.set(envelope.id, {
          id: envelope.id,
          topic: envelope.topic,
        });
        sendSnapshot(ws, envelope.id, envelope.topic, client.userId);
        break;
      }
      case "unsubscribe": {
        client.subscriptions.delete(envelope.id);
        break;
      }
      case "command": {
        handleCommand(client, envelope.id, envelope.command);
        break;
      }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
}
