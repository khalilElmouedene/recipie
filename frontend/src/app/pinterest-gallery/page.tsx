"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  ExternalLink,
  Tag,
  FileText,
  Search,
  X,
  Loader2,
  Sheet,
  ChevronDown,
} from "lucide-react";
import { api, ProjectOut, PinterestRecipeOut } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import {
  PINTEREST_WORKSHEET_HEADER,
  PINTEREST_WORKSHEET_INIT_KEY,
  PinterestWorksheetRecipe,
  PinterestWorksheetSnapshot,
  buildPinterestWorksheetRows,
  rowsToCsv,
} from "@/lib/pinterestWorksheet";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getDisplayImage(recipe: PinterestRecipeOut): string | null {
  if (recipe.pin_design_image && !recipe.pin_design_image.startsWith("data:")) {
    return recipe.pin_design_image;
  }
  if (recipe.generated_images) {
    try {
      const arr = JSON.parse(recipe.generated_images);
      if (Array.isArray(arr) && arr[0]) return arr[0];
    } catch {}
  }
  if (recipe.image_url) return recipe.image_url;
  return null;
}

function formatDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Inner component (needs useSearchParams) ──────────────────────────────────
function PinterestGalleryInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const projectIdParam = searchParams.get("project_id");
  const fromProjectDetails = searchParams.get("from_project") === "1";

  const [projects, setProjects] = useState<ProjectOut[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const [allRecipes, setAllRecipes] = useState<PinterestRecipeOut[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedWebsite, setSelectedWebsite] = useState<string>("");
  const [selectedBoard, setSelectedBoard] = useState<string>("__all__");

  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvStartDate, setCsvStartDate] = useState(() => formatDateTimeLocal(new Date()));
  const [csvInterval, setCsvInterval] = useState(300);
  const [csvGenerating, setCsvGenerating] = useState(false);
  const [worksheetPreparing, setWorksheetPreparing] = useState(false);

  // ── Load project list once ──
  useEffect(() => {
    api.getProjects()
      .then((projs) => {
        setProjects(projs);
        const initId = projectIdParam || "";
        setSelectedProjectId(initId);
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch recipes when project changes ──
  useEffect(() => {
    if (!selectedProjectId) { setAllRecipes([]); return; }
    setRecipesLoading(true);
    setRecipesError(null);
    setSearch("");
    setSelectedWebsite("");
    setSelectedBoard("__all__");
    api.getProjectPinterestRecipes(selectedProjectId)
      .then(setAllRecipes)
      .catch((e) => setRecipesError(e?.message || "Failed to load recipes"))
      .finally(() => setRecipesLoading(false));
  }, [selectedProjectId]);

  const handleProjectChange = (id: string) => {
    setSelectedProjectId(id);
    router.replace(id ? `/pinterest-gallery?project_id=${id}` : "/pinterest-gallery");
  };

  // ── Derived data ──
  const websites = useMemo(() =>
    Array.from(new Set(allRecipes.map((r) => r.site_domain))).sort(),
    [allRecipes]
  );

  useEffect(() => {
    if (websites.length === 0) { if (selectedWebsite !== "") setSelectedWebsite(""); return; }
    if (!selectedWebsite || !websites.includes(selectedWebsite)) setSelectedWebsite(websites[0]);
  }, [websites, selectedWebsite]);

  const websiteScopedRecipes = useMemo(() =>
    selectedWebsite ? allRecipes.filter((r) => r.site_domain === selectedWebsite) : [],
    [allRecipes, selectedWebsite]
  );

  const boards = useMemo(() => {
    const set = new Set<string>();
    websiteScopedRecipes.forEach((r) => { if (r.pin_board) set.add(r.pin_board); });
    return Array.from(set).sort();
  }, [websiteScopedRecipes]);

  useEffect(() => {
    if (selectedBoard !== "__all__" && !boards.includes(selectedBoard)) setSelectedBoard("__all__");
  }, [boards, selectedBoard]);

  const filtered = useMemo(() => {
    let list = websiteScopedRecipes;
    if (selectedBoard !== "__all__") list = list.filter((r) => r.pin_board === selectedBoard);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          (r.pin_title || r.recipe_text || "").toLowerCase().includes(q) ||
          (r.pin_description || "").toLowerCase().includes(q) ||
          (r.pin_tags || "").toLowerCase().includes(q)
      );
    }
    return list.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [websiteScopedRecipes, selectedBoard, search]);

  const worksheetSourceRows = useMemo<PinterestWorksheetRecipe[]>(
    () => filtered.map((r) => ({
      siteId: r.site_id,
      siteDomain: r.site_domain,
      pinTitle: r.pin_title,
      recipeText: r.recipe_text || "",
      pinDesignImage: r.pin_design_image,
      pinBoard: r.pin_board,
      pinDescription: r.pin_description,
      wpPermalink: r.wp_permalink,
      pinTags: r.pin_tags,
    })),
    [filtered],
  );

  const resolveWorksheetMediaUrl = async (recipe: PinterestWorksheetRecipe): Promise<string> => {
    if (!recipe.pinDesignImage) return "";
    if (!recipe.pinDesignImage.startsWith("data:")) return recipe.pinDesignImage;
    if (!recipe.siteId) return "";
    try { return await api.uploadPinImageToServer(recipe.siteId, recipe.pinDesignImage); } catch {}
    return "";
  };

  const downloadCsv = async () => {
    if (filtered.length === 0) return;
    setCsvGenerating(true);
    try {
      const rows = await buildPinterestWorksheetRows(worksheetSourceRows, csvStartDate, csvInterval, resolveWorksheetMediaUrl);
      const csv = rowsToCsv(PINTEREST_WORKSHEET_HEADER, rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pinterest-pins-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setShowCsvModal(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "CSV generation failed");
    } finally {
      setCsvGenerating(false);
    }
  };

  const openWorksheet = async () => {
    if (worksheetSourceRows.length === 0) return;
    setWorksheetPreparing(true);
    try {
      const rows = await buildPinterestWorksheetRows(worksheetSourceRows, csvStartDate, csvInterval, resolveWorksheetMediaUrl);
      const snapshot: PinterestWorksheetSnapshot = {
        header: PINTEREST_WORKSHEET_HEADER,
        rows,
        generatedAt: new Date().toISOString(),
        startDate: csvStartDate,
        intervalMinutes: csvInterval,
      };
      sessionStorage.setItem(PINTEREST_WORKSHEET_INIT_KEY, JSON.stringify(snapshot));
      router.push("/pinterest-gallery/worksheet");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Worksheet initialization failed");
    } finally {
      setWorksheetPreparing(false);
    }
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const hideProjectSelector = fromProjectDetails && Boolean(projectIdParam);
  const allBoards = useMemo(() => {
    const set = new Set<string>();
    allRecipes.forEach((r) => { if (r.pin_board) set.add(r.pin_board); });
    return Array.from(set);
  }, [allRecipes]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 border-b border-gray-800 bg-gray-950/95 backdrop-blur-sm">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Title + project selector */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E60023]/15">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#E60023]" aria-hidden>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
                </svg>
              </div>
              <div className="hidden sm:block">
                <p className="text-xs text-gray-500 leading-tight">Pinterest Gallery</p>
              </div>
              {!hideProjectSelector ? (
                <div className="relative">
                  <select
                    value={selectedProjectId}
                    onChange={(e) => handleProjectChange(e.target.value)}
                    disabled={projectsLoading}
                    className="appearance-none rounded-lg border border-gray-700 bg-gray-900 pl-3 pr-8 py-1.5 text-sm text-white outline-none focus:border-brand-500 transition cursor-pointer disabled:opacity-50 max-w-[200px] sm:max-w-xs"
                  >
                    {projectsLoading ? (
                      <option>Loading…</option>
                    ) : projects.length === 0 ? (
                      <option value="">No projects</option>
                    ) : (
                      <>
                        <option value="">Select project…</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </>
                    )}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
              ) : (
                <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 max-w-[260px] truncate" title={selectedProject?.name || projectIdParam || "Project"}>
                  {selectedProject?.name || "Project"}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => void openWorksheet()}
                className="flex items-center gap-2 rounded-lg border border-blue-700/60 bg-blue-950/40 px-3 py-2 text-xs font-medium text-blue-300 transition hover:bg-blue-900/50 hover:text-blue-200 disabled:opacity-40"
                disabled={filtered.length === 0 || worksheetPreparing}
                title="Open Pinterest Worksheet"
              >
                {worksheetPreparing ? <Loader2 size={14} className="animate-spin" /> : <Sheet size={14} />}
                <span className="hidden sm:inline">{worksheetPreparing ? "Preparing..." : "Sheet"}</span>
              </button>
              <button
                onClick={() => setShowCsvModal(true)}
                className="flex items-center gap-2 rounded-lg border border-[#E60023]/40 bg-[#E60023]/10 px-3 py-2 text-xs font-medium text-[#E60023] transition hover:bg-[#E60023]/20 disabled:opacity-40"
                disabled={filtered.length === 0}
              >
                <FileText size={14} />
                <span className="hidden sm:inline">Pinterest CSV</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-6">
        {/* ── Stats bar ── */}
        {!recipesLoading && !recipesError && selectedProjectId && (
          <div className="mb-6 flex flex-wrap gap-3">
            <StatPill label="Total pins" value={allRecipes.length} color="brand" />
            <StatPill label="Boards" value={allBoards.length} color="purple" />
            <StatPill label="Websites" value={websites.length} color="blue" />
            {selectedBoard !== "__all__" && <StatPill label="Showing" value={filtered.length} color="pink" />}
          </div>
        )}

        {/* ── Filters ── */}
        {!recipesLoading && !recipesError && allRecipes.length > 0 && (
          <div className="mb-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              {websites.map((site) => (
                <WebsitePill
                  key={site}
                  label={site}
                  count={allRecipes.filter((r) => r.site_domain === site).length}
                  active={selectedWebsite === site}
                  onClick={() => setSelectedWebsite(site)}
                />
              ))}
            </div>
            <div className="relative max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder={selectedWebsite ? `Search pins in ${selectedWebsite}…` : "Search pins…"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-800 bg-gray-900 pl-9 pr-9 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-brand-500 transition"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <BoardPill label="All boards" count={websiteScopedRecipes.length} active={selectedBoard === "__all__"} onClick={() => setSelectedBoard("__all__")} />
              {boards.map((b) => (
                <BoardPill key={b} label={b} count={websiteScopedRecipes.filter((r) => r.pin_board === b).length} active={selectedBoard === b} onClick={() => setSelectedBoard(b)} />
              ))}
            </div>
          </div>
        )}

        {/* ── States ── */}
        {!selectedProjectId && !projectsLoading && (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm text-gray-500">Select a project above to view its pins.</p>
          </div>
        )}
        {(recipesLoading || (projectsLoading && !selectedProjectId)) && (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 size={36} className="animate-spin text-[#E60023]" />
            <p className="text-sm text-gray-400">Loading published pins…</p>
          </div>
        )}
        {!recipesLoading && recipesError && (
          <div className="flex items-center justify-center py-24">
            <div className="rounded-xl border border-red-800/50 bg-red-950/30 px-8 py-6 text-center">
              <p className="text-sm text-red-400">{recipesError}</p>
            </div>
          </div>
        )}
        {!recipesLoading && !recipesError && selectedProjectId && allRecipes.length === 0 && (
          <EmptyState message={`No published pins yet for "${selectedProject?.name}". Publish recipes to WordPress first.`} />
        )}
        {!recipesLoading && !recipesError && allRecipes.length > 0 && filtered.length === 0 && (
          <EmptyState message="No pins match your current filter." />
        )}

        {/* ── Pins grid ── */}
        {!recipesLoading && !recipesError && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </div>
        )}
      </div>

      {/* ── CSV Modal ── */}
      {showCsvModal && (
        <Modal onClose={() => !csvGenerating && setShowCsvModal(false)}>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E60023]/15 shrink-0">
              <FileText size={18} className="text-[#E60023]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Download Pinterest CSV</h3>
              <p className="text-xs text-gray-400">Configure scheduling for the {filtered.length} visible pins.</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400">First pin publish date &amp; time</label>
              <input type="datetime-local" value={csvStartDate} onChange={(e) => setCsvStartDate(e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400">Interval between pins (minutes)</label>
              <input type="number" min={1} max={10080} value={csvInterval} onChange={(e) => setCsvInterval(Number(e.target.value) || 300)} className="input-field w-full" />
            </div>
            {csvGenerating && (
              <div className="flex items-center gap-2 rounded-lg border border-blue-800/40 bg-blue-950/30 px-3 py-2">
                <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />
                <p className="text-xs text-blue-300">Uploading pin images… this may take a moment.</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button className="btn-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-50" disabled={csvGenerating} onClick={() => void downloadCsv()}>
                <Download size={14} /> {csvGenerating ? "Uploading…" : "Download CSV"}
              </button>
              <button className="btn-secondary flex-1" disabled={csvGenerating} onClick={() => setShowCsvModal(false)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Page wrapper (Suspense required for useSearchParams) ─────────────────────
export default function PinterestGalleryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[#E60023]" />
      </div>
    }>
      <PinterestGalleryInner />
    </Suspense>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    brand: "border-brand-800/50 bg-brand-950/30 text-brand-300",
    purple: "border-purple-800/50 bg-purple-950/30 text-purple-300",
    blue: "border-blue-800/50 bg-blue-950/30 text-blue-300",
    pink: "border-pink-800/50 bg-pink-950/30 text-pink-300",
  };
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${colors[color] || colors.brand}`}>
      <span className="font-bold text-sm">{value}</span>
      <span className="text-gray-400">{label}</span>
    </div>
  );
}

function WebsitePill({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active ? "border-blue-500/70 bg-blue-500/15 text-blue-300" : "border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-700 hover:text-gray-200"
      }`}
      title={label}
    >
      <span className="truncate">{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-blue-500/25 text-blue-200" : "bg-gray-800 text-gray-500"}`}>
        {count}
      </span>
    </button>
  );
}

function BoardPill({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active ? "border-[#E60023]/60 bg-[#E60023]/15 text-[#E60023]" : "border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-700 hover:text-gray-200"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-[#E60023]/25 text-[#E60023]" : "bg-gray-800 text-gray-500"}`}>
        {count}
      </span>
    </button>
  );
}

function RecipeCard({ recipe }: { recipe: PinterestRecipeOut }) {
  const img = getDisplayImage(recipe);
  const title = recipe.pin_title || recipe.recipe_text?.split("\n")[0]?.trim() || "Untitled";
  const tags = recipe.pin_tags
    ? recipe.pin_tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5)
    : [];

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 transition hover:border-gray-700 hover:shadow-xl hover:shadow-black/40">
      <div className="relative aspect-[2/3] overflow-hidden bg-gray-800">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-12 w-12 fill-gray-700" aria-hidden>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
            </svg>
          </div>
        )}
        {recipe.pin_board && (
          <div className="absolute bottom-2 left-2 right-2">
            <span className="inline-block max-w-full truncate rounded-full bg-black/70 px-2.5 py-0.5 text-[10px] font-medium text-gray-200 backdrop-blur-sm">
              {recipe.pin_board}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <h3 className="line-clamp-2 text-sm font-semibold text-white leading-snug">{title}</h3>
        {recipe.pin_description && (
          <p className="line-clamp-3 text-xs text-gray-400 leading-relaxed">{recipe.pin_description}</p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto pt-1">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
                <Tag size={9} />{tag}
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between border-t border-gray-800 pt-2.5">
          <span className="text-[10px] text-gray-600 truncate max-w-[120px]" title={recipe.site_domain}>{recipe.site_domain}</span>
          {recipe.wp_permalink ? (
            <a href={recipe.wp_permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-gray-800 px-2 py-1 text-[10px] font-medium text-gray-300 transition hover:bg-gray-700 hover:text-white">
              View article <ExternalLink size={9} />
            </a>
          ) : (
            <span className="text-[10px] text-gray-700">No article</span>
          )}
        </div>
      </div>
    </article>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-900 border border-gray-800">
        <svg viewBox="0 0 24 24" className="h-8 w-8 fill-gray-700" aria-hidden>
          <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
        </svg>
      </div>
      <p className="text-sm text-gray-500 text-center max-w-xs">{message}</p>
    </div>
  );
}
