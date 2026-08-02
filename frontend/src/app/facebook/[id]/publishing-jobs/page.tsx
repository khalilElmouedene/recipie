"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock3,
  ExternalLink,
  FileVideo2,
  Loader2,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import {
  api,
  FacebookContentOut,
  FacebookDeliveryOut,
  FacebookDeliveryStatus,
  FacebookProjectOut,
} from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";

type JobFilter = "all" | "active" | "published" | "failed" | "scheduled";

interface PublicationJob {
  content: FacebookContentOut;
  delivery: FacebookDeliveryOut;
}

const STATUS_COPY: Record<FacebookDeliveryStatus, {
  label: string;
  description: string;
  style: string;
  icon: typeof CircleDot;
}> = {
  processing: {
    label: "Waiting for content",
    description: "The video and article must finish before publication can start.",
    style: "border-slate-700 bg-slate-800/60 text-slate-300",
    icon: Clock3,
  },
  draft: {
    label: "Ready to publish",
    description: "The post is ready and waiting for a manual publication.",
    style: "border-blue-800/60 bg-blue-950/30 text-blue-300",
    icon: Send,
  },
  scheduled: {
    label: "Scheduled",
    description: "The post will be published automatically at its scheduled time.",
    style: "border-amber-800/60 bg-amber-950/30 text-amber-300",
    icon: CalendarClock,
  },
  publishing: {
    label: "Publishing",
    description: "Publishing the article, Facebook Reel, and first comment.",
    style: "border-[#1877f2]/60 bg-[#1877f2]/10 text-[#8bbcff]",
    icon: Loader2,
  },
  published: {
    label: "Published",
    description: "Meta completed the Reel publishing phase and the first comment was added.",
    style: "border-emerald-800/60 bg-emerald-950/30 text-emerald-300",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    description: "Facebook publication stopped. Review the error and retry when ready.",
    style: "border-red-800/60 bg-red-950/30 text-red-300",
    icon: XCircle,
  },
};

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function canPublishFacebookDelivery(
  content: FacebookContentOut,
  delivery: FacebookDeliveryOut,
) {
  if (content.status === "ready") return true;
  return delivery.status === "failed"
    && Boolean(content.processed_video_url)
    && Boolean(content.article_url || content.generated_article);
}

