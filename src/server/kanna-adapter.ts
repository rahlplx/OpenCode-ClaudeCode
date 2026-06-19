import { WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type {
  ClientEnvelope,
  ServerEnvelope,
  SubscriptionTopic,
  ClientCommand,
} from "../shared/protocol.js";
import type { SidebarData, ChatSnapshot, AppSettingsSnapshot, KeybindingsSnapshot, UpdateSnapshot, LocalProjectsSnapshot } from "../shared/types.js";
import { isClientEnvelope } from "../shared/protocol.js";
import { parseCookies, getUserIdFromToken, COOKIE_NAME } from "./auth.js";

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

function sendSnapshot(ws: WebSocket, id: string, topic: SubscriptionTopic): void {
  switch (topic.type) {
    case "sidebar":
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "sidebar", data: sidebarState },
      });
      break;
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
    case "chat":
      sendEnvelope(ws, {
        v: 1,
        type: "snapshot",
        id,
        snapshot: { type: "chat", data: null },
      });
      break;
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
    case "settings.writeAppSettingsPatch":
      Object.assign(defaultAppSettings, command.patch);
      sendEnvelope(client.ws, { v: 1, type: "ack", id, result: defaultAppSettings });
      broadcastToSubscribers("app-settings", { type: "app-settings", data: defaultAppSettings });
      break;
    case "settings.readKeybindings":
      sendEnvelope(client.ws, { v: 1, type: "ack", id, result: defaultKeybindings });
      break;
    case "settings.readLlmProvider":
      sendEnvelope(client.ws, {
        v: 1,
        type: "ack",
        id,
        result: {
          provider: "custom",
          apiKey: "",
          model: "",
          baseUrl: "",
          resolvedBaseUrl: "",
          enabled: false,
          warning: null,
          filePathDisplay: "~/.opencode/llm-provider.json",
        },
      });
      break;
    case "settings.writeLlmProvider":
      sendEnvelope(client.ws, {
        v: 1,
        type: "ack",
        id,
        result: {
          provider: command.provider,
          apiKey: command.apiKey,
          model: command.model,
          baseUrl: command.baseUrl,
          resolvedBaseUrl: command.baseUrl,
          enabled: true,
          warning: null,
          filePathDisplay: "~/.opencode/llm-provider.json",
        },
      });
      break;
    case "settings.validateLlmProvider":
      sendEnvelope(client.ws, {
        v: 1,
        type: "ack",
        id,
        result: { ok: true, error: null },
      });
      break;
    case "chat.setDraftProtection":
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

function broadcastToSubscribers(topicType: string, snapshot: { type: string; data: unknown }): void {
  for (const client of clients.values()) {
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
        sendSnapshot(ws, envelope.id, envelope.topic);
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
