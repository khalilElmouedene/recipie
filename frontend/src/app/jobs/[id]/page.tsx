"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Square } from "lucide-react";
import { api, JobOut, JobLogOut, getWsUrl } from "@/lib/api";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<JobOut | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getJob(id).then(setJob).catch(() => router.push("/"));
    api.getJobLogs(id).then((dbLogs) => {
      setLogs(dbLogs.map((l) => l.message));
    }).catch(() => {});
  }, [id, router]);

  useEffect(() => {
    if (!job || job.status !== "running") return;

    const ws = new WebSocket(getWsUrl(id));
    ws.onmessage = (e) => {
      if (e.data) setLogs((prev) => [...prev, e.data]);
    };
    ws.onclose = () => {
      api.getJob(id).then(setJob).catch(() => {});
    };
    return () => ws.close();
  }, [job?.status, id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const handleStop = async () => {
    await api.stopJob(id);
    api.getJob(id).then(setJob);
  };

  const statusColor: Record<string, string> = {
    pending: "bg-gray-700 text-gray-300",
    running: "bg-blue-600/20 text-blue-400",
    completed: "bg-green-600/20 text-green-400",
    failed: "bg-red-600/20 text-red-400",
    stopped: "bg-yellow-600/20 text-yellow-400",
  };

  if (!job) return <div className="text-gray-400">Loading...</div>;

  return (
    <div>
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white capitalize">{job.job_type} Job</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded ${statusColor[job.status] || ""}`}>{job.status}</span>
            <span className="text-sm text-gray-400">{new Date(job.created_at).toLocaleString()}</span>
          </div>
        </div>
        {job.status === "running" && (
          <button onClick={handleStop} className="btn-danger flex items-center gap-2">
            <Square size={16} /> Stop Job
          </button>
        )}
      </div>

      {job.current_row != null && job.total_rows != null && (
        <div className="card mb-4">
          <div className="flex justify-between text-sm text-gray-400 mb-2">
            <span>Progress</span>
            <span>{job.current_row} / {job.total_rows}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-brand-600 rounded-full transition-all"
              style={{ width: `${Math.min(100, (job.current_row / job.total_rows) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {job.error && (
        <div className="card mb-4 border-red-800 bg-red-950/30">
          <p className="text-sm text-red-400">{job.error}</p>
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Logs</h2>
        <div ref={logRef} className="h-96 overflow-y-auto rounded-lg bg-gray-950 p-4 font-mono text-xs leading-relaxed">
          {logs.length === 0 && <span className="text-gray-600">No logs yet...</span>}
          {logs.map((line, i) => (
            <div key={i} className={`${line.includes("Error") || line.includes("FAIL") ? "text-red-400" : line.includes("completed") || line.includes("SUCCESS") ? "text-green-400" : "text-gray-300"}`}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
