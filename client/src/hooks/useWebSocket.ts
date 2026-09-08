import { useEffect, useRef, useState, useCallback } from "react";

type MessageHandler = (data: any) => void;

export type SessionRole = "listener" | "reader" | "combined";

export function useWebSocket(sessionId: string | undefined, role: SessionRole | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handlersRef = useRef<MessageHandler[]>([]);

  const addHandler = useCallback((handler: MessageHandler) => {
    handlersRef.current.push(handler);
    return () => {
      handlersRef.current = handlersRef.current.filter((h) => h !== handler);
    };
  }, []);

  const send = useCallback((data: string | ArrayBuffer) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    wsRef.current.send(data);
    return true;
  }, []);

  const sendJSON = useCallback((data: object) => {
    return send(JSON.stringify(data));
  }, [send]);

  useEffect(() => {
    if (!sessionId || !role) {
      setConnected(false);
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?sessionId=${sessionId}&role=${role}`;
    console.info("[WS] Connecting", { sessionId, role, wsUrl });

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError("WebSocket connection failed. Refresh the page and try again.");
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handlersRef.current.forEach((h) => h(data));
      } catch {}
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, role]);

  return { connected, error, send, sendJSON, addHandler };
}
