"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RefreshCcw,
  ServerCrash,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import {
  api,
  OperationsCheckOut,
  OperationsFailureOut,
  OperationsMetricOut,
  OperationsOverviewOut,
  OperationsTaskOut,
} from "@/lib/api";

function metricToneClass(tone: string): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10";
    case "danger":
      return "border-red-500/30 bg-red-500/10";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10";
    default:
      return "border-gray-800";
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "ok":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
    case "critical":
    case "failed":
      return "bg-red-500/15 text-red-300 border border-red-500/30";
    case "warning":
      return "bg-amber-500/15 text-amber-300 border border-amber-500/30";
    default:
      return "bg-gray-800 text-gray-300 border border-gray-700";
  }
}

function statusLabel(status: string): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function failureKindLabel(kind: string): string {
  switch (kind) {
    case "job":
      return "Job";
    case "recipe":
      return "Recipe";
    case "threads":
      return "Threads";
    case "schedule":
      return "Schedule";
    default:
      return "Issue";
  }
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function MetricCard({ metric }: { metric: OperationsMetricOut }) {
  return (
    <div className={`card ${metricToneClass(metric.tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-400">{metric.label}</p>
          <p className="mt-3 text-3xl font-bold text-white">{metric.value}</p>
        </div>
        <div className="rounded-xl bg-gray-800/70 p-2.5 text-brand-400">
          <Activity size={18} />
        </div>
      </div>
      {metric.hint && <p className="mt-3 text-sm text-gray-400">{metric.hint}</p>}
    </div>
  );
}

function MonitoringItem({ item }: { item: OperationsCheckOut }) {
  return (
    <div className="card flex h-full flex-col justify-between gap-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-white">{item.label}</h3>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(item.status)}`}>
            {statusLabel(item.status)}
          </span>
        </div>
        <p className="text-sm leading-6 text-gray-400">{item.detail}</p>
      </div>
      {item.href ? (
        <Link href={item.href} className="inline-flex items-center gap-2 text-sm font-medium text-brand-400 hover:text-brand-300">
          Open
          <ArrowRight size={14} />
        </Link>
      ) : (
        <span className="text-sm text-gray-500">Read-only visibility</span>
      )}
    </div>
  );
}

function TaskItem({ task }: { task: OperationsTaskOut }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-full p-1 ${task.done ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
          <CheckCircle2 size={16} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{task.label}</p>
          <p className="mt-1 text-sm leading-6 text-gray-400">{task.detail}</p>
        </div>
      </div>
      {task.href ? (
        <Link href={task.href} className="shrink-0 text-sm font-medium text-brand-400 hover:text-brand-300">
          {task.done ? "View" : "Continue"}
        </Link>
      ) : (
        <span className="shrink-0 text-xs uppercase tracking-wide text-gray-500">
          {task.done ? "Done" : "Owner action"}
        </span>
      )}
    </div>
  );
}

function FailureItem({ failure }: { failure: OperationsFailureOut }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300">
              {failureKindLabel(failure.kind)}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(failure.status)}`}>
              {statusLabel(failure.status)}
            </span>
          </div>
          <h3 className="text-base font-semibold text-white">{failure.title}</h3>
          <p className="text-sm leading-6 text-gray-400">{failure.detail}</p>
        </div>
        <div className="flex min-w-[170px] flex-col items-start gap-3 md:items-end">
          <span className="text-sm text-gray-500">{formatTimestamp(failure.created_at)}</span>
          <Link href={failure.href} className="inline-flex items-center gap-2 text-sm font-medium text-brand-400 hover:text-brand-300">
            Investigate
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function OperationsPage() {
  const [overview, setOverview] = useState<OperationsOverviewOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const data = await api.getOperationsOverview();
      setOverview(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load operations overview";
      setForbidden(message.toLowerCase().includes("owner or admin access required"));
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading && !overview) {
    return <div className="text-gray-400">Loading operations overview...</div>;
  }

  const analytics = overview?.analytics ?? [];
  const monitoring = overview?.monitoring ?? [];
  const onboarding = overview?.onboarding ?? [];
  const failures = overview?.failures ?? [];
  const completedTasks = onboarding.filter((task) => task.done).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1 text-sm font-medium text-brand-300">
            <ShieldCheck size={15} />
            Read-only workspace health
          </div>
          <h1 className="text-2xl font-bold text-white">Operations</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
            A safe production view for analytics, integration readiness, onboarding progress, and recent failures.
          </p>
        </div>

        <button
          onClick={() => void load()}
          disabled={loading}
          className="btn-secondary inline-flex items-center gap-2 self-start"
        >
          <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-300" />
          <div>
            <p className="text-sm font-semibold text-red-200">
              {forbidden ? "This page is limited to owners and admins" : "Could not load the operations overview"}
            </p>
            <p className="mt-1 text-sm text-red-300/90">
              {forbidden ? "Members should use the project pages for project-specific health and failure visibility." : error}
            </p>
          </div>
        </div>
      )}

      {forbidden && (
        <div className="card border-amber-500/30 bg-amber-500/10">
          <p className="text-sm font-semibold text-amber-200">Need project-level visibility instead?</p>
          <p className="mt-1 text-sm text-amber-300/90">
            Open a project to see its local health summary, schedule status, and recent failures without exposing workspace-wide operations data.
          </p>
        </div>
      )}

      {!forbidden && <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Analytics Snapshot</h2>
          <p className="mt-1 text-sm text-gray-400">High-signal metrics for production activity and delivery health.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {analytics.map((metric) => (
            <MetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      </section>}

      {!forbidden && <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Monitoring</h2>
          <p className="mt-1 text-sm text-gray-400">Integration and automation checks that often surface silent production risks.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {monitoring.map((item) => (
            <MonitoringItem key={item.key} item={item} />
          ))}
        </div>
      </section>}

      {!forbidden && <section className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Onboarding Progress</h2>
            <p className="mt-1 text-sm text-gray-400">A quick checklist for getting a workspace fully usable.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900 px-3 py-1 text-sm text-gray-300">
            <Sparkles size={15} className="text-brand-400" />
            {completedTasks}/{onboarding.length} completed
          </div>
        </div>
        <div className="space-y-3">
          {onboarding.map((task) => (
            <TaskItem key={task.key} task={task} />
          ))}
        </div>
      </section>}

      {!forbidden && <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Recent Failures</h2>
          <p className="mt-1 text-sm text-gray-400">The newest job, recipe, Threads, and schedule issues in one queue.</p>
        </div>

        {failures.length === 0 ? (
          <div className="card flex items-start gap-3 border-emerald-500/20 bg-emerald-500/10">
            <ServerCrash size={18} className="mt-0.5 shrink-0 text-emerald-300" />
            <div>
              <p className="text-sm font-semibold text-emerald-200">No recent failures found</p>
              <p className="mt-1 text-sm text-emerald-300/90">
                This view is currently clear across jobs, recipes, publish schedules, and Threads posts.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {failures.map((failure) => (
              <FailureItem key={`${failure.kind}-${failure.id}`} failure={failure} />
            ))}
          </div>
        )}
      </section>}
    </div>
  );
}
