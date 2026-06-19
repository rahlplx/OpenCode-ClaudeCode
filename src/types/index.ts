export interface Session {
  id: string;
  title: string;
  projectPath: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  inProgress: boolean;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  isStreaming?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "approved" | "denied" | "completed" | "error";
}

export interface ToolResult {
  callId: string;
  output: string;
  error?: string;
}

export interface ServerRequest {
  id: string;
  sessionId: string;
  type: "command" | "file_write" | "file_read" | "tool";
  description: string;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "denied";
}

export interface Model {
  id: string;
  name: string;
  provider: ProviderType;
  isFree: boolean;
  contextWindow?: number;
}

export type ProviderType = "zen" | "openrouter" | "custom";

export interface ProviderConfig {
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  wireApi: "responses" | "chat";
}

export interface ProviderStatus {
  type: ProviderType;
  connected: boolean;
  rateLimited: boolean;
  retryAfter?: number;
  error?: string;
}

export type NotificationType =
  | "session.created"
  | "message.delta"
  | "message.complete"
  | "tool.request"
  | "tool.result"
  | "error"
  | "rate_limit"
  | "session.updated";

export interface Notification {
  type: NotificationType;
  data: unknown;
  sessionId?: string;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface AppConfig {
  port: number;
  host: string;
  password?: string;
  noPassword: boolean;
  opencodePath?: string;
  provider: ProviderConfig;
}
