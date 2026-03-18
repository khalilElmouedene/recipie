"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Send,
  Save,
  ImageIcon,
  ExternalLink,
  List,
  LayoutGrid,
} from "lucide-react";
import {
  api,
  SharedRecipeInput,
  SiteOut,
  JobOut,
  PublishScheduleOut,
  GeneratedJobRecipeOut,
} from "@/lib/api";
import { getUserRole } from "@/lib/auth";

function thumbUrl(r: GeneratedJobRecipeOut): string | null {
  if (r.generated_images) {
    try {
      const arr = JSON.parse(r.generated_images);
      if (Array.isArray(arr) && arr[0]?.trim()) return arr[0].trim();
    } catch {}
  }
  return r.image_url?.trim() || null;
}

function statusClass(st: string) {
  if (st === "published") return "bg-emerald-600/20 text-emerald-400 border-emerald-800/40";
  if (st === "generated") return "bg-sky-600/20 text-sky-400 border-sky-800/40";
  if (st === "failed") return "bg-red-600/20 text-red-400 border-red-800/40";
  return "bg-gray-700 text-gray-300 border-gray-600";
}

export default function AllSitesGeneratePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const role = getUserRole();
  const canAdmin = role === "owner" || role === "admin";

  const [sites, setSites] = useState<SiteOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SharedRecipeInput[]>([{ image_url: "", recipe_text: "" }]);
  const [history, setHistory] = useState<JobOut[]>([]);
  const [schedule, setSchedule] = useState<PublishScheduleOut | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState(4);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [startingPublish, setStartingPublish] = useState(false);

  const [jobRecipeMap, setJobRecipeMap] = useState<Record<string, GeneratedJobRecipeOut[]>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  /** Summary = short page; Recipe cards = full list (can be very long with many sites × recipes) */
  const [showRecipeCards, setShowRecipeCards] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [deletingRecipeId, setDeletingRecipeId] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    api.getProjectJobs(projectId)
      .then((jobs) => setHistory(jobs.filter((j) => j.job_type === "articles_all_sites")))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    api.getSites(projectId).then(setSites).catch(() => {});
    loadHistory();
    api.getPublishSchedule(projectId)
      .then((s) => {
        setSchedule(s);
        setEnabled(s.enabled);
        setIntervalHours(s.interval_hours || 4);
      })
      .catch(() => {});
  }, [projectId, loadHistory]);

  const historyJobIds = history.map((j) => j.id).join(",");

  useEffect(() => {
    if (history.length === 0) {
      setJobRecipeMap({});
      setLoadingDetail(false);
      return;
    }
    if (!showRecipeCards) {
      setLoadingDetail(false);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    Promise.all(history.map((j) => api.getJobGeneratedRecipes(j.id).then((r) => [j.id, r] as const)))
      .then((pairs) => {
        if (!cancelled) {
          const m: Record<string, GeneratedJobRecipeOut[]> = {};
          pairs.forEach(([id, r]) => {
            m[id] = r;
          });
          setJobRecipeMap(m);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showRecipeCards, historyJobIds, history.length]);

  const validCount = rows
    .map((r) => ({ image_url: r.image_url.trim(), recipe_text: r.recipe_text.trim() }))
    .filter((r) => r.image_url && r.recipe_text).length;

  const handleRun = async () => {
    const valid = rows
      .map((r) => ({ image_url: r.image_url.trim(), recipe_text: r.recipe_text.trim() }))
      .filter((r) => r.image_url && r.recipe_text);
    if (!valid.length) {
      alert("Add at least one recipe with image URL and recipe text.");
      return;
    }
    if (sites.length === 0) {
      alert("Add at least one site first.");
      return;
    }
    setLoading(true);
    try {
      const job = await api.startJob(projectId, {
        job_type: "articles_all_sites",
        shared_recipes: valid,
      });
      router.push(`/jobs/${job.id}`);
    } catch (e: any) {
      alert(e.message || "Failed to start all-sites generation job");
      setLoading(false);
    }
  };

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const s = await api.setPublishSchedule(projectId, { enabled, interval_hours: intervalHours });
      setSchedule(s);
    } catch (e: any) {
      alert(e?.message || "Failed to save publish schedule");
    } finally {
      setSavingSchedule(false);
    }
  };

  const startPublishingNow = async () => {
    setStartingPublish(true);
    try {
      const s = await api.startPublishScheduleNow(projectId);
      setSchedule(s);
      setEnabled(s.enabled);
      setIntervalHours(s.interval_hours || 4);
    } catch (e: any) {
      alert(e?.message || "Failed to start publishing queue");
    } finally {
      setStartingPublish(false);
    }
  };

  const deleteJob = async (jobId: string) => {
    if (!canAdmin) return;
    if (
      !confirm(
        "Delete this run and all recipes created by it? This cannot be undone."
      )
    )
      return;
    setDeletingJobId(jobId);
    try {
      await api.deleteJob(jobId);
      setHistory((h) => h.filter((j) => j.id !== jobId));
      setJobRecipeMap((m) => {
        const next = { ...m };
        delete next[jobId];
        return next;
      });
    } catch (e: any) {
      alert(e?.message || "Failed to delete job");
    } finally {
      setDeletingJobId(null);
    }
  };

  const deleteRecipe = async (jobId: string, recipeId: string) => {
    if (!canAdmin) return;
    if (!confirm("Delete this recipe?")) return;
    setDeletingRecipeId(recipeId);
    try {
      await api.deleteRecipe(recipeId);
      setJobRecipeMap((m) => ({
        ...m,
        [jobId]: (m[jobId] || []).filter((r) => r.id !== recipeId),
      }));
    } catch (e: any) {
      alert(e?.message || "Failed to delete recipe");
    } finally {
      setDeletingRecipeId(null);
    }
  };

  return (
    <div>
      <button
        onClick={() => router.push(`/projects/${projectId}`)}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4"
      >
        <ArrowLeft size={16} /> Back to Project
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Generate Articles For All Sites</h1>
        <p className="text-sm text-gray-400 mt-1">
          One Midjourney generation per recipe input, reused across all sites.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Sites: {sites.length} · Valid recipe inputs: {validCount} · Planned article generations:{" "}
          {validCount * sites.length}
        </p>
      </div>

      <div className="card mb-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-2">Publishing Schedule</h2>
        <p className="text-xs text-gray-500 mb-3">
          Queue mode: the scheduler publishes one article every interval across all sites. Example: 12
          articles = 12 intervals.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable scheduler
          </label>
          <label className="text-sm text-gray-300">
            Interval (hours)
            <input
              type="number"
              min={1}
              max={168}
              value={intervalHours}
              onChange={(e) => setIntervalHours(Number(e.target.value || 4))}
              className="input-field mt-1"
            />
          </label>
          <div className="flex md:justify-end gap-2 flex-wrap">
            <button
              onClick={saveSchedule}
              disabled={savingSchedule}
              className="btn-secondary flex items-center gap-2 w-full md:w-auto justify-center"
            >
              <Save size={14} /> {savingSchedule ? "Saving..." : "Save Schedule"}
            </button>
            <button
              onClick={startPublishingNow}
              disabled={startingPublish}
              className="btn-primary flex items-center gap-2 w-full md:w-auto justify-center"
              title="Start queue immediately (publishes one article now, then continues by interval)"
            >
              <Send size={14} /> {startingPublish ? "Starting..." : "Start Publishing"}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {schedule?.next_run_at ? `Next run: ${new Date(schedule.next_run_at).toLocaleString()}` : "No next run scheduled"}
        </p>
        {schedule?.last_error && (
          <p className="text-xs text-red-400 mt-1">Last scheduler message: {schedule.last_error}</p>
        )}
      </div>

      <div className="card mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-gray-300">History</h2>
          {history.length > 0 && (
            <div
              className="flex items-center gap-1 p-0.5 rounded-lg bg-gray-800/80 border border-gray-700 w-fit"
              role="group"
              aria-label="History display mode"
            >
              <button
                type="button"
                onClick={() => setShowRecipeCards(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  !showRecipeCards ? "bg-brand-600 text-white" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                <List size={14} /> Summary
              </button>
              <button
                type="button"
                onClick={() => setShowRecipeCards(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  showRecipeCards ? "bg-brand-600 text-white" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                <LayoutGrid size={14} /> Recipe cards
              </button>
            </div>
          )}
        </div>
        {!showRecipeCards && history.length > 0 && (
          <p className="text-xs text-gray-500 mb-3">
            Summary keeps the page short. Use <strong className="text-gray-400">Recipe cards</strong> to see every
            recipe per site (long list with many runs).
          </p>
        )}

        {history.length === 0 ? (
          <p className="text-sm text-gray-500">No previous all-sites jobs yet.</p>
        ) : !showRecipeCards ? (
          <div className="space-y-2">
            {history.map((j) => (
              <div
                key={j.id}
                className="rounded-xl border border-gray-700/80 bg-gray-900/40 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium">
                    Job <span className="font-mono text-brand-300">{j.id.slice(0, 8)}</span>
                    <span className={`ml-2 text-[10px] uppercase px-2 py-0.5 rounded border ${statusClass(j.status)}`}>
                      {j.status}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(j.created_at).toLocaleString()}
                    {j.total_rows != null && j.total_rows > 0 && (
                      <span className="ml-2 text-gray-400">· {j.total_rows} recipe{j.total_rows !== 1 ? "s" : ""}</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => router.push(`/jobs/${j.id}`)} className="btn-secondary text-xs px-3 py-1.5">
                    Logs
                  </button>
                  {j.status !== "running" && (
                    <>
                      <button
                        onClick={() => router.push(`/jobs/${j.id}/results`)}
                        className="btn-secondary text-xs px-3 py-1.5"
                      >
                        Results
                      </button>
                      <button
                        onClick={() => router.push(`/projects/${projectId}/sites/all-sites-pins/${j.id}`)}
                        className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 border-purple-700/50 text-purple-300"
                      >
                        <ImageIcon size={12} /> Pin designer
                      </button>
                      {canAdmin && (
                        <button
                          onClick={() => deleteJob(j.id)}
                          disabled={deletingJobId === j.id}
                          className="text-xs px-3 py-1.5 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-950/30 disabled:opacity-50"
                        >
                          {deletingJobId === j.id ? "…" : "Delete run"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {loadingDetail && (
              <p className="text-sm text-gray-500 py-4">Loading recipe cards…</p>
            )}
            {!loadingDetail &&
              history.map((j) => {
                const recipes = jobRecipeMap[j.id] || [];
                return (
                  <div key={j.id} className="border border-gray-800 rounded-xl overflow-hidden">
                    <div className="bg-gray-800/50 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs text-gray-500">Job</span>{" "}
                        <span className="font-mono text-sm text-white">{j.id.slice(0, 8)}</span>
                        <span className={`ml-2 text-[10px] uppercase px-2 py-0.5 rounded border ${statusClass(j.status)}`}>
                          {j.status}
                        </span>
                        <span className="text-xs text-gray-500 ml-2">
                          {new Date(j.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <button
                          onClick={() => router.push(`/jobs/${j.id}`)}
                          className="btn-secondary text-xs px-2 py-1"
                        >
                          Logs
                        </button>
                        {j.status !== "running" && (
                          <>
                            <button
                              onClick={() => router.push(`/jobs/${j.id}/results`)}
                              className="btn-secondary text-xs px-2 py-1"
                            >
                              Results
                            </button>
                            <button
                              onClick={() => router.push(`/projects/${projectId}/sites/all-sites-pins/${j.id}`)}
                              className="btn-secondary text-xs px-2 py-1 flex items-center gap-1 border-purple-700/50 text-purple-300"
                            >
                              <ImageIcon size={12} /> Pin designer
                            </button>
                            {canAdmin && (
                              <button
                                onClick={() => deleteJob(j.id)}
                                disabled={deletingJobId === j.id}
                                className="text-xs px-2 py-1 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-950/30 disabled:opacity-50"
                              >
                                {deletingJobId === j.id ? "…" : "Delete run"}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="p-2 sm:p-3 space-y-2">
                      {recipes.length === 0 && !loadingDetail ? (
                        <p className="text-xs text-gray-600 py-2">No recipes linked.</p>
                      ) : (
                        recipes.map((r) => {
                          const thumb = thumbUrl(r);
                          const title = r.recipe_text?.split("\n")[0]?.trim() || "Recipe";
                          return (
                            <div
                              key={r.id}
                              className="flex gap-3 rounded-lg border border-gray-700/60 bg-gray-950/50 p-2 sm:p-3 items-center"
                            >
                              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-gray-800 flex-shrink-0 overflow-hidden border border-gray-700">
                                {thumb ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={thumb} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px]">
                                    No img
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-white line-clamp-2">{title}</p>
                                <p className="text-[11px] text-gray-500 truncate mt-0.5">{r.site_domain}</p>
                                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded border ${statusClass(r.status)}`}
                                  >
                                    {r.status}
                                  </span>
                                  {r.category && (
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                                      {r.category}
                                    </span>
                                  )}
                                  {r.wp_permalink && (
                                    <a
                                      href={r.wp_permalink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[10px] text-sky-400 flex items-center gap-0.5"
                                    >
                                      <ExternalLink size={10} /> Post
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-1 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    router.push(
                                      `/projects/${projectId}/sites/${r.site_id}/designer?recipe=${r.id}`
                                    )
                                  }
                                  className="p-2 rounded-lg text-gray-400 hover:text-purple-400 hover:bg-gray-800"
                                  title="Pin designer"
                                >
                                  <ImageIcon size={18} />
                                </button>
                                {canAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => deleteRecipe(j.id, r.id)}
                                    disabled={deletingRecipeId === r.id}
                                    className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-gray-800 disabled:opacity-40"
                                    title="Delete recipe"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {rows.map((r, idx) => (
          <div key={idx} className="card border border-gray-700">
            <div className="text-xs text-gray-500 mb-2">Recipe Input #{idx + 1}</div>
            <div className="space-y-2">
              <input
                value={r.image_url}
                onChange={(e) =>
                  setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, image_url: e.target.value } : x)))
                }
                className="input-field"
                placeholder="Image URL"
              />
              <textarea
                value={r.recipe_text}
                onChange={(e) =>
                  setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, recipe_text: e.target.value } : x)))
                }
                className="input-field"
                placeholder="Recipe text/title"
                rows={4}
              />
            </div>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                className="mt-2 text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { image_url: "", recipe_text: "" }])}
          className="btn-secondary flex items-center gap-2"
        >
          <Plus size={16} /> Add Recipe Input
        </button>
        <button onClick={handleRun} disabled={loading} className="btn-primary flex items-center gap-2">
          <Send size={16} /> {loading ? "Starting..." : "Run All Sites Job"}
        </button>
      </div>
    </div>
  );
}
