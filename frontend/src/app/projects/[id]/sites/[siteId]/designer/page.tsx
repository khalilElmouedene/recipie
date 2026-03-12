"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import PinDesigner, { TEMPLATES, buildTemplateOnCanvas, PinDesignerApi } from "@/components/PinDesigner";
import { api, RecipeOut, getApiBaseUrl } from "@/lib/api";
import { Download, ChevronLeft, ChevronRight, Layers } from "lucide-react";

interface FrameInfo {
  recipeId: string;
  title: string;
  images: string[];
}

function getRecipeImages(r: RecipeOut): string[] {
  const images: string[] = [];
  if (r.generated_images) {
    try {
      const arr = JSON.parse(r.generated_images);
      if (Array.isArray(arr)) arr.forEach((url: string) => { if (url?.trim()) images.push(url.trim()); });
    } catch {}
  }
  if (r.image_url && !images.includes(r.image_url)) images.push(r.image_url);
  return images;
}

export default function PinDesignerPage() {
  const params = useParams<{ id: string; siteId: string }>();
  const router = useRouter();

  const [recipes, setRecipes] = useState<RecipeOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  // Global template applied to all frames; per-frame override map
  const [globalTemplateId, setGlobalTemplateId] = useState<string | null>(null);
  const [frameTemplates, setFrameTemplates] = useState<Record<number, string>>({});

  // Cached canvas JSON per frame (saved when switching away)
  const frameJsonsRef = useRef<Record<number, string>>({});
  // Current active designer API
  const designerApiRef = useRef<PinDesignerApi | null>(null);

  const [savingAll, setSavingAll] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  useEffect(() => {
    if (!params.siteId) return;
    api.getRecipes(params.siteId)
      .then((all) => {
        setRecipes(all);
        const generated = all.filter((r) =>
          r.status === "generated" || r.status === "published"
        );
        const source = generated.length > 0 ? generated : all;
        setFrames(source.map((r) => ({
          recipeId: r.id,
          title: r.recipe_text?.split("\n")[0]?.trim() || "Recipe",
          images: getRecipeImages(r),
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.siteId]);

  const saveCurrentFrame = () => {
    if (designerApiRef.current) {
      frameJsonsRef.current[activeIdx] = designerApiRef.current.getJson();
    }
  };

  const switchToFrame = (newIdx: number) => {
    if (newIdx === activeIdx || newIdx < 0 || newIdx >= frames.length) return;
    saveCurrentFrame();
    designerApiRef.current = null;
    setActiveIdx(newIdx);
  };

  const handleTemplateSelected = (templateId: string) => {
    // Track which template is active for this frame
    setFrameTemplates((prev) => ({ ...prev, [activeIdx]: templateId }));
    setGlobalTemplateId(templateId);
  };

  const handleApplyToAll = () => {
    if (!globalTemplateId) return;
    // Clear all saved JSONs so every frame reloads with template fresh
    frameJsonsRef.current = {};
    setFrameTemplates({});
    // Force remount of current frame by briefly switching away and back
    // (just clearing the stored json is enough – PinDesigner key handles remount)
    designerApiRef.current = null;
    // Re-trigger remount by incrementing a counter via the key
    setActiveIdx((prev) => prev); // triggers no state change but works with key below
    // Actually we need to force remount. Use a separate counter:
    setRemountKey((k) => k + 1);
  };

  const [remountKey, setRemountKey] = useState(0);

  const handleSaveAll = async () => {
    if (frames.length === 0) return;
    saveCurrentFrame();

    setSavingAll(true);
    setSaveProgress(0);

    const fabricMod = await import("fabric");
    const proxyBase = getApiBaseUrl();

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const savedJson = frameJsonsRef.current[i];
      const templateId = frameTemplates[i] || globalTemplateId;

      setSaveProgress(Math.round(((i + 0.5) / frames.length) * 100));

      let dataUrl: string | null = null;

      // Create offscreen canvas
      const canvasEl = document.createElement("canvas");
      canvasEl.width = 1000;
      canvasEl.height = 1500;
      document.body.appendChild(canvasEl);

      try {
        const FC = (fabricMod as any).Canvas || (fabricMod as any).default?.Canvas;
        const fc = new FC(canvasEl, {
          width: 1000,
          height: 1500,
          enableRetinaScaling: false,
        });

        if (savedJson && savedJson !== "{}") {
          await fc.loadFromJSON(savedJson);
          fc.renderAll();
        } else if (templateId) {
          const template = TEMPLATES.find((t) => t.id === templateId);
          if (template) {
            await buildTemplateOnCanvas(fabricMod, fc, template, frame.images, proxyBase, frame.title);
          }
        }

        // Hide placeholder labels
        fc.getObjects().filter((o: any) => o.__isLabel).forEach((o: any) => o.set("visible", false));
        fc.renderAll();
        dataUrl = fc.toDataURL({ format: "png", multiplier: 1 });
        fc.dispose();
      } catch (err) {
        console.error("Error exporting frame", i, err);
      } finally {
        document.body.removeChild(canvasEl);
      }

      if (dataUrl) {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `pin-${(i + 1).toString().padStart(2, "0")}-${frame.title.replace(/[^a-z0-9]/gi, "_").slice(0, 30)}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    setSaveProgress(100);
    setSavingAll(false);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 text-white">
        Loading...
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950 text-white gap-4">
        <p className="text-gray-400">No generated recipes found for this site.</p>
        <button onClick={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)} className="btn-secondary">
          Go back
        </button>
      </div>
    );
  }

  const activeFrame = frames[activeIdx];
  const activeTemplateId = frameTemplates[activeIdx] || globalTemplateId || undefined;
  const activeInitialJson = frameJsonsRef.current[activeIdx] || undefined;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950">

      {/* ── Frame Strip ──────────────────────────────────────────────────── */}
      {frames.length > 1 && (
        <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-3 py-2">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-gray-500 flex-shrink-0" />
            <span className="text-xs text-gray-500 flex-shrink-0">{frames.length} recipes</span>
            <div className="flex items-center gap-1.5 overflow-x-auto flex-1 scrollbar-hide">
              {frames.map((f, i) => {
                const tmpl = TEMPLATES.find((t) => t.id === (frameTemplates[i] || globalTemplateId));
                return (
                  <button
                    key={f.recipeId}
                    onClick={() => switchToFrame(i)}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition ${
                      i === activeIdx
                        ? "border-brand-500 bg-brand-600/10 text-brand-400"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600"
                    }`}
                  >
                    <span className="font-medium">{i + 1}</span>
                    <span className="max-w-[120px] truncate">{f.title}</span>
                    {tmpl && <span className="text-[10px] text-gray-500 hidden sm:inline">· {tmpl.name.split(":")[0].trim()}</span>}
                    {frameJsonsRef.current[i] && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" title="Edited" />}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => switchToFrame(activeIdx - 1)}
                disabled={activeIdx === 0}
                className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => switchToFrame(activeIdx + 1)}
                disabled={activeIdx === frames.length - 1}
                className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
              {globalTemplateId && (
                <button
                  onClick={handleApplyToAll}
                  className="ml-1 px-2 py-1 rounded text-xs bg-brand-600/20 text-brand-400 hover:bg-brand-600/30 border border-brand-700 whitespace-nowrap"
                  title="Re-apply current template to all frames (clears custom edits)"
                >
                  Apply to all
                </button>
              )}
              <button
                onClick={handleSaveAll}
                disabled={savingAll || !globalTemplateId}
                className="ml-1 px-2 py-1 rounded text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-700 flex items-center gap-1 disabled:opacity-40 whitespace-nowrap"
                title={!globalTemplateId ? "Select a template first" : "Download all frames as PNG"}
              >
                <Download size={12} />
                {savingAll ? `${saveProgress}%` : "Save All"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PinDesigner (remounts on frame change or apply-to-all) ───────── */}
      <div className="flex-1 min-h-0 relative">
        <PinDesigner
          key={`frame-${activeIdx}-${remountKey}`}
          templateName={activeFrame.title}
          initialTitle={activeFrame.title}
          recipeImages={activeFrame.images}
          projectId={params.id}
          siteId={params.siteId}
          recipeId={activeFrame.recipeId}
          initialJson={activeInitialJson}
          initialTemplateId={activeTemplateId}
          onApiReady={(api) => { designerApiRef.current = api; }}
          onTemplateSelected={handleTemplateSelected}
          embedded={frames.length > 1}
          onClose={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)}
        />
      </div>

      {/* Save All progress overlay */}
      {savingAll && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 text-center">
            <p className="text-white font-semibold mb-3">Generating {frames.length} pins...</p>
            <div className="w-48 bg-gray-700 rounded-full h-2">
              <div className="bg-brand-500 h-2 rounded-full transition-all" style={{ width: `${saveProgress}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-2">{saveProgress}%</p>
          </div>
        </div>
      )}
    </div>
  );
}
