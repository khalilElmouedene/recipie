"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  FileVideo2,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import {
  api,
  FacebookGenerationControlOut,
  FacebookGenerationLogOut,
  FacebookProjectOut,
} from "@/lib/api";
import { useConfirm } from "@/components/ConfirmModal";
import { useToast } from "@/contexts/ToastContext";

type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";
type JobFilter = "all" | "active" | "completed" | "failed";

interface FacebookJob {
  id: string;
  title: string;
  state: JobState;
  currentStep: string;
  currentStepIndex: number;
  summary: string;
  startedAt: string;
  updatedAt: string;
  entries: FacebookGenerationLogOut[];
}

const PIPELINE_STEPS = ["Queued", "Creative", "Article", "Ready"];

const STATE_COPY: Record<JobState, { label: string; badge: string; icon: typeof Circle }> = {
  queued: {
    label: "Queued",
    badge: "border-slate-700 bg-slate-800/70 text-slate-300",
    icon: Clock3,
  },
  running: {
    label: "Running",
    badge: "border-blue-800/60 bg-blue-950/35 text-blue-300",
    icon: Loader2,
  },
  completed: {
    label: "Completed",
    badge: "border-emerald-800/60 bg-emerald-950/30 text-emerald-300",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    badge: "border-red-800/60 bg-red-950/30 text-red-300",
    icon: XCircle,
  },
  cancelled: {
    label: "Cancelled",
    badge: "border-amber-800/60 bg-amber-950/25 text-amber-300",
    icon: Pause,
  },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    queue: "Added to queue",
    retry: "Retry requested",
    setup: "Preparing generation",
    video: "Processing video",
    image: "Generating Page image",
    article: "Generating article and images",
    complete: "Generation completed",
    failed: "Generation failed",
    cancelled: "Generation cancelled",
    cleanup: "Cleaning up storage",
  };
  return labels[stage] || stage.replaceAll("_", " ");
}

function friendlyError(message: string) {
  const detail = message.replace(/^Generation failed:\s*/i, "").trim();
  const normalized = detail.toLowerCase();

  if (
    normalized.includes("moov atom") ||
    normalized.includes("invalid data found when processing input") ||
    normalized.includes("returned text/html")
  ) {
    return "The source link did not return a valid video. Upload the video or retry with another link.";
  }
  if (normalized.includes("facebook could not provide the reel")) {
    return "Facebook did not provide this Reel video. Upload the video or retry the link.";
  }
  if (normalized.includes("facebook_cookies_file") && normalized.includes("not available")) {
    return "Facebook login information is missing on the server. Upload the video or retry another source.";
  }
  if (normalized.includes("api key") || normalized.includes("unauthorized")) {
    return "The AI service could not continue. Check this project's API key, then retry.";
  }
  return detail || "Generation stopped because of an unexpected error.";
}

function readableProgress(entry: FacebookGenerationLogOut, state: JobState) {
  if (state === "failed") return friendlyError(entry.message);
  if (state === "cancelled") return "Stopped by the user and returned to Spy Sheet.";
  if (state === "completed") return "The generated Facebook content is ready for publishing.";

  const normalized = entry.message.toLowerCase();
  if (entry.stage === "queue") return "Waiting for generation to start.";
  if (entry.stage === "retry") return "Waiting for the retry to start.";
  if (entry.stage === "setup") return "Preparing this job.";
  if (entry.stage === "video") {
    if (normalized.includes("resolving") || normalized.includes("download")) {
      return "Downloading the source video.";
    }
    return "Preparing the video and its cover image.";
  }
  if (entry.stage === "image") return "Generating the post image with this Page’s prompt, model, and quality.";
  if (entry.stage === "article") {
    if (normalized.includes("midjourney") || normalized.includes("image")) {
      return "Generating the article images.";
    }
    return "Generating the recipe article.";
  }
  return entry.message;
}

function stepIndex(entries: FacebookGenerationLogOut[], state: JobState) {
  if (state === "completed") return PIPELINE_STEPS.length - 1;
  const stages = new Set(entries.map((entry) => entry.stage));
  if (stages.has("article") || stages.has("complete")) return 2;
  if (stages.has("video") || stages.has("image")) return 1;
  return 0;
}

