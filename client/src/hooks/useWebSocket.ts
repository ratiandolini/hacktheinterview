import { useEffect, useRef, useState, useCallback } from "react";

type MessageHandler = (data: any) => void;

export type SessionRole = "listener" | "reader" | "combined";
export type ConnectionState = "connecting" | "connected" | "reconnecting";

export function getReconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 5000);
}

export function useWebSocket(sessionId: string | undefined, role: SessionRole | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
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

  const sendJSON = useCallback((data: object) => send(JSON.stringify(data)), [send]);

  useEffect(() => {
    if (!sessionId || !role) {
      setConnected(false);
      setConnectionState("connecting");
      return;
    }

    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;

    const connect = () => {
      if (disposed) return;
      setConnected(false);
      setConnectionState(retryAttempt === 0 ? "connecting" : "reconnecting");
      setError(null);

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws?sessionId=${sessionId}&role=${role}`;
      console.info("[WS] Connecting", { sessionId, role, wsUrl, retryAttempt });
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        retryAttempt = 0;
        setConnected(true);
        setConnectionState("connected");
        setError(null);
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        setConnectionState("reconnecting");
        const delay = getReconnectDelay(retryAttempt);
        retryAttempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handlersRef.current.forEach((handler) => handler(data));
        } catch {}
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [sessionId, role]);

  return { connected, connectionState, error, send, sendJSON, addHandler };
}