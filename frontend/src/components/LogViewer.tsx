"use client";
import { useEffect, useRef } from "react";
import { useLogs } from "@/hooks/useLogs";

interface Props {
  jobId: string | null;
  className?: string;
}

export function LogViewer({ jobId, className = "" }: Props) {
  const { logs, connected } = useLogs(jobId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Live Logs
        </span>
        {jobId && (
          <span
            className={`flex items-center gap-1.5 text-xs ${
              connected ? "text-green-400" : "text-gray-500"
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                connected ? "bg-green-400 animate-pulse" : "bg-gray-600"
              }`}
            />
            {connected ? "Connected" : "Disconnected"}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-4 font-mono text-xs leading-relaxed">
        {!jobId && (
          <p className="text-gray-600">Start a job to see live logs here...</p>
        )}
        {logs.map((line, i) => (
          <div
            key={i}
            className={`py-0.5 ${
              line.includes("Error") || line.includes("FAIL")
                ? "text-red-400"
                : line.includes("Completed") || line.includes("created")
                ? "text-green-400"
                : line.includes("STOP") || line.includes("JOB_END")
                ? "text-yellow-400"
                : "text-gray-300"
            }`}
          >
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
