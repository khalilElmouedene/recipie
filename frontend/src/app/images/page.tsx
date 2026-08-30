"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  Archive,
  ChevronDown,
  Clock3,
  Download,
  Images,
  Layers3,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Upload,
  WandSparkles,
  XCircle,
} from "lucide-react";
import { api, ImageBatchDetailOut, ImageBatchOut, ImageProjectOut } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";

const ALLOWED_EMAIL = "khalil@gmail.com";

function statusLabel(status: string) {
  if (status === "completed") return "Ready to download";
  if (status === "failed") return "Needs attention";
  if (status === "stopped") return "Stopped";
  if (status === "generating" || status === "running") return "Generating";
  return "Queued";
}

function statusClass(status: string) {
  if (status === "completed") return "text-emerald-300 bg-emerald-400/10 border-emerald-400/20";
  if (status === "failed") return "text-rose-300 bg-rose-400/10 border-rose-400/20";
  if (status === "stopped") return "text-amber-200 bg-amber-400/10 border-amber-400/20";
  return "text-sky-200 bg-sky-400/10 border-sky-400/20";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ImagesPage() {
  const router = useRouter();
  const toast = useToast();
  const [authorized, setAuthorized] = useState(false);
  const [projects, setProjects] = useState<ImageProjectOut[]>([]);
  const [projectId, setProjectId] = useState("");
  const [prompts, setPrompts] = useState([""]);
  const [batches, setBatches] = useState<ImageBatchOut[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<ImageBatchDetailOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [importingSheet, setImportingSheet] = useState(false);
  const [importedSheetName, setImportedSheetName] = useState("");
  const promptSheetInputRef = useRef<HTMLInputElement>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );

  useEffect(() => {
    let mounted = true;
    api.me()
      .then((me) => {
        if (me.email.trim().toLowerCase() !== ALLOWED_EMAIL) {
          router.replace("/");
          return;
        }
        if (mounted) setAuthorized(true);
        return api.getImageProjects().then((items) => {
          if (!mounted) return;
          setProjects(items);
          if (items[0]) setProjectId(items[0].id);
        });
      })
      .catch((error) => {
        if (mounted) toast.error(error instanceof Error ? error.message : "Could not load projects");
        router.replace("/");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [router, toast]);

  const loadBatches = useCallback(async () => {
    if (!projectId) return;
    try {
      const items = await api.getImageBatches(projectId);
      setBatches(items);
      if (items.length > 0) {
        setSelectedBatch((current) => current && items.some((item) => item.id === current.id) ? current : null);
      }
    } catch {
      // Keep the gallery usable while a background request is transiently unavailable.
    }
  }, [projectId]);

  useEffect(() => {
    setSelectedBatch(null);
    void loadBatches();
  }, [loadBatches]);

  const loadBatch = useCallback(async (batchId: string, quiet = false) => {
    if (!quiet) setLoadingBatch(true);
    try {
      const detail = await api.getImageBatch(batchId);
      setSelectedBatch(detail);
      setBatches((current) => current.map((batch) => batch.id === detail.id ? detail : batch));
      return detail;
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "Could not load this batch");
      return null;
    } finally {
      if (!quiet) setLoadingBatch(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!selectedBatch || !["pending", "running"].includes(selectedBatch.status)) return;
    const timer = window.setInterval(() => void loadBatch(selectedBatch.id, true), 4000);
    return () => window.clearInterval(timer);
  }, [loadBatch, selectedBatch]);

  const updatePrompt = (index: number, value: string) => {
    setPrompts((current) => current.map((prompt, i) => i === index ? value : prompt));
  };

  const addPrompt = () => {
    setPrompts((current) => [...current, ""]);
  };

  const removePrompt = (index: number) => {
    setPrompts((current) => current.length === 1 ? current : current.filter((_, i) => i !== index));
  };

  const importPromptSheet = async (file: File) => {
    setImportingSheet(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error("The sheet file does not contain a worksheet");
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: "",
        raw: false,
      });
      const textRows = rows
        .map((row) => row.map((cell) => String(cell ?? "").trim()))
        .filter((row) => row.some(Boolean));
      if (!textRows.length) throw new Error("The selected sheet is empty");

      const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const firstRow = textRows[0];
      const promptColumn = firstRow.findIndex((cell) => {
        const header = normalizeHeader(cell);
        return header === "prompt" || header === "prompts" || header === "prompt_text" || header === "prompt_texts" || header === "description" || header === "idea";
      });
      const dataRows = promptColumn >= 0 ? textRows.slice(1) : textRows;
      const imported = dataRows
        .map((row) => (promptColumn >= 0 ? row[promptColumn] : row.find(Boolean) ?? "").trim())
        .filter(Boolean);
      if (!imported.length) throw new Error("No prompts were found in the selected sheet");
      setPrompts(imported);
      setImportedSheetName(file.name);
      toast.success(`Loaded ${imported.length} prompt${imported.length === 1 ? "" : "s"} from ${file.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read the prompt sheet");
    } finally {
      setImportingSheet(false);
      if (promptSheetInputRef.current) promptSheetInputRef.current.value = "";
    }
  };

  const handlePromptSheetChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void importPromptSheet(file);
  };

  const startGeneration = async () => {
    const cleaned = prompts.map((prompt) => prompt.trim()).filter(Boolean);
    if (!projectId || !cleaned.length) {
      toast.error("Add at least one prompt before generating");
      return;
    }
    setStarting(true);
    try {
      const batch = await api.startImageBatch(projectId, cleaned);
      setPrompts([""]);
      await loadBatches();
      await loadBatch(batch.id);
      toast.success(`${cleaned.length} prompt${cleaned.length === 1 ? "" : "s"} sent to Midjourney`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start image generation");
    } finally {
      setStarting(false);
    }
  };

  const stopGeneration = async () => {
    if (!selectedBatch) return;
    try {
      await api.stopImageBatch(selectedBatch.id);
      await loadBatch(selectedBatch.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop the batch");
    }
  };

  if (!authorized || loading) return null;

  const imageCount = selectedBatch?.total_images ?? 0;
  const progress = selectedBatch && selectedBatch.total_prompts
    ? Math.round((selectedBatch.completed_prompts / selectedBatch.total_prompts) * 100)
    : 0;

  return (
    <div className="relative mx-auto max-w-[1500px] overflow-hidden pb-10">
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="pointer-events-none absolute left-1/3 top-80 h-56 w-56 rounded-full bg-cyan-400/5 blur-3xl" />

      <header className="relative mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-400">
            <Sparkles size={14} /> Private studio / khalil@gmail.com
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white md:text-5xl">Imges</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
            A focused Midjourney room for turning prompt sets into image folders. Project credentials and timing stay inherited from your selected project; articles are never created.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-gray-800 bg-gray-900/70 px-4 py-3 text-xs text-gray-400 shadow-xl shadow-black/10">
          <Layers3 size={16} className="text-sky-400" />
          <span>{projects.length} project{projects.length === 1 ? "" : "s"} available</span>
        </div>
      </header>

      <div className="relative grid gap-5 xl:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.55fr)]">
        <section className="space-y-5">
          <div className="rounded-3xl border border-gray-800 bg-gray-900/90 p-5 shadow-2xl shadow-black/20 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-500">01 / Configuration</p>
                <h2 className="mt-2 text-lg font-semibold text-white">Borrow a project setup</h2>
              </div>
              <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-2.5 text-sky-300"><WandSparkles size={18} /></div>
            </div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-gray-500" htmlFor="image-project">Project</label>
            <div className="relative">
              <select
                id="image-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="input-field appearance-none pr-10"
              >
                {projects.length === 0 && <option value="">No projects available</option>}
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-3.5 text-gray-500" />
            </div>
            {selectedProject ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-gray-600">Connection</p>
                  <p className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${selectedProject.midjourney_configured ? "text-emerald-300" : "text-rose-300"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${selectedProject.midjourney_configured ? "bg-emerald-400" : "bg-rose-400"}`} />
                    {selectedProject.midjourney_configured ? "Midjourney ready" : "Setup needed"}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-gray-600">Grid wait</p>
                  <p className="mt-2 text-xs font-semibold text-gray-200">{Math.round(selectedProject.grid_wait_seconds / 60)} min inherited</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-gray-700 p-4 text-xs text-gray-500">Select a project to load its Midjourney configuration.</div>
            )}
          </div>

          <div className="rounded-3xl border border-gray-800 bg-gray-900/90 p-5 shadow-2xl shadow-black/20 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-500">02 / Prompt stack</p>
                <h2 className="mt-2 text-lg font-semibold text-white">Describe the frames</h2>
                <p className="mt-1 text-xs text-gray-500">Each prompt returns its own four-image Midjourney set.</p>
              </div>
              <div className="flex items-center gap-2">
                <input ref={promptSheetInputRef} type="file" accept=".xlsx,.xls,.csv,.tsv" className="sr-only" onChange={handlePromptSheetChange} />
                <button type="button" onClick={() => promptSheetInputRef.current?.click()} disabled={importingSheet} className="flex items-center gap-1.5 rounded-xl border border-gray-700 px-2.5 py-1.5 text-[11px] font-semibold text-gray-400 transition hover:border-sky-500/50 hover:bg-sky-400/5 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-50" title="Import prompts from CSV, TSV, or Excel">
                  {importingSheet ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {importingSheet ? "Reading…" : "Import sheet"}
                </button>
                <span className="rounded-full border border-gray-700 px-2.5 py-1 text-[11px] text-gray-400">{prompts.length} prompt{prompts.length === 1 ? "" : "s"}</span>
              </div>
            </div>
            {importedSheetName && <div className="mb-4 flex items-center gap-2 rounded-xl border border-sky-400/15 bg-sky-400/5 px-3 py-2 text-[11px] text-sky-200/80"><Upload size={13} /> {importedSheetName} loaded — review the prompts, then generate the full set.</div>}
            <div className="space-y-3">
              {prompts.map((prompt, index) => (
                <div key={index} className="group relative rounded-2xl border border-gray-800 bg-gray-950/55 p-3 transition focus-within:border-sky-500/60 focus-within:bg-gray-950">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-600">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[10px] text-gray-400">{String(index + 1).padStart(2, "0")}</span>
                      Prompt
                    </span>
                    {prompts.length > 1 && <button type="button" onClick={() => removePrompt(index)} className="rounded-lg p-1 text-gray-600 transition hover:bg-rose-400/10 hover:text-rose-300" aria-label={`Remove prompt ${index + 1}`}><Minus size={15} /></button>}
                  </div>
                  <textarea
                    value={prompt}
                    onChange={(event) => updatePrompt(index, event.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder="A sunlit editorial still life, sculptural shadows, warm stone, 35mm film grain..."
                    className="block w-full resize-y border-0 bg-transparent p-0 text-sm leading-6 text-gray-200 placeholder:text-gray-700 focus:ring-0"
                  />
                  <div className="mt-2 text-right text-[10px] text-gray-700">{prompt.length}/4000</div>
                </div>
              ))}
            </div>
            <button type="button" onClick={addPrompt} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-700 py-3 text-xs font-semibold text-gray-400 transition hover:border-sky-500/50 hover:bg-sky-400/5 hover:text-sky-300">
              <Plus size={15} /> Add another prompt
            </button>
            <button
              type="button"
              onClick={startGeneration}
              disabled={starting || !selectedProject?.midjourney_configured || !prompts.some((prompt) => prompt.trim())}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/15 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting ? <Loader2 size={17} className="animate-spin" /> : <Images size={17} />}
              {starting ? "Opening Midjourney queue…" : "Generate image sets"}
            </button>
            {!selectedProject?.midjourney_configured && selectedProject && <p className="mt-3 text-center text-xs text-amber-300/80">Add the Midjourney credentials under this project’s Settings first.</p>}
          </div>
        </section>

        <section className="min-w-0 rounded-3xl border border-gray-800 bg-gray-900/90 p-5 shadow-2xl shadow-black/20 md:p-6">
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-500">03 / Output room</p>
              <h2 className="mt-2 text-lg font-semibold text-white">Your generated folder</h2>
            </div>
            {selectedBatch && <span className={`self-start rounded-full border px-3 py-1.5 text-[11px] font-semibold ${statusClass(selectedBatch.status)}`}>{statusLabel(selectedBatch.status)}</span>}
          </div>

          {selectedBatch ? (
            <>
              <div className="mb-5 flex flex-col gap-4 rounded-2xl border border-gray-800 bg-gray-950/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><Clock3 size={13} /> {formatDate(selectedBatch.created_at)} <span className="text-gray-700">·</span> {selectedBatch.total_prompts} prompt{selectedBatch.total_prompts === 1 ? "" : "s"} <span className="text-gray-700">·</span> {imageCount} image{imageCount === 1 ? "" : "s"}</div>
                  {(selectedBatch.status === "running" || selectedBatch.status === "pending") && <div className="mt-3 h-1.5 max-w-sm overflow-hidden rounded-full bg-gray-800"><div className="h-full rounded-full bg-sky-400 transition-all duration-500" style={{ width: `${progress}%` }} /></div>}
                  {selectedBatch.error && <p className="mt-2 text-xs text-amber-300">{selectedBatch.error}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {(["pending", "running"].includes(selectedBatch.status)) && <button type="button" onClick={stopGeneration} className="btn-secondary flex items-center gap-2 border-amber-700/50 px-3 py-2 text-xs text-amber-200"><Square size={13} /> Stop</button>}
                  {imageCount > 0 && <button type="button" onClick={() => api.downloadImageBatch(selectedBatch.id).catch((error) => toast.error(error instanceof Error ? error.message : "Download failed"))} className="btn-primary flex items-center gap-2 px-3 py-2 text-xs"><Download size={14} /> Download ZIP</button>}
                </div>
              </div>

              {loadingBatch ? <div className="flex min-h-[300px] items-center justify-center text-sm text-gray-500"><Loader2 size={18} className="mr-2 animate-spin" /> Loading image set…</div> : (
                <div className="space-y-7">
                  {selectedBatch.generations.map((generation) => (
                    <div key={generation.id}>
                      <div className="mb-3 flex items-start gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-[10px] font-semibold text-gray-400">{String(generation.position + 1).padStart(2, "0")}</span>
                        <div className="min-w-0"><p className="line-clamp-2 text-sm leading-5 text-gray-300">{generation.prompt}</p><p className="mt-1 text-[11px] text-gray-600">{statusLabel(generation.status)}{generation.error ? ` · ${generation.error}` : ""}</p></div>
                      </div>
                      {generation.image_urls.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {generation.image_urls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-2xl border border-gray-800 bg-gray-950"><img src={url} alt={`Generated image ${index + 1}`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /><span className="absolute bottom-2 right-2 rounded-lg bg-gray-950/75 px-1.5 py-1 text-[10px] text-gray-300 opacity-0 transition group-hover:opacity-100">Open</span></a>)}
                        </div>
                      ) : generation.status === "generating" ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="flex aspect-square items-center justify-center rounded-2xl border border-gray-800 bg-gray-950/60"><Loader2 size={18} className="animate-spin text-sky-400/70" /></div>)}</div>
                      ) : generation.status === "failed" ? <div className="flex items-center gap-2 rounded-2xl border border-rose-400/15 bg-rose-400/5 p-4 text-xs text-rose-200"><XCircle size={16} /> This prompt did not return images.</div> : <div className="rounded-2xl border border-dashed border-gray-800 p-5 text-center text-xs text-gray-600">Waiting in queue…</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-[560px] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-950/30 px-8 text-center">
              <div className="relative mb-6 h-28 w-36">
                <div className="absolute left-2 top-7 h-20 w-20 rotate-[-10deg] rounded-2xl border border-sky-400/30 bg-sky-400/5" />
                <div className="absolute right-1 top-1 h-20 w-20 rotate-[8deg] rounded-2xl border border-blue-400/30 bg-blue-400/10" />
                <div className="absolute left-8 top-10 flex h-20 w-20 items-center justify-center rounded-2xl border border-gray-700 bg-gray-900 text-sky-300 shadow-xl"><Images size={26} /></div>
              </div>
              <h3 className="text-base font-semibold text-gray-200">Your next frame starts here</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-gray-500">Choose a project, stack a few prompts, and every finished set will collect here as a clean downloadable folder.</p>
            </div>
          )}
        </section>
      </div>

      <section className="relative mt-5 rounded-3xl border border-gray-800 bg-gray-900/70 p-5 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-500">Archive</p><h2 className="mt-2 text-lg font-semibold text-white">Recent folders</h2></div><button type="button" onClick={() => void loadBatches()} className="rounded-xl border border-gray-800 p-2 text-gray-500 transition hover:border-gray-700 hover:text-gray-200" aria-label="Refresh image folders"><RefreshCw size={15} /></button></div>
        {batches.length === 0 ? <p className="rounded-2xl border border-dashed border-gray-800 px-4 py-8 text-center text-sm text-gray-600">No image folders yet.</p> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{batches.map((batch) => <button key={batch.id} type="button" onClick={() => void loadBatch(batch.id)} className={`flex items-center justify-between gap-4 rounded-2xl border p-4 text-left transition ${selectedBatch?.id === batch.id ? "border-sky-400/40 bg-sky-400/5" : "border-gray-800 bg-gray-950/40 hover:border-gray-700 hover:bg-gray-950/70"}`}><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-800 text-gray-400"><Archive size={17} /></div><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-200">{batch.total_prompts} prompt{batch.total_prompts === 1 ? "" : "s"} / {batch.total_images} image{batch.total_images === 1 ? "" : "s"}</p><p className="mt-1 text-[11px] text-gray-600">{formatDate(batch.created_at)}</p></div></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClass(batch.status)}`}>{batch.status}</span></button>)}</div>}
      </section>
    </div>
  );
}
