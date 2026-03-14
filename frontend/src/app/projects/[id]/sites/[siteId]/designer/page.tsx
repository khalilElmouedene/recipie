"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import PinDesigner, {
  FrameInfo,
  TEMPLATES,
  PinTemplate,
  buildTemplateOnCanvas,
} from "@/components/PinDesigner";
import { api, getApiBaseUrl, RecipeOut } from "@/lib/api";
import {
  ArrowLeft,
  Download,
  LayoutTemplate,
  Loader2,
  CheckCircle,
  Image as ImageIcon,
  Pencil,
  X,
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
  recipes,
  projectId,
  siteId,
  website,
  onClose,
}: {
  frames: FrameInfo[];
  recipes: RecipeOut[];
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
  const abortRef = useRef(false);

  // Which recipe is open in the full editor (index or null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const generateSinglePreview = useCallback(
    async (idx: number, template: PinTemplate) => {
      const fabricMod = await import("fabric");
      const proxyBase = getApiBaseUrl();
      const frame = frames[idx];

      const canvasEl = document.createElement("canvas");
      canvasEl.width = 1000;
      canvasEl.height = 1500;
      document.body.appendChild(canvasEl);

      try {
        const FC = (fabricMod as any).Canvas || (fabricMod as any).default?.Canvas;
        const fc = new FC(canvasEl, { width: 1000, height: 1500, enableRetinaScaling: false });
        await buildTemplateOnCanvas(fabricMod, fc, template, frame.images, proxyBase, frame.title, website);
        fc.getObjects().filter((o: any) => o.__isLabel).forEach((o: any) => o.set("visible", false));
        fc.renderAll();
        const dataUrl = fc.toDataURL({ format: "png", multiplier: 0.3 });
        setPreviews((prev) => ({ ...prev, [idx]: dataUrl }));
        fc.dispose();
      } catch { /* skip */ } finally {
        document.body.removeChild(canvasEl);
      }
    },
    [frames, website]
  );

  const generatePreviews = useCallback(
    async (template: PinTemplate) => {
      setGenerating(true);
      setPreviews({});

      for (let i = 0; i < frames.length; i++) {
        if (abortRef.current) break;
        await generateSinglePreview(i, template);
        await new Promise((r) => setTimeout(r, 50));
      }

      setGenerating(false);
    },
    [frames, generateSinglePreview]
  );

  const handleSelectTemplate = (t: PinTemplate) => {
    setSelectedTemplate(t);
    generatePreviews(t);
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
        await buildTemplateOnCanvas(fabricMod, fc, selectedTemplate, frame.images, proxyBase, frame.title, website);
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

  const handleCloseEditor = async (idx: number) => {
    setEditingIdx(null);
    // Refresh the preview for the recipe that was just edited
    const recipe = await api.getRecipe(frames[idx].recipeId).catch(() => null);
    if (recipe?.pin_design_image && !recipe.pin_design_image.startsWith("{")) {
      setPreviews((prev) => ({ ...prev, [idx]: recipe.pin_design_image! }));
    } else if (selectedTemplate) {
      await generateSinglePreview(idx, selectedTemplate);
    }
  };

  // If editing a specific recipe, show the full PinDesigner
  if (editingIdx !== null) {
    const frame = frames[editingIdx];
    const recipe = recipes.find((r) => r.id === frame.recipeId);
    return (
      <PinDesigner
        recipeId={frame.recipeId}
        recipeImages={frame.images}
        initialTitle={frame.title}
        initialJson={recipe?.pin_design_image?.startsWith("{") ? recipe.pin_design_image : undefined}
        initialTemplateId={selectedTemplate?.id}
        recipePinTitle={recipe?.pin_title ?? ""}
        recipePinDescription={recipe?.pin_description ?? ""}
        projectId={projectId}
        siteId={siteId}
        website={website}
        onClose={() => handleCloseEditor(editingIdx)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-800 px-4 py-3 flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white transition text-sm"
        >
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
        {/* Template Sidebar */}
        <aside className="w-64 border-r border-gray-800 flex flex-col flex-shrink-0 bg-gray-950">
          <div className="px-3 py-3 border-b border-gray-800">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <LayoutTemplate size={14} />
              <span className="font-medium">Templates</span>
            </div>
          </div>
          <div className="p-3 space-y-3 overflow-y-auto flex-1">
            <p className="text-xs text-gray-500">Select a template to preview all recipes:</p>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelectTemplate(t)}
                className={`w-full rounded-lg border-2 p-2 text-left transition ${
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
              {frames.map((frame, i) => (
                <div
                  key={frame.recipeId}
                  className="group rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden hover:border-brand-500/60 transition cursor-pointer"
                  onClick={() => setEditingIdx(i)}
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
                    {/* Hover overlay with edit button */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-brand-500/90 flex items-center justify-center">
                          <Pencil size={18} className="text-white" />
                        </div>
                        <span className="text-xs font-medium text-white bg-black/50 px-2 py-0.5 rounded">Click to edit</span>
                      </div>
                    </div>
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
          )}

          {generating && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Loader2 size={16} className="text-brand-400 animate-spin" />
              <span className="text-sm text-gray-400">Generating previews for {frames.length} recipes...</span>
            </div>
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
  const [allRecipes, setAllRecipes] = useState<RecipeOut[]>([]);
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
          setAllRecipes(source);
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
        initialTitle={
          singleRecipe.recipe_text?.split("\n")[0]?.trim() || "Recipe"
        }
        initialJson={
          singleRecipe.pin_design_image?.startsWith("{")
            ? singleRecipe.pin_design_image
            : undefined
        }
        recipePinTitle={singleRecipe.pin_title ?? ""}
        recipePinDescription={singleRecipe.pin_description ?? ""}
        projectId={params.id}
        siteId={params.siteId}
        website={siteDomain}
        onClose={() =>
          router.push(`/projects/${params.id}/sites/${params.siteId}`)
        }
      />
    );
  }

  if (modeParam === "bulk") {
    return (
      <BulkDesigner
        frames={frames}
        recipes={allRecipes}
        projectId={params.id}
        siteId={params.siteId}
        website={siteDomain}
        onClose={() =>
          router.push(`/projects/${params.id}/sites/${params.siteId}`)
        }
      />
    );
  }

  return (
    <PinDesigner
      frames={frames}
      projectId={params.id}
      siteId={params.siteId}
      website={siteDomain}
      onClose={() =>
        router.push(`/projects/${params.id}/sites/${params.siteId}`)
      }
    />
  );
}