export default function FacebookPublishingJobsPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [project, setProject] = useState<FacebookProjectOut | null>(null);
  const [contents, setContents] = useState<FacebookContentOut[]>([]);
  const [filter, setFilter] = useState<JobFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [projectData, contentData] = await Promise.all([
        api.getFacebookProject(id),
        api.getFacebookContents(id),
      ]);
      setProject(projectData);
      setContents(contentData);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load publication jobs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  const jobs = useMemo<PublicationJob[]>(() => contents.flatMap((content) =>
    content.deliveries.map((delivery) => ({ content, delivery })),
  ).sort((left, right) => {
    const leftDate = left.delivery.published_at || left.delivery.scheduled_at || left.content.created_at;
    const rightDate = right.delivery.published_at || right.delivery.scheduled_at || right.content.created_at;
    return rightDate.localeCompare(leftDate);
  }), [contents]);

  const counts = useMemo(() => ({
    all: jobs.length,
    active: jobs.filter(({ delivery }) => delivery.status === "publishing" || delivery.status === "draft").length,
    published: jobs.filter(({ delivery }) => delivery.status === "published").length,
    failed: jobs.filter(({ delivery }) => delivery.status === "failed").length,
    scheduled: jobs.filter(({ delivery }) => delivery.status === "scheduled").length,
  }), [jobs]);

  const visibleJobs = useMemo(() => jobs.filter(({ delivery }) => {
    if (filter === "active") return delivery.status === "publishing" || delivery.status === "draft";
    if (filter === "published") return delivery.status === "published";
    if (filter === "failed") return delivery.status === "failed";
    if (filter === "scheduled") return delivery.status === "scheduled";
    return true;
  }), [filter, jobs]);

  const selectableVisibleIds = useMemo(
    () => visibleJobs
      .filter((job) =>
        ["draft", "scheduled", "failed"].includes(job.delivery.status)
        && canPublishFacebookDelivery(job.content, job.delivery),
      )
      .map((job) => job.delivery.id),
    [visibleJobs],
  );
  const allSelectableVisibleSelected = selectableVisibleIds.length > 0
    && selectableVisibleIds.every((deliveryId) => selectedIds.has(deliveryId));

  useEffect(() => {
    const available = new Set(
      jobs
        .filter((job) =>
          ["draft", "scheduled", "failed"].includes(job.delivery.status)
          && canPublishFacebookDelivery(job.content, job.delivery),
        )
        .map((job) => job.delivery.id),
    );
    setSelectedIds((current) => {
      const next = new Set([...current].filter((deliveryId) => available.has(deliveryId)));
      if (next.size === current.size && [...next].every((deliveryId) => current.has(deliveryId))) {
        return current;
      }
      return next;
    });
  }, [jobs]);

  const queuePublication = async (job: PublicationJob) => {
    setActionId(job.delivery.id);
    try {
      await api.publishFacebookDelivery(job.delivery.id);
      toast.success(
        job.delivery.status === "failed"
          ? `Publication retry started for ${job.delivery.page_name}.`
          : `Publication started for ${job.delivery.page_name}.`,
      );
      await load(true);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not start publication");
      await load(true);
    } finally {
      setActionId(null);
    }
  };

  const queueSelectedPublications = async () => {
    const deliveryIds = [...selectedIds];
    if (!deliveryIds.length) return;
    setBulkPublishing(true);
    try {
      const result = await api.publishFacebookDeliveriesBulk(deliveryIds);
      if (result.queued_ids.length) {
        toast.success(`${result.queued_ids.length} Facebook publication${result.queued_ids.length === 1 ? "" : "s"} started.`);
      }
      if (result.skipped_ids.length) {
        toast.warning(`${result.skipped_ids.length} publication${result.skipped_ids.length === 1 ? " was" : "s were"} skipped because the status changed.`);
      }
      setSelectedIds(new Set());
      await load(true);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not publish selected jobs");
      await load(true);
    } finally {
      setBulkPublishing(false);
    }
  };

  const editSchedule = (job: PublicationJob) => {
    const target = job.delivery.scheduled_at
      ? new Date(job.delivery.scheduled_at)
      : new Date(Date.now() + 5 * 60_000);
    const local = new Date(target.getTime() - target.getTimezoneOffset() * 60_000);
    setScheduleId(job.delivery.id);
    setScheduleValue(local.toISOString().slice(0, 16));
  };

  const saveSchedule = async (job: PublicationJob) => {
    if (!scheduleValue) return;
    setSavingSchedule(true);
    try {
      await api.scheduleFacebookDelivery(job.delivery.id, new Date(scheduleValue).toISOString());
      toast.success(`${job.delivery.page_name} publication scheduled.`);
      setScheduleId(null);
      setScheduleValue("");
      await load(true);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not schedule publication");
    } finally {
      setSavingSchedule(false);
    }
  };

  if (loading && !project) {
    return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="animate-spin text-[#68a8ff]" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/facebook/${id}`} className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-white">
          <ArrowLeft size={16} /> Back to project
        </Link>
        <Link href={`/facebook/${id}/logs`} className="text-xs font-medium text-slate-500 transition hover:text-[#8bbcff]">
          Open Generation Jobs
        </Link>
      </div>

      <header className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#101827] p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-8 -top-20 h-52 w-52 rounded-full bg-[#1877f2]/15 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#68a8ff]">
              <Radio size={14} /> Live publication queue
            </div>
            <h1 className="mt-2 text-2xl font-bold text-white">Publication Jobs</h1>
            <p className="mt-1 text-sm text-slate-500">
              {project?.name || "Facebook"} · Track every Page from queue to publication.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-900/60 bg-red-950/25 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 shrink-0" size={16} /> {error}
        </div>
      )}

      {counts.published > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-xs leading-5 text-amber-200">
          <AlertCircle className="mt-0.5 shrink-0" size={16} />
          <p>
            A completed Meta publication is not an audience check. If another
            Facebook account sees a blank loading page, set the Meta app to
            <strong className="mx-1 text-white">Live</strong>
            and remove Page age, country, or audience restrictions before publishing a new Reel.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-[#101827] p-3">
        <div className="flex flex-wrap gap-2" aria-label="Filter publication jobs">
          {([[
            "all", "All",
          ], [
            "active", "Active",
          ], [
            "scheduled", "Scheduled",
          ], [
            "published", "Published",
          ], [
            "failed", "Failed",
          ]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                filter === value
                  ? "bg-[#1877f2] text-white"
                  : "bg-slate-900 text-slate-500 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {label} <span className="ml-1 opacity-70">{counts[value]}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-3 border-t border-slate-800 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <label className={`inline-flex items-center gap-2.5 text-xs font-medium ${selectableVisibleIds.length ? "cursor-pointer text-slate-300" : "cursor-not-allowed text-slate-600"}`}>
            <input
              type="checkbox"
              checked={allSelectableVisibleSelected}
              disabled={!selectableVisibleIds.length || bulkPublishing}
              onChange={() => setSelectedIds((current) => {
                const next = new Set(current);
                if (allSelectableVisibleSelected) selectableVisibleIds.forEach((deliveryId) => next.delete(deliveryId));
                else selectableVisibleIds.forEach((deliveryId) => next.add(deliveryId));
                return next;
              })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-[#1877f2]"
            />
            Select all publishable jobs in this view
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.size > 0 && (
              <button type="button" onClick={() => setSelectedIds(new Set())} disabled={bulkPublishing} className="px-2 py-2 text-xs font-medium text-slate-500 hover:text-white disabled:opacity-50">
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => void queueSelectedPublications()}
              disabled={!selectedIds.size || bulkPublishing}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#2f86f6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkPublishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {bulkPublishing ? "Startingâ€¦" : `Publish selected (${selectedIds.size})`}
            </button>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        {visibleJobs.map((job) => {
          const copy = STATUS_COPY[job.delivery.status];
          const StatusIcon = copy.icon;
          const retryable = job.delivery.status === "failed";
          const publishable = retryable || job.delivery.status === "draft" || job.delivery.status === "scheduled";
          const canRunPublication = publishable && canPublishFacebookDelivery(job.content, job.delivery);
          const editingSchedule = scheduleId === job.delivery.id;
          return (
            <article key={job.delivery.id} className={`overflow-hidden rounded-xl border bg-[#101827] ${selectedIds.has(job.delivery.id) ? "border-[#1877f2]/70 ring-1 ring-[#1877f2]/20" : retryable ? "border-red-900/60" : "border-slate-800"}`}>
              {job.delivery.status === "publishing" && (
                <div className="h-0.5 overflow-hidden bg-[#1877f2]/15">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-[#1877f2]" />
                </div>
              )}
              <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
                <label className={canRunPublication ? "cursor-pointer" : "cursor-not-allowed"} title={canRunPublication ? "Select this publication job" : "This job cannot be published now"}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(job.delivery.id)}
                    disabled={!canRunPublication || bulkPublishing}
                    onChange={(event) => setSelectedIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(job.delivery.id);
                      else next.delete(job.delivery.id);
                      return next;
                    })}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-[#1877f2] disabled:opacity-30"
                  />
                </label>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${copy.style}`}>
                    <StatusIcon size={18} className={job.delivery.status === "publishing" ? "animate-spin" : ""} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-white" title={job.content.title}>{job.content.title}</h2>
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${copy.style}`}>{copy.label}</span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-[#8bbcff]">{job.delivery.page_name}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{copy.description}</p>
                    {job.delivery.error_message && (
                      <p className="mt-2 max-w-3xl rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs leading-5 text-red-300">
                        {job.delivery.error_message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0 text-left lg:w-44 lg:text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                    {job.delivery.status === "published" ? "Published" : job.delivery.status === "scheduled" ? "Scheduled" : "Created"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatDate(job.delivery.published_at || job.delivery.scheduled_at || job.content.created_at)}
                  </p>
                  {job.delivery.status === "published" && job.delivery.facebook_post_id && (
                    <a
                      href={`https://www.facebook.com/reel/${job.delivery.facebook_post_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#8bbcff] transition hover:text-white"
                    >
                      View Reel <ExternalLink size={12} />
                    </a>
                  )}
                </div>

                {canRunPublication && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => editSchedule(job)}
                      disabled={actionId === job.delivery.id || savingSchedule}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2.5 text-xs font-semibold text-slate-400 transition hover:border-amber-700/60 hover:text-amber-300 disabled:opacity-50"
                    >
                      <CalendarClock size={14} /> Schedule
                    </button>
                    <button
                      type="button"
                      onClick={() => void queuePublication(job)}
                      disabled={actionId === job.delivery.id || savingSchedule}
                      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition disabled:opacity-50 ${
                        retryable
                          ? "border border-red-800/60 bg-red-950/30 text-red-200 hover:bg-red-900/40"
                          : "bg-[#1877f2] text-white hover:bg-[#2f86f6]"
                      }`}
                    >
                      {actionId === job.delivery.id ? <Loader2 size={14} className="animate-spin" /> : retryable ? <RotateCcw size={14} /> : <Send size={14} />}
                      {actionId === job.delivery.id ? "Starting…" : retryable ? "Retry publication" : "Publish now"}
                    </button>
                  </div>
                )}
              </div>
              {editingSchedule && (
                <div className="flex flex-col gap-2 border-t border-slate-800 bg-slate-950/20 px-4 py-3 sm:flex-row sm:px-5">
                  <input
                    type="datetime-local"
                    value={scheduleValue}
                    onChange={(event) => setScheduleValue(event.target.value)}
                    className="input-field min-w-0 flex-1 py-2 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void saveSchedule(job)}
                    disabled={!scheduleValue || savingSchedule}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                  >
                    {savingSchedule ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />} Save schedule
                  </button>
                  <button type="button" onClick={() => setScheduleId(null)} disabled={savingSchedule} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:text-white disabled:opacity-40">
                    Cancel
                  </button>
                </div>
              )}
            </article>
          );
        })}

        {!visibleJobs.length && !error && (
          <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-slate-700 bg-[#101827] px-6 text-center">
            <div>
              <FileVideo2 className="mx-auto mb-3 text-slate-600" size={30} />
              <p className="text-sm font-medium text-slate-300">{jobs.length ? "No jobs in this status" : "No publication jobs yet"}</p>
              <p className="mt-1 text-xs text-slate-600">Publish generated content to see Page delivery progress here.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
