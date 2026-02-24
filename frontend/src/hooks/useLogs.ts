"use client";
import { useState, useEffect, useRef } from "react";
import { getWsUrl } from "@/lib/api";

export function useLogs(jobId: string | null) {
  const [logs, setLogs] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!jobId) return;

    setLogs([]);
    const url = getWsUrl(jobId);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg = event.data as string;
      if (msg === "") return; // heartbeat
      if (msg.startsWith("[JOB_END]")) {
        setLogs((prev) => [...prev, msg]);
        ws.close();
        return;
      }
      setLogs((prev) => [...prev, msg]);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [jobId]);

  return { logs, connected };
}
