"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import PinDesigner, {
  FrameInfo,
  PinDesignerApi,
  buildTemplateOnCanvas,
  TEMPLATES,
} from "@/components/PinDesigner";
import { api, getApiBaseUrl, RecipeOut } from "@/lib/api";
import {
  Download,
  Loader2,
  Image as ImageIcon,
  ChevronLeft,
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

// ── Bulk Designer: Canva-style page list + full embedded editor ──────────────

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
  const [activeIdx, setActiveIdx] = useState(0);
  const [canvasJsons, setCanvasJsons] = useState<Record<number, string>>({});
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const designerApiRef = useRef<PinDesignerApi | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  const pageListRef = useRef<HTMLDivElement>(null);

  const activeFrame = frames[activeIdx];

  const saveCurrentState = useCallback(() => {
    if (!designerApiRef.current) return;
    try {
      const json = designerApiRef.current.getJson();
      if (json && json !== "{}") {
        setCanvasJsons((prev) => ({ ...prev, [activeIdx]: json }));
      }
      const png = designerApiRef.current.exportPng();
      if (png) {
        setPreviews((prev) => ({ ...prev, [activeIdx]: png }));
      }
    } catch { /* skip */ }
  }, [activeIdx]);

  const handleSwitchPage = useCallback((newIdx: number) => {
    if (newIdx === activeIdx || newIdx < 0 || newIdx >= frames.length) return;
    saveCurrentState();
    setActiveIdx(newIdx);
  }, [activeIdx, frames.length, saveCurrentState]);

  const handleApiReady = useCallback((a: PinDesignerApi) => {
    designerApiRef.current = a;
  }, []);

  const handleTemplateSelected = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);
  }, []);

  const handleSaveAll = async () => {
    saveCurrentState();
    setSavingAll(true);
    setSaveProgress(0);

    const template = selectedTemplateId
      ? TEMPLATES.find((t) => t.id === selectedTemplateId)
      : null;

    const fabricMod = await import("fabric");
    const proxyBase = getApiBaseUrl();

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      setSaveProgress(Math.round(((i + 0.5) / frames.length) * 100));

      let dataUrl: string | null = null;

      if (i === activeIdx && designerApiRef.current) {
        dataUrl = designerApiRef.current.exportPng();
      } else {
        const savedJson = canvasJsons[i];
        const canvasEl = document.createElement("canvas");
        canvasEl.width = 1000;
        canvasEl.height = 1500;
        document.body.appendChild(canvasEl);

        try {
          const FC = (fabricMod as any).Canvas || (fabricMod as any).default?.Canvas;
          const fc = new FC(canvasEl, { width: 1000, height: 1500, enableRetinaScaling: false });

          if (savedJson && savedJson !== "{}") {
            await fc.loadFromJSON(savedJson);
            fc.renderAll();
          } else if (template) {
            await buildTemplateOnCanvas(fabricMod, fc, template, frame.images, proxyBase, frame.title, website);
          }

          fc.getObjects().filter((o: any) => o.__isLabel).forEach((o: any) => o.set("visible", false));
          fc.renderAll();
          dataUrl = fc.toDataURL({ format: "png", multiplier: 1 });
          fc.dispose();
        } catch { /* skip */ } finally {
          document.body.removeChild(canvasEl);
        }
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
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    setSaveProgress(100);
    setSavingAll(false);
  };

  // Scroll active page into view
  useEffect(() => {
    const container = pageListRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-page-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIdx]);

  return (
    <div className="fixed inset-0 z-50 flex bg-gray-950">
      {/* ── Page List (left strip) ──────────────────────────────────────────── */}
      <div className="w-[140px] flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-950">
        {/* Page list header */}
        <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-gray-800">
          <button onClick={onClose} className="text-gray-400 hover:text-white transition p-0.5">
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-semibold text-gray-300">Pages</span>
          <span className="text-[10px] text-gray-600 ml-auto">{frames.length}</span>
        </div>

        {/* Save All button */}
        <div className="px-2 py-2 border-b border-gray-800">
          <button
            onClick={handleSaveAll}
            disabled={savingAll}
            className="w-full btn-primary flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] disabled:opacity-40"
          >
            {savingAll ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {savingAll ? `${saveProgress}%` : `Save All`}
          </button>
        </div>

        {/* Scrollable page thumbnails */}
        <div ref={pageListRef} className="flex-1 overflow-y-auto p-2 space-y-3">
          {frames.map((frame, i) => (
            <div
              key={frame.recipeId}
              data-page-idx={i}
              onClick={() => handleSwitchPage(i)}
              className={`cursor-pointer rounded-lg overflow-hidden transition border-2 ${
                i === activeIdx
                  ? "border-brand-500 ring-1 ring-brand-500/30"
                  : "border-gray-700/50 hover:border-gray-600"
              }`}
            >
              {/* Page number */}
              <div className={`px-2 py-1 text-[10px] font-medium flex items-center justify-between ${
                i === activeIdx ? "bg-brand-500/10 text-brand-400" : "bg-gray-800/50 text-gray-500"
              }`}>
                <span>Page {i + 1}</span>
                {previews[i] && <span className="w-1.5 h-1.5 rounded-full bg-green-400" title="Edited" />}
              </div>
              {/* Preview */}
              <div className="aspect-[2/3] bg-gray-800 relative">
                {previews[i] ? (
                  <img src={previews[i]} alt={frame.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <ImageIcon size={20} className="text-gray-700" />
                  </div>
                )}
              </div>
              {/* Title */}
              <div className={`px-2 py-1.5 ${i === activeIdx ? "bg-brand-500/5" : "bg-gray-900/50"}`}>
                <p className="text-[10px] text-gray-400 truncate leading-tight">{frame.title}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PinDesigner (takes remaining space) ────────────────────────────── */}
      <div className="flex-1 relative">
        <PinDesigner
          key={activeFrame.recipeId}
          recipeId={activeFrame.recipeId}
          recipeImages={activeFrame.images}
          initialTitle={activeFrame.title}
          initialJson={canvasJsons[activeIdx]}
          initialTemplateId={selectedTemplateId}
          projectId={projectId}
          siteId={siteId}
          website={website}
          embedded
          onApiReady={handleApiReady}
          onTemplateSelected={handleTemplateSelected}
          onClose={onClose}
        />
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
