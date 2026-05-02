"use client";
import { useEffect, useRef } from "react";
import { useLogs } from "@/hooks/useLogs";

interface Props {
  jobId: string | null;
  /** Pre-loaded log lines for finished jobs (bypasses WebSocket). */
  staticLogs?: string[];
  className?: string;
}

function logColor(line: string): string {
  const l = line.toLowerCase();
  if (
    l.includes("error") || l.includes("fail") || l.includes("forbidden") ||
    l.includes("403") || l.includes("401") || l.includes("permanently failed") ||
    l.includes("publishing failed") || l.includes("exception")
  ) return "text-red-400";
  if (
    l.includes("completed") || l.includes("created") || l.includes("published") ||
    l.includes("uploaded") || l.includes("connected as") || l.includes("saved")
  ) return "text-green-400";
  if (l.includes("retrying") || l.includes("warning") || l.includes("attempt"))
    return "text-yellow-400";
  if (l.includes("stop") || l.includes("job_end"))
    return "text-yellow-400";
  return "text-gray-300";
}

export function LogViewer({ jobId, staticLogs, className = "" }: Props) {
  const { logs: wsLogs, connected } = useLogs(staticLogs ? null : jobId);
  const logs = staticLogs ?? wsLogs;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {staticLogs ? "Job Logs" : "Live Logs"}
        </span>
        {!staticLogs && jobId && (
          <span className={`flex items-center gap-1.5 text-xs ${connected ? "text-green-400" : "text-gray-500"}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-gray-600"}`} />
            {connected ? "Connected" : "Disconnected"}
          </span>
        )}
        {staticLogs && (
          <span className="text-xs text-gray-500">{logs.length} lines</span>
        )}
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-4 font-mono text-xs leading-relaxed">
        {!jobId && !staticLogs && (
          <p className="text-gray-600">Start a job to see live logs here...</p>
        )}
        {logs.map((line, i) => (
          <div key={i} className={`py-0.5 ${logColor(line)}`}>
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