function groupLogsIntoJobs(logs: FacebookGenerationLogOut[]): FacebookJob[] {
  const grouped = new Map<string, FacebookGenerationLogOut[]>();

  for (const entry of logs) {
    if (!entry.content_id) continue;
    const entries = grouped.get(entry.content_id) || [];
    entries.push(entry);
    grouped.set(entry.content_id, entries);
  }

  return Array.from(grouped.entries()).map(([id, entries]) => {
    const latest = entries[0];
    const oldest = entries[entries.length - 1];
    let state: JobState;

    if (latest.content_cancelled) state = "cancelled";
    else if (latest.content_status === "ready") state = "completed";
    else if (latest.content_status === "failed") state = "failed";
    else if (latest.stage === "queue" || latest.stage === "retry") state = "queued";
    else state = "running";

    return {
      id,
      title: latest.content_title || "Untitled Facebook post",
      state,
      currentStep:
        state === "completed"
          ? "Generation completed"
          : state === "failed"
            ? "Generation failed"
            : state === "cancelled"
              ? "Generation cancelled"
              : stageLabel(latest.stage),
      currentStepIndex: stepIndex(entries, state),
      summary: readableProgress(latest, state),
      startedAt: oldest.created_at,
      updatedAt: latest.created_at,
      entries,
    };
  });
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
  const [filter, setFilter] = useState<JobFilter>("all");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [controlAction, setControlAction] = useState<"pause" | "resume" | "cancel" | null>(null);
  const [retryingContentId, setRetryingContentId] = useState<string | null>(null);
  const [replacingContentId, setReplacingContentId] = useState<string | null>(null);
  const [deletingContentId, setDeletingContentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [projectData, logData, controlData] = await Promise.all([
        api.getFacebookProject(id),
        api.getFacebookGenerationLogs(id, { limit: 1000 }),
        api.getFacebookGenerationControl(id),
      ]);
      setProject(projectData);
      setLogs(logData);
      setControl(controlData);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load generation jobs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const jobs = useMemo(() => groupLogsIntoJobs(logs), [logs]);
  const counts = useMemo(() => ({
    all: jobs.length,
    active: jobs.filter((job) => job.state === "queued" || job.state === "running").length,
    completed: jobs.filter((job) => job.state === "completed").length,
    failed: jobs.filter((job) => job.state === "failed" || job.state === "cancelled").length,
  }), [jobs]);
  const visibleJobs = useMemo(() => jobs.filter((job) => {
    if (filter === "active") return job.state === "queued" || job.state === "running";
    if (filter === "completed") return job.state === "completed";
    if (filter === "failed") return job.state === "failed" || job.state === "cancelled";
    return true;
  }), [filter, jobs]);

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
        "All unfinished sources will return to this project's Spy Sheet. Completed content will not be changed.",
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

  const retryGeneration = async (contentId: string, title: string) => {
    setRetryingContentId(contentId);
    try {
      await api.retryFacebookGeneration(contentId);
      toast.success(`Generation restarted for ${title}.`);
      await load(true);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not retry generation");
      await load(true);
    } finally {
      setRetryingContentId(null);
    }
  };

  const replaceVideoAndRetry = async (contentId: string, title: string, file: File) => {
    setReplacingContentId(contentId);
    try {
      await api.replaceFacebookVideoAndRetry(contentId, file);
      toast.success(`Video replaced and generation restarted for ${title}.`);
      await load(true);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not replace the source video");
      await load(true);
    } finally {
      setReplacingContentId(null);
    }
  };

  const deleteGeneration = async (contentId: string, title: string) => {
    const accepted = await confirm({
      title: "Delete this generation?",
      message: `“${title}” will be removed from Jobs and Calendar together with its local files (including an unshared uploaded source) and pending deliveries. Already published Facebook or WordPress posts stay online.`,
      confirmLabel: "Delete generation",
      danger: true,
    });
    if (!accepted) return;
    setDeletingContentId(contentId);
    try {
      await api.deleteFacebookContent(contentId);
      setExpandedJobId((current) => current === contentId ? null : current);
      toast.success("Generation deleted.");
      await load(true);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not delete generation");
    } finally {
      setDeletingContentId(null);
    }
  };

  if (loading && !project) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="animate-spin text-brand-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link
        href={`/facebook/${id}`}
        className="inline-flex items-center gap-2 text-sm text-gray-400 transition hover:text-white"
      >
        <ArrowLeft size={16} />
        Back to project
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Generation Jobs</h1>
          <p className="mt-1 text-sm text-gray-400">
            {project?.name || "Facebook"} · Follow each {project?.post_type === "image" ? "image post" : "video"} from import to ready content.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <GenerationControl
        control={control}
        action={controlAction}
        onPause={() => void pauseGeneration()}
        onResume={() => void resumeGeneration()}
        onCancel={() => void cancelGeneration()}
      />

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 shrink-0" size={16} />
          {error}
        </div>
      )}

      <div className="card p-3">
        <div className="flex flex-wrap gap-2" aria-label="Filter generation jobs">
          {([
            ["all", "All"],
            ["active", "Active"],
            ["completed", "Completed"],
            ["failed", "Needs attention"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                filter === value
                  ? "bg-brand-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              }`}
            >
              {label} <span className="ml-1 opacity-70">{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="space-y-3">
        {visibleJobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            expanded={expandedJobId === job.id}
            retrying={retryingContentId === job.id}
            replacing={replacingContentId === job.id}
            deleting={deletingContentId === job.id}
            onToggle={() => setExpandedJobId((current) => current === job.id ? null : job.id)}
            onRetry={() => void retryGeneration(job.id, job.title)}
            onReplace={(file) => void replaceVideoAndRetry(job.id, job.title, file)}
            onDelete={() => void deleteGeneration(job.id, job.title)}
            isImageProject={project?.post_type === "image"}
          />
        ))}

        {!visibleJobs.length && !error && (
          <div className="card grid min-h-56 place-items-center px-6 text-center">
            <div>
              <FileVideo2 className="mx-auto mb-3 text-gray-600" size={30} />
              <p className="text-sm font-medium text-gray-300">
                {jobs.length ? "No jobs in this status" : "No generation jobs yet"}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Start a generation from Spy Sheet to see its progress here.
              </p>
            </div>
          </div>
        )}
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
      title: "No active generation",
      detail: "New jobs can be started from Spy Sheet.",
      tone: "border-gray-800 bg-gray-900",
      dot: "bg-gray-500",
    },
    running: {
      title: `${control.processing_count} ${control.processing_count === 1 ? "job" : "jobs"} running`,
      detail: "This page updates automatically every few seconds.",
      tone: "border-blue-800/40 bg-blue-950/20",
      dot: "animate-pulse bg-blue-400",
    },
    paused: {
      title: "Generation paused",
      detail: `${control.processing_count} unfinished ${control.processing_count === 1 ? "job is" : "jobs are"} waiting for your decision.`,
      tone: "border-amber-800/50 bg-amber-950/20",
      dot: "bg-amber-400",
    },
    cancelling: {
      title: "Cancelling generation",
      detail: "Unfinished rows are being restored to Spy Sheet.",
      tone: "border-red-900/50 bg-red-950/20",
      dot: "animate-pulse bg-red-400",
    },
  }[control.state];

  return (
    <section className={`flex flex-col gap-3 rounded-xl border px-4 py-3 md:flex-row md:items-center md:justify-between ${copy.tone}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${copy.dot}`} />
        <div>
          <h2 className="text-sm font-semibold text-white">{copy.title}</h2>
          <p className="mt-0.5 text-xs text-gray-400">{copy.detail}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {control.state === "running" && (
          <button
            type="button"
            onClick={onPause}
            disabled={busy}
            className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs text-amber-300 disabled:opacity-50"
          >
            {action === "pause" ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
            Stop jobs
          </button>
        )}
        {control.state === "paused" && (
          <>
            <button
              type="button"
              onClick={onResume}
              disabled={busy}
              className="btn-primary inline-flex items-center gap-2 px-3 py-2 text-xs disabled:opacity-50"
            >
              {action === "resume" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Continue jobs
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="btn-danger inline-flex items-center gap-2 px-3 py-2 text-xs disabled:opacity-50"
            >
              {action === "cancel" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Cancel & restore
            </button>
          </>
        )}
        {control.state === "cancelling" && <Loader2 size={18} className="animate-spin text-red-400" />}
      </div>
    </section>
  );
}

function JobCard({
  job,
  expanded,
  retrying,
  replacing,
  deleting,
  onToggle,
  onRetry,
  onReplace,
  onDelete,
  isImageProject,
}: {
  job: FacebookJob;
  expanded: boolean;
  retrying: boolean;
  replacing: boolean;
  deleting: boolean;
  onToggle: () => void;
  onRetry: () => void;
  onReplace: (file: File) => void;
  onDelete: () => void;
  isImageProject: boolean;
}) {
  const state = STATE_COPY[job.state];
  const StatusIcon = state.icon;
  const isActive = job.state === "queued" || job.state === "running";

  return (
    <article className={`overflow-hidden rounded-xl border bg-gray-900 ${
      job.state === "failed" ? "border-red-900/60" : "border-gray-800"
    }`}>
      <div className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${state.badge}`}>
              <StatusIcon size={17} className={job.state === "running" ? "animate-spin" : ""} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-white" title={job.title}>{job.title}</h2>
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${state.badge}`}>
                  {state.label}
                </span>
              </div>
              <p className={`mt-1 text-xs leading-5 ${job.state === "failed" ? "text-red-300" : "text-gray-400"}`}>
                {job.summary}
              </p>
              <p className="mt-1 text-[11px] text-gray-600">
                Started {formatDate(job.startedAt)} · Updated {formatDate(job.updatedAt)}
              </p>
            </div>
          </div>

          <div className="w-full lg:w-72">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className={isActive ? "font-medium text-blue-300" : "text-gray-400"}>{job.currentStep}</span>
              <span className="text-gray-600">{job.currentStepIndex + 1}/{PIPELINE_STEPS.length}</span>
            </div>
            <div className="flex items-center gap-1.5" title={PIPELINE_STEPS.join(" → ")}>
              {PIPELINE_STEPS.map((step, index) => {
                const complete = job.state === "completed" || index < job.currentStepIndex;
                const current = index === job.currentStepIndex;
                const dot = complete
                  ? "bg-emerald-500"
                  : current && job.state === "failed"
                    ? "bg-red-500"
                    : current && job.state === "cancelled"
                      ? "bg-amber-500"
                      : current && isActive
                        ? "animate-pulse bg-blue-400"
                        : "bg-gray-700";
                return <span key={step} className={`h-2 flex-1 rounded-full ${dot}`} />;
              })}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
            {job.state === "failed" && (
              <>
                {!isImageProject && <label className={`btn-primary inline-flex items-center gap-2 px-3 py-2 text-xs ${replacing ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
                  {replacing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Upload & retry
                  <input
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    className="hidden"
                    disabled={replacing || retrying}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onReplace(file);
                      event.target.value = "";
                    }}
                  />
                </label>}
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retrying || replacing}
                  className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs disabled:opacity-50"
                >
                  {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  {isImageProject ? "Retry generation" : "Retry link"}
                </button>
              </>
            )}
            {!isActive && (
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg border border-red-900/50 px-3 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? "Hide details" : "View details"}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-800 bg-gray-950/45 px-4 py-3">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Job history</h3>
          <div className="max-h-72 space-y-3 overflow-y-auto pr-2">
            {[...job.entries].reverse().map((entry) => (
              <div key={entry.id} className="grid gap-1 text-xs sm:grid-cols-[105px_170px_1fr] sm:gap-3">
                <time className="text-gray-600">{formatDate(entry.created_at)}</time>
                <span className={
                  entry.level === "error"
                    ? "text-red-300"
                    : entry.level === "success"
                      ? "text-emerald-300"
                      : entry.level === "warning"
                        ? "text-amber-300"
                        : "text-blue-300"
                }>
                  {stageLabel(entry.stage)}
                </span>
                <p className="break-words leading-5 text-gray-400">{entry.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
