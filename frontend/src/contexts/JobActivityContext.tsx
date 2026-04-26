"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, JobOut } from "@/lib/api";

const STORAGE_KEY = "recipe-generator-job-activity-v1";
const MAX_ACTIVITY_ITEMS = 24;
const POLL_MS = 3000;
const ACTIVE_JOB_STATUSES = new Set(["pending", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "stopped"]);

export interface JobActivityItem {
  id: string;
  projectId: string;
  jobType: string;
  title: string;
  sourceLabel: string | null;
  href: string;
  status: string;
  currentRow: number | null;
  totalRows: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  lastUpdatedAt: string;
}

interface JobActivityMeta {
  title?: string;
  sourceLabel?: string | null;
  href?: string;
}

interface JobActivityContextValue {
  items: JobActivityItem[];
  activeCount: number;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  trackJob: (job: JobOut, meta?: JobActivityMeta) => void;
  dismissJob: (jobId: string) => void;
  clearFinished: () => void;
}

const JobActivityContext = createContext<JobActivityContextValue | null>(null);

function readStoredItems(): JobActivityItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is JobActivityItem =>
      item &&
      typeof item.id === "string" &&
      typeof item.projectId === "string" &&
      typeof item.jobType === "string" &&
      typeof item.title === "string" &&
      typeof item.href === "string" &&
      typeof item.status === "string" &&
      typeof item.createdAt === "string"
    );
  } catch {
    return [];
  }
}

function writeStoredItems(items: JobActivityItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ACTIVITY_ITEMS)));
  } catch {
    // Ignore storage write failures.
  }
}

function defaultTitleForJob(job: JobOut): string {
  if (job.job_type === "articles_all_sites") return "All-sites generation";
  if (job.job_type === "articles") return "Recipe generation";
  if (job.job_type === "publisher") return "WordPress publishing";
  return `${job.job_type} job`;
}

function mergeTrackedJob(
  existing: JobActivityItem | undefined,
  job: JobOut,
  meta?: JobActivityMeta,
): JobActivityItem {
  return {
    id: job.id,
    projectId: job.project_id,
    jobType: job.job_type,
    title: meta?.title ?? existing?.title ?? defaultTitleForJob(job),
    sourceLabel: meta?.sourceLabel ?? existing?.sourceLabel ?? null,
    href: meta?.href ?? existing?.href ?? `/jobs/${job.id}`,
    status: job.status,
    currentRow: job.current_row ?? null,
    totalRows: job.total_rows ?? null,
    error: job.error ?? null,
    createdAt: existing?.createdAt ?? job.created_at,
    finishedAt: job.finished_at ?? null,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function fireJobNotification(job: JobOut, title: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!document.hidden) return; // only notify when user is away from the app
  let body = "";
  let heading = title;
  if (job.status === "completed") {
    heading = `✓ ${title}`;
    body = "Completed successfully.";
  } else if (job.status === "failed") {
    heading = `✗ ${title} failed`;
    body = job.error ? job.error : "Check the job logs for details.";
  } else if (job.status === "stopped") {
    heading = `⏹ ${title} stopped`;
    body = "The job was stopped. You can resume it from the job page.";
  }
  try {
    const n = new Notification(heading, { body, icon: "/favicon.ico" });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {
    // ignore
  }
}

export function JobActivityProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<JobActivityItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const itemsRef = useRef<JobActivityItem[]>([]);

  useEffect(() => {
    const initialItems = readStoredItems();
    setItems(initialItems);
    itemsRef.current = initialItems;
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    itemsRef.current = items;
    writeStoredItems(items);
  }, [items]);

  const trackJob = useCallback((job: JobOut, meta?: JobActivityMeta) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.id === job.id);
      const nextItem = mergeTrackedJob(existing, job, meta);
      const next = [nextItem, ...prev.filter((item) => item.id !== job.id)];
      return next.slice(0, MAX_ACTIVITY_ITEMS);
    });
  }, []);

  const dismissJob = useCallback((jobId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== jobId));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((item) => item.status !== "completed"));
  }, []);

  useEffect(() => {
    const syncJobs = async () => {
      const activeIds = itemsRef.current
        .filter((item) => ACTIVE_JOB_STATUSES.has(item.status))
        .map((item) => item.id);
      if (!activeIds.length) return;

      const jobs = await Promise.all(
        activeIds.map((jobId) => api.getJob(jobId).catch(() => null))
      );

      // Fire browser notifications for jobs that just reached a terminal state
      for (const job of jobs) {
        if (!job) continue;
        const prevItem = itemsRef.current.find((i) => i.id === job.id);
        if (
          prevItem &&
          ACTIVE_JOB_STATUSES.has(prevItem.status) &&
          TERMINAL_JOB_STATUSES.has(job.status)
        ) {
          fireJobNotification(job, prevItem.title ?? defaultTitleForJob(job));
        }
      }

      setItems((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          const job = jobs.find((candidate) => candidate?.id === item.id);
          if (!job) return item;
          const merged = mergeTrackedJob(item, job);
          if (
            merged.status !== item.status ||
            merged.currentRow !== item.currentRow ||
            merged.totalRows !== item.totalRows ||
            merged.error !== item.error ||
            merged.finishedAt !== item.finishedAt
          ) {
            changed = true;
            return merged;
          }
          return item;
        });
        return changed ? next : prev;
      });
    };

    void syncJobs();
    const timer = window.setInterval(() => {
      void syncJobs();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const activeCount = useMemo(
    () => items.filter((item) => ACTIVE_JOB_STATUSES.has(item.status)).length,
    [items],
  );

  const value = useMemo<JobActivityContextValue>(
    () => ({
      items,
      activeCount,
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((prev) => !prev),
      trackJob,
      dismissJob,
      clearFinished,
    }),
    [activeCount, clearFinished, dismissJob, isOpen, items, trackJob],
  );

  return (
    <JobActivityContext.Provider value={value}>
      {children}
    </JobActivityContext.Provider>
  );
}

export function useJobActivity(): JobActivityContextValue {
  const ctx = useContext(JobActivityContext);
  if (!ctx) throw new Error("useJobActivity must be used inside JobActivityProvider");
  return ctx;
}

export { ACTIVE_JOB_STATUSES, TERMINAL_JOB_STATUSES };
