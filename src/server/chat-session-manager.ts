import { randomBytes } from "crypto";
import type {
  ChatSnapshot,
  ChatRuntime,
  SidebarData,
  SidebarProjectGroup,
  SidebarChatRow,
  TranscriptEntry,
  AgentProvider,
  ProviderCatalogEntry,
  UserPromptEntry,
  AssistantTextEntry,
  ResultEntry,
} from "../shared/types.js";
import { PROVIDERS } from "../shared/types.js";

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

interface ChatRecord {
  snapshot: ChatSnapshot;
  userId: string;
  createdAt: number;
  updatedAt: number;
}

export class ChatSessionManager {
  private chats = new Map<string, ChatRecord>();

  createChat(projectId: string, userId: string): ChatSnapshot {
    const chatId = generateId("chat");
    const now = Date.now();

    const runtime: ChatRuntime = {
      chatId,
      projectId,
      localPath: "",
      title: "New Chat",
      status: "idle",
      isDraining: false,
      provider: null,
      planMode: false,
      sessionToken: null,
    };

    const snapshot: ChatSnapshot = {
      runtime,
      queuedMessages: [],
      messages: [],
      history: {
        hasOlder: false,
        olderCursor: null,
        recentLimit: 50,
      },
      availableProviders: this.getAvailableProviders(),
    };

    this.chats.set(chatId, {
      snapshot,
      userId,
      createdAt: now,
      updatedAt: now,
    });

    return snapshot;
  }

  getChat(chatId: string): ChatSnapshot | null {
    return this.chats.get(chatId)?.snapshot ?? null;
  }

  getChatOwner(chatId: string): string | null {
    return this.chats.get(chatId)?.userId ?? null;
  }

  canAccess(chatId: string, userId: string): boolean {
    const record = this.chats.get(chatId);
    return record ? record.userId === userId : false;
  }

  addUserMessage(chatId: string, content: string, provider: AgentProvider, model: string): void {
    const record = this.chats.get(chatId);
    if (!record) return;

    const entry: UserPromptEntry = {
      _id: generateId("msg"),
      kind: "user_prompt",
      content,
      createdAt: Date.now(),
    };

    record.snapshot.messages.push(entry as TranscriptEntry);
    record.snapshot.runtime.status = "running";
    record.snapshot.runtime.provider = provider;
    record.updatedAt = Date.now();
  }

  addAssistantText(chatId: string, text: string): void {
    const record = this.chats.get(chatId);
    if (!record) return;

    const entry: AssistantTextEntry = {
      _id: generateId("msg"),
      kind: "assistant_text",
      text,
      createdAt: Date.now(),
    };

    record.snapshot.messages.push(entry as TranscriptEntry);
    record.updatedAt = Date.now();
  }

  completeChat(chatId: string, durationMs: number): void {
    const record = this.chats.get(chatId);
    if (!record) return;

    const entry: ResultEntry = {
      _id: generateId("msg"),
      kind: "result",
      subtype: "success",
      isError: false,
      durationMs,
      result: "",
      createdAt: Date.now(),
    };

    record.snapshot.messages.push(entry as TranscriptEntry);
    record.snapshot.runtime.status = "idle";
    record.updatedAt = Date.now();
  }

  cancelChat(chatId: string): void {
    const record = this.chats.get(chatId);
    if (!record) return;

    record.snapshot.runtime.status = "idle";
    record.snapshot.runtime.isDraining = false;
    record.updatedAt = Date.now();
  }

  renameChat(chatId: string, title: string): void {
    const record = this.chats.get(chatId);
    if (!record) return;

    record.snapshot.runtime.title = title;
    record.updatedAt = Date.now();
  }

  deleteChat(chatId: string): void {
    this.chats.delete(chatId);
  }

  getSidebarData(userId: string): SidebarData {
    const grouped = new Map<string, SidebarChatRow[]>();

    for (const [, record] of this.chats) {
      if (record.userId !== userId) continue;

      const { runtime } = record.snapshot;
      const projectId = runtime.projectId;

      if (!grouped.has(projectId)) grouped.set(projectId, []);

      const row: SidebarChatRow = {
        _id: runtime.chatId,
        _creationTime: record.createdAt,
        chatId: runtime.chatId,
        title: runtime.title,
        status: runtime.status,
        unread: false,
        localPath: runtime.localPath,
        provider: runtime.provider,
        lastMessageAt: record.updatedAt,
        hasAutomation: false,
      };

      grouped.get(projectId)!.push(row);
    }

    const projectGroups: SidebarProjectGroup[] = [];
    for (const [projectId, chats] of grouped) {
      projectGroups.push({
        groupKey: projectId,
        title: projectId,
        realTitle: projectId,
        localPath: "",
        chats: chats.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)),
        previewChats: [],
        olderChats: [],
        defaultCollapsed: false,
      });
    }

    return { projectGroups };
  }

  private getAvailableProviders(): ProviderCatalogEntry[] {
    return PROVIDERS;
  }
}
