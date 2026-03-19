"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Send,
  Save,
  Download,
  Upload,
  ImageIcon,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Globe,
  RefreshCw,
} from "lucide-react";
import {
  api,
  SharedRecipeInput,
  SiteOut,
  JobOut,
  PublishScheduleOut,
  GeneratedJobRecipeOut,
  RecipeOut,
} from "@/lib/api";
import { getUserRole } from "@/lib/auth";
import { sanitizeHtml } from "@/lib/sanitize";

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

const statusColor: Record<string, string> = {
  pending: "bg-gray-700 text-gray-300",
  generating: "bg-blue-600/20 text-blue-400",
  generated: "bg-cyan-600/20 text-cyan-400",
  published: "bg-green-600/20 text-green-400",
  failed: "bg-red-600/20 text-red-400",
};

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
  const [intervalMinutes, setIntervalMinutes] = useState(240);
  const [imageRetentionDays, setImageRetentionDays] = useState(4);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [startingPublish, setStartingPublish] = useState(false);
  const [importingExcel, setImportingExcel] = useState(false);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const [jobRecipeMap, setJobRecipeMap] = useState<Record<string, GeneratedJobRecipeOut[]>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [deletingRecipeId, setDeletingRecipeId] = useState<string | null>(null);

  const [collapsedJobs, setCollapsedJobs] = useState<Set<string>>(new Set());
  const [expandedRecipeId, setExpandedRecipeId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"article" | "recipe" | "seo" | "images">("article");
  const [recipeFullById, setRecipeFullById] = useState<Record<string, RecipeOut>>({});
  const [loadingRecipeDetailId, setLoadingRecipeDetailId] = useState<string | null>(null);
  const [wpPublishingId, setWpPublishingId] = useState<string | null>(null);
  const detailsLoadedRef = useRef<Set<string>>(new Set());

  const loadHistory = useCallback(() => {
    api.getProjectJobs(projectId)
      .then((jobs) => setHistory(jobs.filter((j) => j.job_type === "articles_all_sites")))
      .catch(() => {});
  }, [projectId]);

  const ensureRecipeFull = useCallback(async (recipeId: string) => {
    if (detailsLoadedRef.current.has(recipeId)) return;
    setLoadingRecipeDetailId(recipeId);
    try {
      const full = await api.getRecipe(recipeId);
      setRecipeFullById((m) => ({ ...m, [recipeId]: full }));
      detailsLoadedRef.current.add(recipeId);
    } catch {
      /* keep row without full detail */
    } finally {
      setLoadingRecipeDetailId((c) => (c === recipeId ? null : c));
    }
  }, []);

  useEffect(() => {
    api.getSites(projectId).then(setSites).catch(() => {});
    loadHistory();
    api.getPublishSchedule(projectId)
      .then((s) => {
        setSchedule(s);
        setEnabled(s.enabled);
        setIntervalMinutes(s.interval_minutes || 240);
        setImageRetentionDays(s.image_retention_days || 4);
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
  }, [historyJobIds, history.length]);

  const validCount = rows
    .map((r) => ({ image_url: r.image_url.trim(), recipe_text: r.recipe_text.trim() }))
    .filter((r) => r.image_url && r.recipe_text).length;
  const hasRunningGeneration = history.some((j) => j.status === "running" || j.status === "pending");
  const hasAnyGeneratedRecipes = Object.values(jobRecipeMap).some((arr) =>
    arr.some((r) => r.status === "generated" || r.status === "published")
  );

  const canStartPublishing =
    !startingPublish &&
    !hasRunningGeneration &&
    hasAnyGeneratedRecipes;

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
      const s = await api.setPublishSchedule(projectId, {
        enabled,
        interval_minutes: intervalMinutes,
        image_retention_days: imageRetentionDays,
      });
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
      setIntervalMinutes(s.interval_minutes || 240);
      setImageRetentionDays(s.image_retention_days || 4);
    } catch (e: any) {
      alert(e?.message || "Failed to start publishing queue");
    } finally {
      setStartingPublish(false);
    }
  };

  const handleExcelImport = async (file: File) => {
    setImportingExcel(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) {
        alert("Excel file has no sheet.");
        return;
      }

      const ws = wb.Sheets[firstSheet];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!rawRows.length) {
        alert("No rows found in Excel.");
        return;
      }

      const normalize = (v: unknown) => String(v ?? "").trim();
      const normKey = (k: string) => k.toLowerCase().replace(/[\s-]+/g, "_");

      const imported: SharedRecipeInput[] = rawRows
        .map((row) => {
          const mapped: Record<string, string> = {};
          Object.entries(row).forEach(([k, v]) => {
            mapped[normKey(k)] = normalize(v);
          });
          const imageUrl =
            mapped.image_url ||
            mapped.image ||
            mapped.url ||
            "";
          const recipeText =
            mapped.recipe_text ||
            mapped.recipe ||
            mapped.text ||
            mapped.title ||
            "";
          return { image_url: imageUrl, recipe_text: recipeText };
        })
        .filter((r) => r.image_url && r.recipe_text);

      if (!imported.length) {
        alert('No valid rows found. Required columns: "image_url" and "recipe_text".');
        return;
      }

      setRows(imported);
      alert(`Imported ${imported.length} recipe input(s) from Excel.`);
    } catch (e: any) {
      alert(e?.message || "Failed to import Excel file");
    } finally {
      setImportingExcel(false);
      if (excelInputRef.current) excelInputRef.current.value = "";
    }
  };

  const downloadExcelTemplate = () => {
    const templateRows = [
      { image_url: 'https://example.com/image-1.jpg', recipe_text: 'Recipe title or full recipe text' },
      { image_url: 'https://example.com/image-2.jpg', recipe_text: 'Another recipe text' },
    ];
    const ws = XLSX.utils.json_to_sheet(templateRows, {
      header: ['image_url', 'recipe_text'],
      skipHeader: false,
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'recipes');
    XLSX.writeFile(wb, 'recipe_input_template.xlsx');
  };

  const deleteJob = async (jobId: string) => {
    if (!canAdmin) return;
    if (!confirm("Delete this run and all recipes created by it? This cannot be undone.")) return;
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
      detailsLoadedRef.current.delete(recipeId);
      setRecipeFullById((m) => {
        const n = { ...m };
        delete n[recipeId];
        return n;
      });
      if (expandedRecipeId === recipeId) setExpandedRecipeId(null);
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

  const handlePublishWp = async (recipeId: string) => {
    setWpPublishingId(recipeId);
    try {
      let full = recipeFullById[recipeId];
      if (!full) {
        full = await api.getRecipe(recipeId);
        setRecipeFullById((m) => ({ ...m, [recipeId]: full }));
        detailsLoadedRef.current.add(recipeId);
      }
      if (!full.generated_article) {
        alert("No article to publish.");
        return;
      }
      const data = await api.publishRecipeArticle(recipeId);
      alert(`Published!\n${data.wp_permalink}`);
      const updated = await api.getRecipe(recipeId);
      setRecipeFullById((m) => ({ ...m, [recipeId]: updated }));
    } catch (e: any) {
      alert(e?.message || "Publish failed");
    } finally {
      setWpPublishingId(null);
    }
  };

  const toggleCollapseJob = (jobId: string) => {
    setCollapsedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const toggleExpand = (recipeId: string) => {
    const next = expandedRecipeId === recipeId ? null : recipeId;
    setExpandedRecipeId(next);
    setDetailTab("article");
    if (next) void ensureRecipeFull(next);
  };

  return (
    <div>
      <button
        onClick={() => router.push(`/projects/${projectId}`)}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4"
      >
        <ArrowLeft size={16} /> Back to Project
      </button>

      {/* ── Header ── */}
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

      {/* ── 1. Recipe Inputs ── */}
      <div className="space-y-3 mb-4">
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

      {/* ── Recipe Input action buttons ── */}
      <div className="flex flex-wrap items-center gap-2 mb-8">
        <input
          ref={excelInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleExcelImport(file);
          }}
        />
        <button
          type="button"
          onClick={downloadExcelTemplate}
          className="btn-secondary flex items-center gap-2"
          title="Download required Excel template (image_url, recipe_text)"
        >
          <Download size={16} /> Download Excel Template
        </button>
        <button
          type="button"
          onClick={() => excelInputRef.current?.click()}
          disabled={importingExcel}
          className="btn-secondary flex items-center gap-2"
          title='Import Excel columns: "image_url", "recipe_text"'
        >
          <Upload size={16} /> {importingExcel ? "Importing..." : "Upload Excel"}
        </button>
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

      {/* ── 2. History ── */}
      <div className="card mb-5">
        <h2 className="text-lg font-semibold text-white mb-3">History</h2>
        <p className="text-xs text-gray-500 mb-4">
          Click a recipe row to expand — <strong className="text-gray-400">Article</strong>,{" "}
          <strong className="text-gray-400">Recipe</strong> (full text + WP JSON), <strong className="text-gray-400">SEO</strong>,{" "}
          <strong className="text-gray-400">Images</strong>.
        </p>

        {history.length === 0 ? (
          <p className="text-sm text-gray-500">No previous all-sites jobs yet.</p>
        ) : loadingDetail ? (
          <p className="text-sm text-gray-500 py-4">Loading recipes…</p>
        ) : (
          <div className="space-y-8">
            {history.map((j) => {
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
                      <span className="text-xs text-gray-500 ml-2">{new Date(j.created_at).toLocaleString()}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <button onClick={() => router.push(`/jobs/${j.id}`)} className="btn-secondary text-xs px-2 py-1">
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
                          <button
                            onClick={() => toggleCollapseJob(j.id)}
                            className="text-xs px-2 py-1 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 flex items-center gap-1"
                            title={collapsedJobs.has(j.id) ? "Expand recipes" : "Collapse recipes"}
                          >
                            {collapsedJobs.has(j.id) ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                            {collapsedJobs.has(j.id) ? `Show ${(jobRecipeMap[j.id] || []).length} recipes` : "Collapse"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {!collapsedJobs.has(j.id) && (
                  <div className="p-2 sm:p-3 space-y-2">
                    {recipes.length === 0 ? (
                      <p className="text-xs text-gray-600 py-2">No recipes linked.</p>
                    ) : (
                      recipes.map((row) => {
                        const thumb = thumbUrl(row);
                        const title = row.recipe_text?.split("\n")[0]?.trim() || "Recipe";
                        const r = recipeFullById[row.id];
                        const isOpen = expandedRecipeId === row.id;
                        return (
                          <div key={row.id} className="card p-0 overflow-hidden border-gray-700/60">
                            <div
                              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-800/50 transition"
                              onClick={() => toggleExpand(row.id)}
                            >
                              <div className="w-12 h-12 rounded-lg bg-gray-800 overflow-hidden flex-shrink-0 border border-gray-700">
                                {thumb ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={thumb} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-600">
                                    —
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-white font-medium truncate">{title}</p>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  <span className={`text-xs px-2 py-0.5 rounded ${statusColor[row.status] || statusColor.pending}`}>
                                    {row.status}
                                  </span>
                                  <span className="text-xs text-gray-500 truncate max-w-[180px]">{row.site_domain}</span>
                                  {r?.focus_keyword && (
                                    <span className="text-xs text-gray-500 truncate max-w-[140px]">{r.focus_keyword}</span>
                                  )}
                                  {row.category && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{row.category}</span>
                                  )}
                                  {(r?.wp_permalink || row.wp_permalink) && (
                                    <a
                                      href={r?.wp_permalink || row.wp_permalink || "#"}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs text-brand-400 hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      View post
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                {(row.status === "generated" || row.status === "published") && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handlePublishWp(row.id);
                                    }}
                                    disabled={wpPublishingId === row.id || row.status === "published"}
                                    className="text-gray-500 hover:text-blue-400 p-1 disabled:opacity-40"
                                    title={row.status === "published" ? "Published" : "Publish to WordPress"}
                                  >
                                    {wpPublishingId === row.id ? (
                                      <RefreshCw size={16} className="animate-spin" />
                                    ) : (
                                      <Globe size={16} />
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() =>
                                    router.push(`/projects/${projectId}/sites/${row.site_id}/designer?recipe=${row.id}`)
                                  }
                                  className="text-gray-500 hover:text-purple-400 p-1"
                                  title="Pin designer"
                                >
                                  <ImageIcon size={16} />
                                </button>
                                {canAdmin && (
                                  <button
                                    onClick={() => deleteRecipe(j.id, row.id)}
                                    disabled={deletingRecipeId === row.id}
                                    className="text-gray-500 hover:text-red-400 p-1 disabled:opacity-40"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                              {isOpen ? (
                                <ChevronUp size={16} className="text-gray-500 flex-shrink-0" />
                              ) : (
                                <ChevronDown size={16} className="text-gray-500 flex-shrink-0" />
                              )}
                            </div>

                            {isOpen && (
                              <div className="border-t border-gray-800">
                                <div className="flex gap-1 px-4 pt-3 border-b border-gray-800 overflow-x-auto">
                                  {(["article", "recipe", "seo", "images"] as const).map((tab) => (
                                    <button
                                      key={tab}
                                      onClick={() => setDetailTab(tab)}
                                      className={`px-3 py-2 text-xs font-medium border-b-2 transition capitalize whitespace-nowrap ${
                                        detailTab === tab
                                          ? "border-brand-500 text-brand-400"
                                          : "border-transparent text-gray-500 hover:text-gray-300"
                                      }`}
                                    >
                                      {tab === "seo" ? "SEO" : tab}
                                    </button>
                                  ))}
                                </div>
                                <div className="p-4 max-h-[560px] overflow-y-auto">
                                  {loadingRecipeDetailId === row.id && (
                                    <p className="text-sm text-gray-500 mb-3">Loading details…</p>
                                  )}
                                  {!r && loadingRecipeDetailId !== row.id && (
                                    <p className="text-sm text-gray-500">Could not load recipe details.</p>
                                  )}
                                  {r && detailTab === "article" && (
                                    <div>
                                      {r.generated_article ? (
                                        <div
                                          className="prose prose-invert prose-sm max-w-none text-sm text-gray-300"
                                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(r.generated_article) }}
                                        />
                                      ) : r.status === "failed" ? (
                                        <div className="text-sm">
                                          <p className="text-red-400 font-medium">Generation failed.</p>
                                          {r.error_message && <p className="text-gray-400 mt-1">{r.error_message}</p>}
                                        </div>
                                      ) : (
                                        <p className="text-gray-500 text-sm">No article yet.</p>
                                      )}
                                    </div>
                                  )}
                                  {r && detailTab === "recipe" && (
                                    <div>
                                      {r.generated_full_recipe && (
                                        <div className="mb-4">
                                          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Full recipe</h4>
                                          <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-950 rounded-lg p-3">
                                            {r.generated_full_recipe}
                                          </pre>
                                        </div>
                                      )}
                                      {r.generated_json ? (
                                        <div>
                                          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">WP Recipe JSON</h4>
                                          <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-950 rounded-lg p-3 font-mono overflow-x-auto">
                                            {r.generated_json}
                                          </pre>
                                        </div>
                                      ) : (
                                        !r.generated_full_recipe && (
                                          <p className="text-gray-500 text-sm">No recipe JSON yet.</p>
                                        )
                                      )}
                                    </div>
                                  )}
                                  {r && detailTab === "seo" && (
                                    <div className="space-y-3">
                                      <div>
                                        <span className="text-xs font-semibold text-gray-400 uppercase">Focus keyword</span>
                                        <p className="text-sm text-gray-300 mt-1">{r.focus_keyword || "—"}</p>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-400 uppercase">Meta description</span>
                                        <p className="text-sm text-gray-300 mt-1">{r.meta_description || "—"}</p>
                                      </div>
                                      <div>
                                        <span className="text-xs font-semibold text-gray-400 uppercase">Category</span>
                                        <p className="text-sm text-gray-300 mt-1">{r.category || "—"}</p>
                                      </div>
                                      {r.wp_post_id && (
                                        <div>
                                          <span className="text-xs font-semibold text-gray-400 uppercase">WordPress</span>
                                          <p className="text-sm text-gray-300 mt-1">
                                            ID: {r.wp_post_id} —{" "}
                                            <a
                                              href={r.wp_permalink || "#"}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-brand-400 hover:underline"
                                            >
                                              {r.wp_permalink}
                                            </a>
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {r && detailTab === "images" && (
                                    <div>
                                      <div className="mb-3">
                                        <span className="text-xs font-semibold text-gray-400 uppercase">Source image</span>
                                        {r.image_url && (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={r.image_url} alt="" className="mt-2 max-w-xs rounded-lg" />
                                        )}
                                      </div>
                                      {r.generated_images && (
                                        <div>
                                          <span className="text-xs font-semibold text-gray-400 uppercase mb-2 block">
                                            Generated (Midjourney)
                                          </span>
                                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                            {(() => {
                                              try {
                                                const imgs: string[] = JSON.parse(r.generated_images);
                                                return imgs.map((url: string, i: number) => (
                                                  // eslint-disable-next-line @next/next/no-img-element
                                                  <img key={i} src={url} alt="" className="rounded-lg w-full" />
                                                ));
                                              } catch {
                                                return <p className="text-gray-500 text-sm">Could not parse images.</p>;
                                              }
                                            })()}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 3. Publishing Schedule (bottom) ── */}
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
            Interval (minutes)
            <input
              type="number"
              min={1}
              max={10080}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value || 240))}
              className="input-field mt-1"
            />

            <div className="mt-3">
              Delete recipe images after (days)
              <input
                type="number"
                min={1}
                max={3650}
                value={imageRetentionDays}
                onChange={(e) => setImageRetentionDays(Number(e.target.value || 4))}
                className="input-field mt-1"
              />
            </div>
          </label>
          <div className="flex md:justify-end gap-2 flex-wrap">
            <button
              onClick={() => router.push(`/settings?tab=cleanup&projectId=${projectId}`)}
              className="btn-secondary flex items-center gap-2 w-full md:w-auto justify-center border-amber-700/50 text-amber-300"
              title="Open advanced image cleanup controls"
            >
              <Trash2 size={14} /> Image Cleanup
            </button>
            <button
              onClick={saveSchedule}
              disabled={savingSchedule}
              className="btn-secondary flex items-center gap-2 w-full md:w-auto justify-center"
            >
              <Save size={14} /> {savingSchedule ? "Saving..." : "Save Schedule"}
            </button>
            <button
              onClick={startPublishingNow}
              disabled={!canStartPublishing}
              className="btn-primary flex items-center gap-2 w-full md:w-auto justify-center"
              title={
                hasRunningGeneration
                  ? "Wait until generation job finishes"
                  : !hasAnyGeneratedRecipes
                    ? "Generate recipes first"
                    : "Start queue immediately (publishes one article now, then continues by interval)"
              }
            >
              <Send size={14} /> {startingPublish ? "Starting..." : "Start Publishing"}
            </button>
          </div>
        </div>
        {!canStartPublishing && (
          <p className="text-xs text-amber-400 mt-2">
            {hasRunningGeneration
              ? "Start Publishing becomes available after generation finishes."
              : "Generate at least one recipe first."}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-2">
          {schedule?.next_run_at ? `Next run: ${new Date(schedule.next_run_at).toLocaleString()}` : "No next run scheduled"}
        </p>
        {schedule?.last_error && (
          <p className="text-xs text-red-400 mt-1">Last scheduler message: {schedule.last_error}</p>
        )}
      </div>
    </div>
  );
}