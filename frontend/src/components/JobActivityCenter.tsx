"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle2, ChevronRight, Clock3, Loader2, Trash2, XCircle } from "lucide-react";
import { ACTIVE_JOB_STATUSES, TERMINAL_JOB_STATUSES, useJobActivity } from "@/contexts/JobActivityContext";

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return "";
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function statusTone(status: string): string {
  if (status === "completed") return "text-emerald-300 bg-emerald-600/10 border-emerald-700/30";
  if (status === "failed") return "text-red-300 bg-red-600/10 border-red-700/30";
  if (status === "stopped") return "text-amber-300 bg-amber-600/10 border-amber-700/30";
  if (status === "running") return "text-sky-300 bg-sky-600/10 border-sky-700/30";
  return "text-gray-300 bg-gray-700/40 border-gray-700";
}

function statusIcon(status: string) {
  if (status === "completed") return <CheckCircle2 size={15} className="text-emerald-400" />;
  if (status === "failed") return <XCircle size={15} className="text-red-400" />;
  if (status === "stopped") return <Clock3 size={15} className="text-amber-400" />;
  return <Loader2 size={15} className="text-sky-400 animate-spin" />;
}

function statusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "stopped") return "Stopped";
  if (status === "running") return "Running";
  return "Pending";
}

export default function JobActivityCenter() {
  const router = useRouter();
  const { items, activeCount, isOpen, toggle, close, dismissJob, clearFinished } = useJobActivity();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [close, isOpen]);

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const aActive = ACTIVE_JOB_STATUSES.has(a.status) ? 1 : 0;
      const bActive = ACTIVE_JOB_STATUSES.has(b.status) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return copy;
  }, [items]);

  const activeItems = sortedItems.filter((item) => ACTIVE_JOB_STATUSES.has(item.status));
  const recentItems = sortedItems.filter((item) => TERMINAL_JOB_STATUSES.has(item.status)).slice(0, 8);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-gray-300 transition hover:border-gray-700 hover:bg-gray-800 hover:text-white"
        aria-label="Open activity pipeline"
      >
        <Bell size={18} />
        {activeCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-lg">
            {activeCount > 9 ? "9+" : activeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-[120] mt-3 w-[min(92vw,25rem)] flex flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl" style={{ maxHeight: "min(80vh, 560px)" }}>
          {/* Header — fixed, never scrolls */}
          <div className="flex-shrink-0 border-b border-gray-700 bg-gray-900 px-4 py-4 rounded-t-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.26em] text-gray-500">Pipeline</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Background Activity</h3>
                <p className="mt-1 text-xs text-gray-400">
                  Track generation and publishing without stopping your workflow.
                </p>
              </div>
              {recentItems.length > 0 && (
                <button
                  type="button"
                  onClick={clearFinished}
                  className="rounded-lg border border-gray-700 px-2.5 py-1 text-[11px] font-medium text-gray-300 transition hover:border-gray-600 hover:bg-gray-800 hover:text-white"
                >
                  Clear finished
                </button>
              )}
            </div>
          </div>

          {/* Body — scrollable */}
          <div className="flex-1 overflow-y-auto bg-gray-900 px-3 py-3 rounded-b-2xl">
            {sortedItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800 px-4 py-8 text-center">
                <p className="text-sm font-medium text-white">No background jobs yet</p>
                <p className="mt-2 text-xs leading-5 text-gray-400">
                  Start a generation or publishing task and it will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {activeItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] uppercase tracking-[0.22em] text-gray-500">In Progress</p>
                    {activeItems.map((item) => {
                      const total = item.totalRows ?? 0;
                      const current = item.currentRow ?? 0;
                      const progressPct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            close();
                            router.push(item.href);
                          }}
                          className="group w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-left transition hover:border-gray-600 hover:bg-gray-750"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {statusIcon(item.status)}
                                <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                              </div>
                              {item.sourceLabel && (
                                <p className="mt-1 truncate text-xs text-gray-400">{item.sourceLabel}</p>
                              )}
                              <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
                                <span className={`rounded-full border px-2 py-0.5 ${statusTone(item.status)}`}>
                                  {statusLabel(item.status)}
                                </span>
                                <span>{formatRelativeTime(item.createdAt)}</span>
                                {total > 0 && <span>{current}/{total}</span>}
                              </div>
                            </div>
                            <ChevronRight size={16} className="mt-0.5 flex-shrink-0 text-gray-600 transition group-hover:text-gray-300" />
                          </div>
                          {progressPct !== null && (
                            <div className="mt-3">
                              <div className="h-1.5 overflow-hidden rounded-full bg-gray-700">
                                <div
                                  className="h-full rounded-full bg-brand-600 transition-all duration-300"
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {recentItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] uppercase tracking-[0.22em] text-gray-500">Recent</p>
                    {recentItems.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              router.push(item.href);
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2">
                              {statusIcon(item.status)}
                              <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                            </div>
                            {item.sourceLabel && (
                              <p className="mt-1 truncate text-xs text-gray-400">{item.sourceLabel}</p>
                            )}
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
                              <span className={`rounded-full border px-2 py-0.5 ${statusTone(item.status)}`}>
                                {statusLabel(item.status)}
                              </span>
                              <span>{formatRelativeTime(item.finishedAt || item.lastUpdatedAt)}</span>
                            </div>
                            {item.error && (
                              <p className="mt-2 line-clamp-2 text-xs text-red-300">{item.error}</p>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => dismissJob(item.id)}
                            className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-700 hover:text-gray-200"
                            aria-label="Dismiss job"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
