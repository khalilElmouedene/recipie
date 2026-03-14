"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import PinDesigner, {
  FrameInfo,
  TEMPLATES,
  PinTemplate,
  buildTemplateOnCanvas,
  BulkOverrides,
} from "@/components/PinDesigner";
import { api, getApiBaseUrl, RecipeOut } from "@/lib/api";
import {
  ArrowLeft,
  Download,
  LayoutTemplate,
  Loader2,
  CheckCircle,
  Image as ImageIcon,
  Type,
  Palette,
} from "lucide-react";

function getRecipeImages(r: RecipeOut): string[] {
  const images: string[] = [];
  if (r.generated_images) {
    try {
      const arr = JSON.parse(r.generated_images);
      if (Array.isArray(arr))
        arr.forEach((url: string) => {
          if (url?.trim()) images.push(url.trim());
        });
    } catch {}
  }
  if (r.image_url && !images.includes(r.image_url)) images.push(r.image_url);
  return images;
}

// ── Bulk Designer Grid View ──────────────────────────────────────────────────

function BulkDesigner({
  frames,
  projectId,
  siteId,
  website,
  onClose,
}: {
  frames: FrameInfo[];
  projectId: string;
  siteId: string;
  website: string;
  onClose: () => void;
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<PinTemplate | null>(null);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [generating, setGenerating] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const generationIdRef = useRef(0);

  // Left panel tab: "templates" or "style"
  const [leftTab, setLeftTab] = useState<"templates" | "style">("templates");

  // Shared style overrides
  const [overrides, setOverrides] = useState<BulkOverrides>({});

  const updateOverride = <K extends keyof BulkOverrides>(key: K, val: BulkOverrides[K]) => {
    setOverrides((prev) => ({ ...prev, [key]: val }));
  };

  // Generate all previews with current template + overrides
  const generateAllPreviews = useCallback(
    async (template: PinTemplate, ovr: BulkOverrides) => {
      const genId = ++generationIdRef.current;
      setGenerating(true);
      setPreviews({});
      const fabricMod = await import("fabric");
      const proxyBase = getApiBaseUrl();

      for (let i = 0; i < frames.length; i++) {
        if (generationIdRef.current !== genId) return;
        const frame = frames[i];
        const canvasEl = document.createElement("canvas");
        canvasEl.width = 1000;
        canvasEl.height = 1500;
        document.body.appendChild(canvasEl);

        try {
          const FC = (fabricMod as any).Canvas || (fabricMod as any).default?.Canvas;
          const fc = new FC(canvasEl, { width: 1000, height: 1500, enableRetinaScaling: false });
          await buildTemplateOnCanvas(fabricMod, fc, template, frame.images, proxyBase, frame.title, ovr.websiteText || website, ovr);
          fc.getObjects().filter((o: any) => o.__isLabel).forEach((o: any) => o.set("visible", false));
          fc.renderAll();
          const dataUrl = fc.toDataURL({ format: "png", multiplier: 0.3 });
          if (generationIdRef.current === genId) {
            setPreviews((prev) => ({ ...prev, [i]: dataUrl }));
          }
          fc.dispose();
        } catch { /* skip */ } finally {
          document.body.removeChild(canvasEl);
        }
        await new Promise((r) => setTimeout(r, 30));
      }

      if (generationIdRef.current === genId) setGenerating(false);
    },
    [frames, website]
  );

  // Re-generate when overrides change (debounced)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selectedTemplate) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      generateAllPreviews(selectedTemplate, overrides);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [overrides, selectedTemplate, generateAllPreviews]);

  const handleSelectTemplate = (t: PinTemplate) => {
    setSelectedTemplate(t);
    generateAllPreviews(t, overrides);
  };

  const handleSaveAll = async () => {
    if (!selectedTemplate || frames.length === 0) return;
    setSavingAll(true);
    setSaveProgress(0);
    setSavedCount(0);

    const fabricMod = await import("fabric");
    const proxyBase = getApiBaseUrl();

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      setSaveProgress(Math.round(((i + 0.5) / frames.length) * 100));

      const canvasEl = document.createElement("canvas");
      canvasEl.width = 1000;
      canvasEl.height = 1500;
      document.body.appendChild(canvasEl);

      let dataUrl: string | null = null;
      try {
        const FC = (fabricMod as any).Canvas || (fabricMod as any).default?.Canvas;
        const fc = new FC(canvasEl, { width: 1000, height: 1500, enableRetinaScaling: false });
        await buildTemplateOnCanvas(fabricMod, fc, selectedTemplate, frame.images, proxyBase, frame.title, overrides.websiteText || website, overrides);
        fc.getObjects().filter((o: any) => o.__isLabel).forEach((o: any) => o.set("visible", false));
        fc.renderAll();
        dataUrl = fc.toDataURL({ format: "png", multiplier: 1 });
        fc.dispose();
      } catch { /* skip */ } finally {
        document.body.removeChild(canvasEl);
      }

      if (dataUrl) {
        if (frame.recipeId) {
          try { await api.updateRecipe(frame.recipeId, { pin_design_image: dataUrl }); } catch { /* skip */ }
        }
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `pin-${String(i + 1).padStart(2, "0")}-${frame.title.replace(/[^a-z0-9]/gi, "_").slice(0, 30)}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setSavedCount((c) => c + 1);
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    setSaveProgress(100);
    setSavingAll(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-800 px-4 py-3 flex-shrink-0">
        <button onClick={onClose} className="flex items-center gap-1.5 text-gray-400 hover:text-white transition text-sm">
          <ArrowLeft size={16} /> Back
        </button>
        <span className="font-semibold text-white text-lg">Bulk Pin Designer</span>
        <span className="text-sm text-gray-500">{frames.length} recipes</span>
        <div className="ml-auto flex items-center gap-2">
          {savingAll && (
            <div className="flex items-center gap-2">
              <div className="w-32 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full transition-all duration-300" style={{ width: `${saveProgress}%` }} />
              </div>
              <span className="text-xs text-gray-400">{savedCount}/{frames.length}</span>
            </div>
          )}
          <button
            onClick={handleSaveAll}
            disabled={!selectedTemplate || savingAll || generating}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40"
          >
            {savingAll ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {savingAll ? `Saving ${saveProgress}%` : `Save All (${frames.length})`}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar: Templates + Style */}
        <aside className="w-72 border-r border-gray-800 flex flex-col flex-shrink-0 bg-gray-950">
          {/* Tab buttons */}
          <div className="flex border-b border-gray-800">
            <button
              onClick={() => setLeftTab("templates")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition ${
                leftTab === "templates" ? "text-brand-400 border-b-2 border-brand-500" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              <LayoutTemplate size={14} /> Templates
            </button>
            <button
              onClick={() => setLeftTab("style")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition ${
                leftTab === "style" ? "text-brand-400 border-b-2 border-brand-500" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              <Palette size={14} /> Style
            </button>
          </div>

          <div className="overflow-y-auto flex-1 p-3">
            {/* Templates tab */}
            {leftTab === "templates" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 mb-2">Select a template to apply to all recipes:</p>
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTemplate(t)}
                    className={`w-full rounded-lg border-2 p-2.5 text-left transition ${
                      selectedTemplate?.id === t.id
                        ? "border-brand-500 bg-brand-500/10"
                        : "border-gray-700 hover:border-gray-500"
                    }`}
                  >
                    <p className="text-xs font-medium text-white truncate">{t.name}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5 truncate">{t.description}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Style tab */}
            {leftTab === "style" && (
              <div className="space-y-5">
                {!selectedTemplate && (
                  <p className="text-xs text-yellow-500/80 bg-yellow-500/10 rounded-lg px-3 py-2">
                    Select a template first, then customize the style here.
                  </p>
                )}

                {/* Font Family */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">
                    <Type size={10} className="inline mr-1" />Font Family
                  </label>
                  <select
                    value={overrides.fontFamily || ""}
                    onChange={(e) => updateOverride("fontFamily", e.target.value || undefined)}
                    className="input-field text-sm w-full"
                    disabled={!selectedTemplate}
                  >
                    <option value="">Template default</option>
                    <optgroup label="Canva templates">
                      <option value="Triumvirate Compressed">Triumvirate Compressed</option>
                      <option value="Quintus Regular">Quintus Regular</option>
                      <option value="Penumbra Sans Std">Penumbra Sans Std</option>
                    </optgroup>
                    <optgroup label="System fonts">
                      <option value="Arial">Arial</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Courier New">Courier New</option>
                      <option value="Impact">Impact</option>
                    </optgroup>
                  </select>
                </div>

                {/* Font Size */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Title Font Size</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={16}
                      max={80}
                      step={2}
                      value={overrides.fontSize || 40}
                      onChange={(e) => updateOverride("fontSize", Number(e.target.value))}
                      className="flex-1 accent-brand-500"
                      disabled={!selectedTemplate}
                    />
                    <input
                      type="number"
                      min={16}
                      max={80}
                      value={overrides.fontSize || 40}
                      onChange={(e) => updateOverride("fontSize", Number(e.target.value))}
                      className="input-field text-sm w-16 text-center"
                      disabled={!selectedTemplate}
                    />
                  </div>
                </div>

                {/* Font Weight */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Title Font Weight</label>
                  <div className="flex gap-1">
                    {(["normal", "bold"] as const).map((w) => (
                      <button
                        key={w}
                        onClick={() => updateOverride("fontWeight", w)}
                        disabled={!selectedTemplate}
                        className={`flex-1 py-1.5 text-xs rounded-lg border transition capitalize ${
                          (overrides.fontWeight || "normal") === w
                            ? "border-brand-500 bg-brand-500/15 text-brand-400"
                            : "border-gray-700 text-gray-400 hover:border-gray-500"
                        } disabled:opacity-40`}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Title Color */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Title Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={overrides.titleColor || "#333333"}
                      onChange={(e) => updateOverride("titleColor", e.target.value)}
                      className="w-8 h-8 rounded border border-gray-700 cursor-pointer bg-transparent"
                      disabled={!selectedTemplate}
                    />
                    <input
                      type="text"
                      value={overrides.titleColor || ""}
                      onChange={(e) => updateOverride("titleColor", e.target.value || undefined)}
                      className="input-field text-sm flex-1"
                      placeholder="Template default"
                      disabled={!selectedTemplate}
                    />
                  </div>
                </div>

                {/* Band Color */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Band Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={overrides.bandColor || "#ffffff"}
                      onChange={(e) => updateOverride("bandColor", e.target.value)}
                      className="w-8 h-8 rounded border border-gray-700 cursor-pointer bg-transparent"
                      disabled={!selectedTemplate}
                    />
                    <input
                      type="text"
                      value={overrides.bandColor || ""}
                      onChange={(e) => updateOverride("bandColor", e.target.value || undefined)}
                      className="input-field text-sm flex-1"
                      placeholder="Template default"
                      disabled={!selectedTemplate}
                    />
                  </div>
                </div>

                {/* Background Color */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Background Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={overrides.bgColor || "#ffffff"}
                      onChange={(e) => updateOverride("bgColor", e.target.value)}
                      className="w-8 h-8 rounded border border-gray-700 cursor-pointer bg-transparent"
                      disabled={!selectedTemplate}
                    />
                    <input
                      type="text"
                      value={overrides.bgColor || ""}
                      onChange={(e) => updateOverride("bgColor", e.target.value || undefined)}
                      className="input-field text-sm flex-1"
                      placeholder="Template default"
                      disabled={!selectedTemplate}
                    />
                  </div>
                </div>

                {/* Website Text */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Website Text</label>
                  <input
                    type="text"
                    value={overrides.websiteText || ""}
                    onChange={(e) => updateOverride("websiteText", e.target.value || undefined)}
                    className="input-field text-sm w-full"
                    placeholder={website || "WWW.YOURSITE.COM"}
                    disabled={!selectedTemplate}
                  />
                </div>

                {/* Reset */}
                {selectedTemplate && Object.keys(overrides).some((k) => (overrides as any)[k] !== undefined) && (
                  <button
                    onClick={() => setOverrides({})}
                    className="w-full text-xs text-gray-500 hover:text-gray-300 py-2 border border-gray-700 rounded-lg hover:border-gray-500 transition"
                  >
                    Reset to template defaults
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Recipe Grid */}
        <main className="flex-1 overflow-y-auto p-6">
          {!selectedTemplate ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <LayoutTemplate size={48} className="text-gray-700 mb-4" />
              <p className="text-gray-400 text-lg font-medium">Select a template</p>
              <p className="text-gray-600 text-sm mt-1">Choose a template from the left panel to preview all your recipes</p>
            </div>
          ) : (
            <>
              {generating && (
                <div className="flex items-center gap-2 mb-4 px-1">
                  <Loader2 size={14} className="text-brand-400 animate-spin" />
                  <span className="text-xs text-gray-400">Updating {frames.length} previews...</span>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                {frames.map((frame, i) => (
                  <div
                    key={frame.recipeId}
                    className="group rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden hover:border-gray-600 transition"
                  >
                    <div className="aspect-[2/3] bg-gray-800 relative overflow-hidden">
                      {previews[i] ? (
                        <img src={previews[i]} alt={frame.title} className="w-full h-full object-cover" />
                      ) : generating ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                          <Loader2 size={24} className="text-brand-400 animate-spin" />
                          <span className="text-xs text-gray-500">Generating...</span>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <ImageIcon size={32} className="text-gray-700" />
                        </div>
                      )}
                      {previews[i] && (
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
                          <CheckCircle size={18} className="text-green-400 drop-shadow" />
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-xs text-white font-medium truncate">{frame.title}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Recipe {i + 1}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function PinDesignerPage() {
  const params = useParams<{ id: string; siteId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const recipeParam = searchParams.get("recipe");
  const modeParam = searchParams.get("mode");

  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [singleRecipe, setSingleRecipe] = useState<RecipeOut | null>(null);
  const [siteDomain, setSiteDomain] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.siteId) return;

    api
      .getSites(params.id)
      .then((sites) => {
        const found = sites.find((s) => s.id === params.siteId);
        if (found) setSiteDomain(found.domain || "");
      })
      .catch(() => {});

    if (recipeParam) {
      api
        .getRecipe(recipeParam)
        .then(setSingleRecipe)
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      api
        .getRecipes(params.siteId)
        .then((all) => {
          const generated = all.filter(
            (r) => r.status === "generated" || r.status === "published"
          );
          const source = generated.length > 0 ? generated : all;
          setFrames(
            source.map((r) => ({
              recipeId: r.id,
              title: r.recipe_text?.split("\n")[0]?.trim() || "Recipe",
              images: getRecipeImages(r),
            }))
          );
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [params.siteId, recipeParam]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 text-white">
        Loading...
      </div>
    );
  }

  if (singleRecipe) {
    return (
      <PinDesigner
        recipeId={singleRecipe.id}
        recipeImages={getRecipeImages(singleRecipe)}
        initialTitle={singleRecipe.recipe_text?.split("\n")[0]?.trim() || "Recipe"}
        initialJson={singleRecipe.pin_design_image?.startsWith("{") ? singleRecipe.pin_design_image : undefined}
        recipePinTitle={singleRecipe.pin_title ?? ""}
        recipePinDescription={singleRecipe.pin_description ?? ""}
        projectId={params.id}
        siteId={params.siteId}
        website={siteDomain}
        onClose={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)}
      />
    );
  }

  if (modeParam === "bulk") {
    return (
      <BulkDesigner
        frames={frames}
        projectId={params.id}
        siteId={params.siteId}
        website={siteDomain}
        onClose={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)}
      />
    );
  }

  return (
    <PinDesigner
      frames={frames}
      projectId={params.id}
      siteId={params.siteId}
      website={siteDomain}
      onClose={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)}
    />
  );
}
