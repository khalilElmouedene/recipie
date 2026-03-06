"use client";
import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Square, CheckCircle, XCircle, Clock, Loader2 } from "lucide-react";
import { api, JobOut, getWsUrl } from "@/lib/api";

// ── Step definitions (7 steps per recipe) ───────────────────────────────────
const TOTAL_STEPS = 7;

interface RecipeCard {
  name: string;
  index: number;
  total: number;
  status: "running" | "completed" | "error" | "waiting";
  currentStep: string;
  completedSteps: number;
  mjStatus?: "queued" | "generating";
}

function parseRecipeCards(logs: string[]): RecipeCard[] {
  const cards: RecipeCard[] = [];
  let cur: RecipeCard | null = null;

  for (const line of logs) {
    const m = line.match(/RECIPE (\d+)\/(\d+):\s*(.{1,80})/);
    if (m) {
      if (cur) cards.push(cur);
      cur = { name: m[3].trim(), index: +m[1], total: +m[2], status: "running", currentStep: "Starting…", completedSteps: 0 };
      continue;
    }
    if (!cur) continue;

    if (line.includes("Focus keyword:"))             { cur.completedSteps = Math.max(cur.completedSteps, 1); cur.currentStep = "Focus keyword"; }
    if (line.includes("Generating full recipe"))     { cur.completedSteps = Math.max(cur.completedSteps, 1); cur.currentStep = "Full recipe text"; }
    if (line.includes("Generating recipe JSON"))     { cur.completedSteps = Math.max(cur.completedSteps, 2); cur.currentStep = "Recipe JSON"; }
    if (line.includes("Generating article HTML"))    { cur.completedSteps = Math.max(cur.completedSteps, 3); cur.currentStep = "Article HTML"; }
    if (line.includes("Generating meta description")){ cur.completedSteps = Math.max(cur.completedSteps, 4); cur.currentStep = "Meta description"; }
    if (line.includes("Generating category"))        { cur.completedSteps = Math.max(cur.completedSteps, 5); cur.currentStep = "Category"; }
    if (line.includes("Waiting for Midjourney queue")){ cur.completedSteps = Math.max(cur.completedSteps, 6); cur.currentStep = "Images – waiting queue"; cur.mjStatus = "queued"; }
    if (line.includes("Midjourney slot acquired"))   { cur.currentStep = "Images – generating (3-4 min)"; cur.mjStatus = "generating"; }
    if (line.includes("Waiting") && line.includes("Midjourney generation")) { cur.currentStep = "Images – Midjourney processing…"; cur.mjStatus = "generating"; }
    if (line.includes("Image cached") || line.includes("Downloaded"))       { cur.completedSteps = Math.max(cur.completedSteps, 7); cur.currentStep = "Saving images"; }
    if (line.includes("Content generation complete")) { cur.status = "completed"; cur.completedSteps = TOTAL_STEPS; cur.currentStep = "Done"; cur.mjStatus = undefined; }
    if (line.includes("Error generating content") || (line.includes("failed") && !line.includes("non-fatal"))) {
      cur.status = "error"; cur.currentStep = "Error";
    }
  }
  if (cur) cards.push(cur);
  return cards;
}

function logLineClass(line: string): string {
  if (line.match(/={3,}/))                                      return "text-gray-600";
  if (line.match(/RECIPE \d+\/\d+/))                            return "text-brand-400 font-semibold";
  if (line.includes("Error") || line.includes("FAIL") || (line.includes("failed") && !line.includes("non-fatal"))) return "text-red-400";
  if (line.includes("complete") || line.includes("cached") || line.includes("Downloaded")) return "text-green-400";
  if (line.includes("Midjourney slot acquired"))                 return "text-orange-300 font-medium";
  if (line.includes("Midjourney queue") || line.includes("queue slot")) return "text-yellow-400";
  if (line.includes("Midjourney") || line.includes("Discord") || line.includes("upscale")) return "text-orange-400";
  if (line.includes("Generating") || line.includes("Waiting"))  return "text-blue-300";
  return "text-gray-400";
}

