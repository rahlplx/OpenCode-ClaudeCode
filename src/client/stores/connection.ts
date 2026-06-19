import { create } from "zustand";
import type { Notification } from "@/types";

interface ConnectionState {
  status: "connecting" | "connected" | "disconnected";
  ws: WebSocket | null;
  reconnectAttempt: number;
  listeners: Set<(notification: Notification) => void>;

  connect: () => void;
  disconnect: () => void;
  addListener: (fn: (notification: Notification) => void) => () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => {
  let wsRef: WebSocket | null = null;

  function scheduleReconnect() {
    const attempt = get().reconnectAttempt;
    const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30_000);
    const jitter = Math.random() * baseDelay * 0.3;
    set({ reconnectAttempt: attempt + 1, status: "disconnected" });
    setTimeout(() => get().connect(), baseDelay + jitter);
  }

  return {
    status: "disconnected",
    ws: null,
    reconnectAttempt: 0,
    listeners: new Set(),

    connect() {
      if (wsRef && wsRef.readyState <= WebSocket.OPEN) return;

      set({ status: "connecting" });
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      wsRef = ws;

      ws.onopen = () => {
        set({ status: "connected", ws, reconnectAttempt: 0 });
      };

      ws.onmessage = (event) => {
        try {
          const notification = JSON.parse(event.data) as Notification;
          for (const listener of get().listeners) {
            listener(notification);
          }
        } catch {
          // skip malformed messages
        }
      };

      ws.onclose = () => {
        set({ status: "disconnected", ws: null });
        wsRef = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    },

    disconnect() {
      wsRef?.close();
      wsRef = null;
      set({ status: "disconnected", ws: null, reconnectAttempt: 0 });
    },

    addListener(fn) {
      get().listeners.add(fn);
      return () => get().listeners.delete(fn);
    },
  };
});
