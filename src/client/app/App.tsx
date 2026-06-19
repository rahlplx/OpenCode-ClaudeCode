import { useEffect } from "react";
import { useConnectionStore } from "@/client/stores/connection";
import { useSessionsStore } from "@/client/stores/sessions";
import { useChatStore } from "@/client/stores/chat";
import { api } from "@/client/api";
import { MainLayout } from "@/client/components/layout/MainLayout";

export function App() {
  const connect = useConnectionStore((s) => s.connect);
  const addListener = useConnectionStore((s) => s.addListener);
  const loadSessions = useSessionsStore((s) => s.load);
  const handleNotification = useChatStore((s) => s.handleNotification);

  useEffect(() => {
    loadSessions();
    api.listModels().catch(() => {});
    connect();
    const removeListener = addListener(handleNotification);
    return removeListener;
  }, [connect, addListener, loadSessions, handleNotification]);

  return <MainLayout />;
}
