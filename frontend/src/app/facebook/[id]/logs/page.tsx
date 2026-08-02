"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  SquareTerminal,
} from "lucide-react";
import {
  api,
  FacebookGenerationControlOut,
  FacebookGenerationLogOut,
  FacebookLogLevel,
  FacebookProjectOut,
} from "@/lib/api";
import { useConfirm } from "@/components/ConfirmModal";
import { useToast } from "@/contexts/ToastContext";

const LEVEL_STYLE: Record<FacebookLogLevel, { dot: string; badge: string; icon: typeof Circle }> = {
  info: {
    dot: "bg-sky-400",
    badge: "border-sky-900/70 bg-sky-950/35 text-sky-300",
    icon: Circle,
  },
  success: {
    dot: "bg-emerald-400",
    badge: "border-emerald-900/70 bg-emerald-950/35 text-emerald-300",
    icon: CheckCircle2,
  },
  warning: {
    dot: "bg-amber-400",
    badge: "border-amber-900/70 bg-amber-950/35 text-amber-300",
    icon: AlertCircle,
  },
  error: {
    dot: "bg-red-400",
    badge: "border-red-900/70 bg-red-950/35 text-red-300",
    icon: AlertCircle,
  },
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function FacebookGenerationLogsPage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();
  const toast = useToast();
  const [project, setProject] = useState<FacebookProjectOut | null>(null);
  const [logs, setLogs] = useState<FacebookGenerationLogOut[]>([]);
  const [control, setControl] = useState<FacebookGenerationControlOut>({
    state: "idle",
    processing_count: 0,
  });
  const [level, setLevel] = useState<FacebookLogLevel | "">("");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [controlAction, setControlAction] = useState<"pause" | "resume" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const [projectData, logData, controlData] = await Promise.all([
        project ? Promise.resolve(project) : api.getFacebookProject(id),
        api.getFacebookGenerationLogs(id, {
          level: level || undefined,
          limit: 1000,
        }),
        api.getFacebookGenerationControl(id),
      ]);
      setProject(projectData);
      setLogs(logData);
      setControl(controlData);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load generation logs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, level, project]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  const visibleLogs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter((entry) =>
      [entry.message, entry.stage, entry.content_title || ""]
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [logs, search]);

  const counts = useMemo(() => ({
    errors: logs.filter((entry) => entry.level === "error").length,
    completed: logs.filter((entry) => entry.level === "success").length,
  }), [logs]);

  const pauseGeneration = async () => {
    setControlAction("pause");
    try {
      const next = await api.pauseFacebookGeneration(id);
      setControl(next);
      toast.warning(
        next.state === "paused"
          ? "Generation will stop at the next safe checkpoint."
          : "There is no active generation to stop.",
      );
      await load(true);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not stop generation");
    } finally {
      setControlAction(null);
    }
  };

  const resumeGeneration = async () => {
    setControlAction("resume");
    try {
      const next = await api.resumeFacebookGeneration(id);
      setControl(next);
      toast.success("Generation continued.");
      await load(true);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not continue generation");
    } finally {
      setControlAction(null);
    }
  };

  const cancelGeneration = async () => {
    const accepted = await confirm({
      title: "Cancel this generation?",
      message:
        "All unfinished video links and titles will return to this project's Spy Sheet. Completed content will not be changed.",
      confirmLabel: "Cancel and restore",
      danger: true,
    });
    if (!accepted) return;
    setControlAction("cancel");
    try {
      const next = await api.cancelFacebookGeneration(id);
      setControl(next);
      toast.success(
        `${next.restored_rows} unfinished ${next.restored_rows === 1 ? "row was" : "rows were"} returned to Spy Sheet.`,
      );
      await load(true);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not cancel generation");
    } finally {
      setControlAction(null);
    }
  };

  if (loading && !project) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="animate-spin text-[#68a8ff]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/facebook/${id}`}
          className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-white"
        >
          <ArrowLeft size={16} />
          Back to project
        </Link>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <label className="flex cursor-pointer items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={autoRefresh}
              onClick={() => setAutoRefresh((current) => !current)}
              className={`relative h-5 w-9 rounded-full transition ${autoRefresh ? "bg-[#1877f2]" : "bg-slate-700"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${autoRefresh ? "left-[18px]" : "left-0.5"}`} />
            </button>
            Live refresh
          </label>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <header className="relative overflow-hidden rounded-[26px] border border-slate-800 bg-[#0d1422] px-6 py-6 md:px-8">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-[#1877f2]/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#68a8ff]">
              <SquareTerminal size={16} />
              Generation observability
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white">
              {project?.name || "Facebook"} logs
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Follow video processing, AI generation, and failures for this project only.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Summary label="Events" value={logs.length} icon={Activity} />
            <Summary label="Completed" value={counts.completed} icon={CheckCircle2} tone="green" />
            <Summary label="Errors" value={counts.errors} icon={AlertCircle} tone="red" />
          </div>
        </div>
      </header>

      <GenerationControl
        control={control}
        action={controlAction}
        onPause={() => void pauseGeneration()}
        onResume={() => void resumeGeneration()}
        onCancel={() => void cancelGeneration()}
      />

      <div className="grid gap-3 rounded-2xl border border-slate-800 bg-[#0d1422] p-4 md:grid-cols-[220px_1fr]">
        <select
          value={level}
          onChange={(event) => setLevel(event.target.value as FacebookLogLevel | "")}
          className="rounded-xl border border-slate-700 bg-[#111b2c] px-3 py-2.5 text-sm text-slate-300 outline-none transition focus:border-[#1877f2]"
        >
          <option value="">All levels</option>
          <option value="info">Information</option>
          <option value="success">Success</option>
          <option value="warning">Warnings</option>
          <option value="error">Errors</option>
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-[#111b2c] px-3 text-slate-500 transition focus-within:border-[#1877f2]">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search a title, stage, or message"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-slate-200 outline-none placeholder:text-slate-600"
          />
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-900/60 bg-red-950/25 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 shrink-0" size={16} />
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#080e19]">
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0d1422] px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            <SquareTerminal size={14} />
            Runtime stream
          </div>
          <span className="flex items-center gap-2 text-xs text-slate-600">
            <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? "animate-pulse bg-emerald-400" : "bg-slate-600"}`} />
            {visibleLogs.length} visible
          </span>
        </div>

        <div className="max-h-[68vh] min-h-[320px] overflow-auto">
          {visibleLogs.map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))}
          {!visibleLogs.length && !error && (
            <div className="grid min-h-[320px] place-items-center px-6 text-center">
              <div>
                <Clock3 className="mx-auto mb-3 text-slate-700" size={30} />
                <p className="text-sm font-medium text-slate-400">No matching events yet</p>
                <p className="mt-1 text-xs text-slate-600">
                  Start a generation from Spy Sheet and its progress will appear here.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function GenerationControl({
  control,
  action,
  onPause,
  onResume,
  onCancel,
}: {
  control: FacebookGenerationControlOut;
  action: "pause" | "resume" | "cancel" | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const busy = action !== null;
  const copy = {
    idle: {
      title: "Generation idle",
      detail: "Start a new batch from Spy Sheet when you are ready.",
      dot: "bg-slate-500",
    },
    running: {
      title: `${control.processing_count} ${control.processing_count === 1 ? "item" : "items"} generating`,
      detail: "Stop safely before choosing whether to continue or cancel.",
      dot: "animate-pulse bg-emerald-400",
    },
    paused: {
      title: "Generation stopped",
      detail: `${control.processing_count} unfinished ${control.processing_count === 1 ? "item is" : "items are"} waiting for your decision.`,
      dot: "bg-amber-400",
    },
    cancelling: {
      title: "Cancellation finishing",
      detail: "The worker is closing safely. Restored rows are already available in Spy Sheet.",
      dot: "animate-pulse bg-red-400",
    },
  }[control.state];

  return (
    <section className={`flex flex-col gap-4 rounded-2xl border px-5 py-4 md:flex-row md:items-center md:justify-between ${
      control.state === "paused"
        ? "border-amber-800/60 bg-amber-950/15"
        : control.state === "cancelling"
          ? "border-red-900/60 bg-red-950/15"
          : "border-slate-800 bg-[#0d1422]"
    }`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${copy.dot}`} />
        <div>
          <h2 className="text-sm font-semibold text-white">{copy.title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{copy.detail}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {control.state === "running" && (
          <button
            type="button"
            onClick={onPause}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-700/60 bg-amber-950/30 px-4 py-2.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-900/35 disabled:opacity-50"
          >
            {action === "pause" ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
            Stop generation
          </button>
        )}
        {control.state === "paused" && (
          <>
            <button
              type="button"
              onClick={onResume}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-[#1877f2] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#2b85f5] disabled:opacity-50"
            >
              {action === "resume" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Continue
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-red-800/60 bg-red-950/30 px-4 py-2.5 text-xs font-semibold text-red-300 transition hover:bg-red-900/35 disabled:opacity-50"
            >
              {action === "cancel" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Cancel & restore to Spy Sheet
            </button>
          </>
        )}
        {control.state === "cancelling" && <Loader2 size={18} className="animate-spin text-red-400" />}
      </div>
    </section>
  );
}

function Summary({
  label,
  value,
  icon: Icon,
  tone = "blue",
}: {
  label: string;
  value: number;
  icon: typeof Activity;
  tone?: "blue" | "green" | "red";
}) {
  const tones = {
    blue: "text-sky-300",
    green: "text-emerald-300",
    red: "text-red-300",
  };
  return (
    <div className="min-w-[94px] rounded-xl border border-slate-800 bg-slate-950/45 px-3 py-2.5">
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${tones[tone]}`}>
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function LogRow({ entry }: { entry: FacebookGenerationLogOut }) {
  const style = LEVEL_STYLE[entry.level];
  const Icon = style.icon;
  return (
    <article className="grid gap-3 border-b border-slate-800/80 px-4 py-4 last:border-0 hover:bg-slate-900/35 md:grid-cols-[180px_120px_1fr] md:px-5">
      <time className="flex items-center gap-2 font-mono text-[11px] text-slate-600">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
        {formatTime(entry.created_at)}
      </time>
      <div>
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${style.badge}`}>
          <Icon size={11} />
          {entry.stage}
        </span>
      </div>
      <div className="min-w-0">
        {entry.content_title && (
          <div className="mb-1 truncate text-xs font-semibold text-slate-300" title={entry.content_title}>
            {entry.content_title}
          </div>
        )}
        <p className={`break-words font-mono text-xs leading-5 ${entry.level === "error" ? "text-red-300" : "text-slate-400"}`}>
          {entry.message}
        </p>
      </div>
    </article>
  );
}
