"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, Award, BarChart2, Calendar, CheckCircle2, ChevronDown, ChevronUp,
  ExternalLink, FileText, FolderKanban, Globe, RefreshCw, TrendingUp,
  XCircle, Zap, Clock, AlertCircle,
} from "lucide-react";
import { api, OwnerAnalytics, ProjectAnalytics } from "@/lib/api";
import { getUserEmail } from "@/lib/auth";

// ── helpers ────────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent: string; // tailwind border-color class
}) {
  return (
    <div className={`card p-5 border-l-4 ${accent} flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{label}</p>
        <Icon size={16} className="text-gray-500 shrink-0" />
      </div>
      <div>
        <p className="text-3xl font-bold text-white tabular-nums">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function JobBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    articles:            { label: "Generate",   cls: "bg-purple-500/20 text-purple-300 border border-purple-500/30" },
    publisher:           { label: "Publish",    cls: "bg-green-500/20  text-green-300  border border-green-500/30"  },
    articles_all_sites:  { label: "All Sites",  cls: "bg-blue-500/20   text-blue-300   border border-blue-500/30"   },
    auto_spy_generate:   { label: "Auto Spy",   cls: "bg-orange-500/20 text-orange-300 border border-orange-500/30" },
  };
  const info = map[type] ?? { label: type, cls: "bg-gray-500/20 text-gray-300 border border-gray-500/30" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${info.cls}`}>{info.label}</span>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { icon: React.ElementType; cls: string }> = {
    completed: { icon: CheckCircle2, cls: "text-green-400" },
    running:   { icon: RefreshCw,    cls: "text-blue-400 animate-spin" },
    failed:    { icon: XCircle,      cls: "text-red-400"  },
    stopped:   { icon: AlertCircle,  cls: "text-yellow-400" },
    pending:   { icon: Clock,        cls: "text-gray-400" },
  };
  const info = map[status] ?? { icon: Clock, cls: "text-gray-400" };
  const Icon = info.icon;
  return <Icon size={14} className={info.cls} />;
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
      <div className={`${color} h-1.5 rounded-full transition-all duration-700`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
    </div>
  );
}

// ── Project row ────────────────────────────────────────────────────────────────

function ProjectRow({ p }: { p: ProjectAnalytics }) {
  const [open, setOpen] = useState(false);
  const pubRate = p.total > 0 ? p.published / p.total : 0;

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-4 p-4 hover:bg-gray-800/40 transition text-left group"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white group-hover:text-brand-300 transition">{p.name}</span>
            <span className="text-xs text-gray-500 shrink-0">{p.site_count} site{p.site_count !== 1 ? "s" : ""}</span>
          </div>
          <div className="mt-1.5 w-48">
            <MiniBar pct={pubRate} color="bg-green-500" />
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-6 text-xs shrink-0">
          <div className="text-center">
            <p className="text-white font-semibold text-base">{p.total}</p>
            <p className="text-gray-500">total</p>
          </div>
          <div className="text-center">
            <p className="text-green-400 font-semibold text-base">{p.published}</p>
            <p className="text-gray-500">published</p>
          </div>
          <div className="text-center">
            <p className="text-purple-400 font-semibold text-base">{p.generated}</p>
            <p className="text-gray-500">generated</p>
          </div>
          {p.failed > 0 && (
            <div className="text-center">
              <p className="text-red-400 font-semibold text-base">{p.failed}</p>
              <p className="text-gray-500">failed</p>
            </div>
          )}
          <div className="text-center">
            <p className="text-brand-400 font-semibold text-base">{Math.round(pubRate * 100)}%</p>
            <p className="text-gray-500">rate</p>
          </div>
        </div>

        {open ? <ChevronUp size={16} className="text-gray-500 shrink-0" /> : <ChevronDown size={16} className="text-gray-500 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-gray-800">
          {p.sites.length === 0 ? (
            <p className="text-xs text-gray-500 p-4">No sites.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-800/50">
                    <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Site</th>
                    <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Total</th>
                    <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Published</th>
                    <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Generated</th>
                    <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Pending</th>
                    <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Failed</th>
                    <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Rate</th>
                    <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Last Published</th>
                  </tr>
                </thead>
                <tbody>
                  {p.sites.map(s => {
                    const r = s.total > 0 ? s.published / s.total : 0;
                    return (
                      <tr key={s.id} className="border-t border-gray-800/60 hover:bg-gray-800/20 transition">
                        <td className="px-4 py-3">
                          <p className="text-white font-medium">{s.domain}</p>
                          {s.last_title && (
                            <p className="text-gray-500 text-xs truncate max-w-xs mt-0.5" title={s.last_title}>{s.last_title}</p>
                          )}
                        </td>
                        <td className="text-right px-4 py-3 text-gray-300 font-medium">{s.total}</td>
                        <td className="text-right px-4 py-3 text-green-400 font-semibold">{s.published}</td>
                        <td className="text-right px-4 py-3 text-purple-400">{s.generated}</td>
                        <td className="text-right px-4 py-3 text-yellow-400">{s.pending}</td>
                        <td className="text-right px-4 py-3 text-red-400">{s.failed}</td>
                        <td className="text-right px-4 py-3">
                          <span className={`font-semibold ${r >= 0.8 ? "text-green-400" : r >= 0.4 ? "text-yellow-400" : "text-red-400"}`}>
                            {Math.round(r * 100)}%
                          </span>
                        </td>
                        <td className="text-right px-4 py-3 text-gray-400">
                          {s.last_published_at ? fmtShort(s.last_published_at) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<OwnerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => {
    setRefreshing(true);
    api.getAnalytics()
      .then(setData)
      .catch(console.error)
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => {
    const email = (getUserEmail() || "").trim().toLowerCase();
    if (email !== "khalil@gmail.com") { router.replace("/"); return; }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <RefreshCw size={32} className="animate-spin text-brand-400" />
        <p className="text-sm text-gray-400">Loading analytics…</p>
      </div>
    );
  }
  if (!data) return null;

  const maxBar = Math.max(...data.monthly.map(m => m.generated), 1);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <BarChart2 size={24} className="text-brand-400" />
            Analytics Overview
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Your complete content production dashboard — all projects, sites and articles at a glance.
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="btn-secondary flex items-center gap-2 text-sm shrink-0"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard icon={FolderKanban}  label="Projects"     value={data.total_projects}                                    accent="border-blue-500"   />
        <KpiCard icon={Globe}         label="Sites"        value={data.total_sites}                                       accent="border-cyan-500"   />
        <KpiCard icon={FileText}      label="Generated"    value={data.total_recipes}   sub={`${data.total_generated} ready`} accent="border-purple-500" />
        <KpiCard icon={CheckCircle2}  label="Published"    value={data.total_published}                                   accent="border-green-500"  />
        <KpiCard icon={TrendingUp}    label="Success Rate" value={`${data.success_rate}%`}                                accent="border-brand-500"  />
        <KpiCard icon={Zap}           label="Jobs Run"     value={data.total_jobs}      sub={`${data.total_jobs_completed} ok`} accent="border-orange-500" />
      </div>

      {/* ── Last published + status breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Last published — 2 cols */}
        <div className="lg:col-span-2 card p-6 flex flex-col gap-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
            <Award size={13} />  Last Published Article
          </p>
          {data.last_published ? (
            <>
              <p className="text-lg font-semibold text-white leading-snug">
                {data.last_published.title}
              </p>
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
                <span className="flex items-center gap-1.5">
                  <Globe size={13} /> {data.last_published.site_domain}
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar size={13} /> {fmt(data.last_published.created_at)}
                </span>
                {data.last_published.wp_permalink && (
                  <a
                    href={data.last_published.wp_permalink}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-brand-400 hover:text-brand-300 transition"
                  >
                    <ExternalLink size={13} /> View live post
                  </a>
                )}
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>Overall publish rate</span>
                  <span className="text-white font-medium">{data.success_rate}%</span>
                </div>
                <div className="bg-gray-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-2.5 rounded-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-1000"
                    style={{ width: `${Math.min(data.success_rate, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-600 mt-1">
                  <span>{data.total_published} published</span>
                  <span>{data.total_recipes} total</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-gray-500 text-sm flex-1 flex items-center">No articles published yet.</p>
          )}
        </div>

        {/* Status breakdown — 1 col */}
        <div className="card p-6 flex flex-col gap-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Status Breakdown</p>
          {[
            { label: "Published",         value: data.total_published, color: "bg-green-500",  pct: data.total_recipes ? data.total_published / data.total_recipes : 0 },
            { label: "Ready (generated)", value: data.total_generated, color: "bg-purple-500", pct: data.total_recipes ? data.total_generated / data.total_recipes : 0 },
            { label: "Pending",           value: data.total_pending,   color: "bg-yellow-500", pct: data.total_recipes ? data.total_pending   / data.total_recipes : 0 },
            { label: "Failed",            value: data.total_failed,    color: "bg-red-500",    pct: data.total_recipes ? data.total_failed    / data.total_recipes : 0 },
          ].map(s => (
            <div key={s.label} className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">{s.label}</span>
                <span className="text-white font-semibold">{s.value.toLocaleString()}</span>
              </div>
              <MiniBar pct={s.pct} color={s.color} />
            </div>
          ))}
          <div className="pt-2 border-t border-gray-800 grid grid-cols-2 gap-3 text-xs">
            <div className="card p-3 bg-gray-800/60">
              <p className="text-gray-400">Jobs Failed</p>
              <p className="text-red-400 font-bold text-lg">{data.total_jobs_failed}</p>
            </div>
            <div className="card p-3 bg-gray-800/60">
              <p className="text-gray-400">Pending</p>
              <p className="text-yellow-400 font-bold text-lg">{data.total_pending}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Monthly chart ── */}
      {data.monthly.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
              <Activity size={13} /> Monthly Activity — last 6 months
            </p>
            <div className="flex items-center gap-5 text-xs text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-purple-500 inline-block" /> Generated
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> Published
              </span>
            </div>
          </div>

          <div className="flex items-end gap-2 sm:gap-4" style={{ height: 140 }}>
            {data.monthly.map(m => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full">
                <div className="w-full flex items-end gap-0.5 flex-1">
                  {/* Generated bar */}
                  <div
                    className="flex-1 bg-purple-500/50 hover:bg-purple-500 rounded-t-sm transition-all duration-500 cursor-default relative group"
                    style={{ height: `${(m.generated / maxBar) * 100}%`, minHeight: m.generated > 0 ? 4 : 0 }}
                  >
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
                      {m.generated} gen
                    </div>
                  </div>
                  {/* Published bar */}
                  <div
                    className="flex-1 bg-green-500/50 hover:bg-green-500 rounded-t-sm transition-all duration-500 cursor-default relative group"
                    style={{ height: `${(m.published / maxBar) * 100}%`, minHeight: m.published > 0 ? 4 : 0 }}
                  >
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
                      {m.published} pub
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 text-center whitespace-nowrap">{m.month}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Projects breakdown ── */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest flex items-center gap-1.5 px-1">
          <FolderKanban size={13} /> Projects Breakdown
        </p>
        {data.projects.length === 0 && (
          <p className="text-sm text-gray-500 card p-4">No projects found.</p>
        )}
        {data.projects.map(p => <ProjectRow key={p.id} p={p} />)}
      </div>

      {/* ── Recent jobs ── */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest flex items-center gap-1.5 px-1">
          <Activity size={13} /> Recent Jobs
        </p>
        <div className="card divide-y divide-gray-800/80">
          {data.recent_jobs.length === 0 && (
            <p className="text-sm text-gray-500 p-4">No jobs yet.</p>
          )}
          {data.recent_jobs.map(j => (
            <div key={j.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/30 transition">
              <StatusPill status={j.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <JobBadge type={j.job_type} />
                  <span className="text-sm text-white truncate">{j.project_name}</span>
                </div>
                {j.total_rows != null && (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="w-24 bg-gray-800 rounded-full h-1">
                      <div
                        className="bg-brand-500 h-1 rounded-full"
                        style={{ width: `${Math.min(((j.current_row ?? 0) / j.total_rows) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{j.current_row ?? 0}/{j.total_rows}</span>
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-400 font-medium">{timeAgo(j.created_at)}</p>
                {j.finished_at && (
                  <p className="text-xs text-gray-600">{fmtShort(j.finished_at)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
