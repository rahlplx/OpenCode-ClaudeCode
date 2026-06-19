import { create } from "zustand";
import type { Session } from "@/types";
import { api } from "@/client/api";

interface SessionsState {
  sessions: Session[];
  selectedId: string | null;
  loading: boolean;

  load: () => Promise<void>;
  select: (id: string) => void;
  create: (projectPath?: string, modelId?: string) => Promise<Session>;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  selectedId: null,
  loading: false,

  async load() {
    set({ loading: true });
    try {
      const sessions = await api.listSessions();
      set({ sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  select(id) {
    set({ selectedId: id });
  },

  async create(projectPath = "/", modelId) {
    const optimisticId = `temp-${Date.now()}`;
    const optimistic: Session = {
      id: optimisticId,
      title: "New Session",
      projectPath,
      modelId: modelId || "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
      inProgress: false,
    };

    set((s) => ({
      sessions: [optimistic, ...s.sessions],
      selectedId: optimisticId,
    }));

    try {
      const session = await api.createSession(projectPath, modelId);
      set((s) => ({
        sessions: s.sessions.map((x) => (x.id === optimisticId ? session : x)),
        selectedId: session.id,
      }));
      return session;
    } catch (err) {
      set((s) => ({
        sessions: s.sessions.filter((x) => x.id !== optimisticId),
        selectedId: null,
      }));
      throw err;
    }
  },
}));