function currentStatusFromLogs(logs: string[]): string | null {
  for (let i = logs.length - 1; i >= Math.max(0, logs.length - 6); i--) {
    const l = logs[i];
    if (l.includes("ALL RECIPES PROCESSED"))                    return "All recipes processed!";
    if (l.includes("Content generation complete for:"))         return `Done: ${l.split("for:")[1]?.trim()}`;
    if (l.includes("Waiting") && l.includes("Midjourney generation")) return "Midjourney: generating images (3-4 min)…";
    if (l.includes("Midjourney slot acquired"))                  return "Midjourney: starting image generation…";
    if (l.includes("Waiting for Midjourney queue"))              return "Waiting for Midjourney queue slot…";
    if (l.includes("Generating article"))                        return "Generating article HTML…";
    if (l.includes("Generating recipe JSON"))                    return "Generating recipe JSON…";
    if (l.includes("Generating full recipe"))                    return "Generating full recipe text…";
    if (l.includes("Generating meta"))                           return "Generating meta description…";
    if (l.includes("Generating category"))                       return "Generating category…";
  }
  return null;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<JobOut | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getJob(id).then(setJob).catch(() => router.push("/"));
    api.getJobLogs(id).then((l) => setLogs(l.map((x) => x.message))).catch(() => {});
  }, [id, router]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const ws = new WebSocket(getWsUrl(id));

    ws.onmessage = (e) => {
      if (!e.data) return;
      setLogs((prev) => [...prev, e.data]);
      // Detect final log lines and poll immediately so UI updates without waiting for ws.onclose
      if (
        e.data.includes("Job completed successfully") ||
        e.data.includes("Job stopped") ||
        e.data.includes("Job failed")
      ) {
        setTimeout(() => api.getJob(id).then(setJob).catch(() => {}), 800);
      }
    };

    ws.onclose = () => {
      // Retry a couple of times in case the DB hasn't committed yet
      const poll = (attempts: number) => {
        api.getJob(id).then((j) => {
          setJob(j);
          if (j.status === "running" && attempts > 0) setTimeout(() => poll(attempts - 1), 1500);
        }).catch(() => {});
      };
      poll(3);
    };

    return () => ws.close();
  }, [job?.status, id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const recipeCards = useMemo(() => parseRecipeCards(logs), [logs]);
  const currentStatus = useMemo(() => currentStatusFromLogs(logs), [logs]);
  const completedCount = recipeCards.filter((c) => c.status === "completed").length;
  const totalRecipes = recipeCards.length || job?.total_rows || 0;

  const statusBadge: Record<string, string> = {
    pending: "bg-gray-700 text-gray-300",
    running: "bg-blue-600/20 text-blue-400",
    completed: "bg-green-600/20 text-green-400",
    failed: "bg-red-600/20 text-red-400",
    stopped: "bg-yellow-600/20 text-yellow-400",
  };

  if (!job) return <div className="text-gray-400 p-6">Loading…</div>;

  return (
    <div>
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4">
        <ArrowLeft size={16} /> Back
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white capitalize">{job.job_type} Job</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded ${statusBadge[job.status] || ""}`}>{job.status}</span>
            <span className="text-sm text-gray-400">{new Date(job.created_at).toLocaleString()}</span>
          </div>
        </div>
        {job.status === "running" && (
          <button onClick={() => api.stopJob(id).then(setJob)} className="btn-danger flex items-center gap-2">
            <Square size={16} /> Stop Job
          </button>
        )}
      </div>

      {/* Current action banner */}
      {job.status === "running" && currentStatus && (
        <div className="flex items-center gap-3 rounded-lg bg-blue-950/30 border border-blue-800/40 px-4 py-3 mb-4">
          <Loader2 size={15} className="text-blue-400 animate-spin flex-shrink-0" />
          <span className="text-sm text-blue-200">{currentStatus}</span>
        </div>
      )}

      {/* Overall progress bar */}
      {totalRecipes > 0 && (
        <div className="card mb-4">
          <div className="flex justify-between text-sm text-gray-400 mb-2">
            <span>Overall progress</span>
            <span>{completedCount} / {totalRecipes} recipes completed</span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-brand-600 rounded-full transition-all duration-500"
              style={{ width: `${totalRecipes > 0 ? (completedCount / totalRecipes) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Per-recipe cards */}
      {recipeCards.length > 0 && (
        <div className="card mb-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Recipe Progress</h2>
          <div className="space-y-2">
            {recipeCards.map((card, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
                card.status === "completed" ? "bg-green-950/20 border-green-800/30" :
                card.status === "error"     ? "bg-red-950/20 border-red-800/30" :
                card.status === "running"   ? "bg-blue-950/20 border-blue-800/30" :
                                              "bg-gray-800/20 border-gray-700/30"
              }`}>
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {card.status === "completed" && <CheckCircle size={16} className="text-green-400" />}
                  {card.status === "error"     && <XCircle size={16} className="text-red-400" />}
                  {card.status === "running"   && <Loader2 size={16} className="text-blue-400 animate-spin" />}
                  {card.status === "waiting"   && <Clock size={16} className="text-gray-500" />}
                </div>

                {/* Name + current step */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{card.name}</p>
                  <p className={`text-xs mt-0.5 ${
                    card.status === "completed"        ? "text-green-400" :
                    card.status === "error"            ? "text-red-400" :
                    card.mjStatus === "queued"         ? "text-yellow-400" :
                    card.mjStatus === "generating"     ? "text-orange-400" :
                                                         "text-blue-400"
                  }`}>{card.currentStep}</p>
                </div>

                {/* 7-dot step bar */}
                <div className="flex gap-1 flex-shrink-0" title={`${card.completedSteps}/${TOTAL_STEPS} steps`}>
                  {Array.from({ length: TOTAL_STEPS }).map((_, s) => (
                    <div key={s} className={`w-2 h-2 rounded-full ${
                      s < card.completedSteps              ? "bg-green-500" :
                      s === card.completedSteps && card.status === "running" ? "bg-blue-400 animate-pulse" :
                                                             "bg-gray-700"
                    }`} />
                  ))}
                </div>

                {/* Recipe index */}
                <span className="text-xs text-gray-600 flex-shrink-0">{card.index}/{card.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {job.error && (
        <div className="card mb-4 border-red-800 bg-red-950/30">
          <p className="text-sm text-red-400">{job.error}</p>
        </div>
      )}

      {/* Live logs */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Live Logs</h2>
        <div ref={logRef} className="h-72 overflow-y-auto rounded-lg bg-gray-950 p-4 font-mono text-xs leading-relaxed">
          {logs.length === 0 && <span className="text-gray-600">No logs yet…</span>}
          {logs.map((line, i) => (
            <div key={i} className={logLineClass(line)}>{line}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
