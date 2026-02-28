"use client";

import { useEffect, useRef, useState } from "react";
import { X, Download, ZoomIn, ZoomOut, Layers, LayoutTemplate, Grid3X3 } from "lucide-react";

const PIN_W = 1000;
const PIN_H = 1500;

interface TemplateElement {
  id: string;
  type: "image" | "text";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defaultText?: string;
  fontSize?: number;
  fontWeight?: string;
  fill?: string;
  bgColor?: string;
}

interface PinTemplate {
  id: string;
  name: string;
  description: string;
  previewLayout: "simple" | "grid4" | "grid6" | "hero" | "sandwich";
  bgColor: string;
  elements: TemplateElement[];
}

const TEMPLATES: PinTemplate[] = [
  {
    id: "recipe-simple",
    name: "Recipe Simple",
    description: "1 image top, title, 1 image bottom",
    previewLayout: "simple",
    bgColor: "#f5f0e8",
    elements: [
      { id: "image1", type: "image", label: "Top Image", x: 40, y: 40, width: 920, height: 500, bgColor: "#e0d8cc" },
      { id: "title", type: "text", label: "Title", x: 500, y: 620, width: 900, height: 80, defaultText: "Recipe Title", fontSize: 56, fontWeight: "bold", fill: "#2d5016" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 700, width: 900, height: 50, defaultText: "Delicious & Easy", fontSize: 28, fill: "#666666" },
      { id: "image2", type: "image", label: "Bottom Image", x: 40, y: 780, width: 920, height: 500, bgColor: "#e0d8cc" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1400, width: 900, height: 40, defaultText: "YourWebsite.com", fontSize: 24, fill: "#888888" },
    ],
  },
  {
    id: "images-text-images",
    name: "Images + Text + Images",
    description: "2 images top, text center, 2 images bottom",
    previewLayout: "sandwich",
    bgColor: "#ffffff",
    elements: [
      { id: "image1", type: "image", label: "Top Left", x: 40, y: 40, width: 450, height: 350, bgColor: "#e8e8e8" },
      { id: "image2", type: "image", label: "Top Right", x: 510, y: 40, width: 450, height: 350, bgColor: "#e8e8e8" },
      { id: "title", type: "text", label: "Title", x: 500, y: 480, width: 900, height: 80, defaultText: "THE BEST", fontSize: 72, fontWeight: "bold", fill: "#e63946" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 580, width: 900, height: 60, defaultText: "COMFORT FOOD RECIPES", fontSize: 36, fontWeight: "bold", fill: "#1d3557" },
      { id: "description", type: "text", label: "Description", x: 500, y: 660, width: 900, height: 40, defaultText: "FOR BEGINNERS", fontSize: 28, fill: "#666666" },
      { id: "image3", type: "image", label: "Bottom Left", x: 40, y: 750, width: 450, height: 350, bgColor: "#e8e8e8" },
      { id: "image4", type: "image", label: "Bottom Right", x: 510, y: 750, width: 450, height: 350, bgColor: "#e8e8e8" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1180, width: 900, height: 40, defaultText: "YourWebsite.com", fontSize: 28, fill: "#e63946" },
    ],
  },
  {
    id: "top-4-grid",
    name: "Top 4 Grid",
    description: "4 images in 2x2 grid with title",
    previewLayout: "grid4",
    bgColor: "#ffffff",
    elements: [
      { id: "image1", type: "image", label: "Image 1", x: 40, y: 40, width: 450, height: 400, bgColor: "#e8e8e8" },
      { id: "image2", type: "image", label: "Image 2", x: 510, y: 40, width: 450, height: 400, bgColor: "#e8e8e8" },
      { id: "title", type: "text", label: "Title", x: 500, y: 520, width: 900, height: 80, defaultText: "THE BEST 4", fontSize: 64, fontWeight: "bold", fill: "#e63946" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 620, width: 900, height: 60, defaultText: "COMFORT FOOD RECIPES", fontSize: 36, fontWeight: "bold", fill: "#1d3557" },
      { id: "image3", type: "image", label: "Image 3", x: 40, y: 720, width: 450, height: 400, bgColor: "#e8e8e8" },
      { id: "image4", type: "image", label: "Image 4", x: 510, y: 720, width: 450, height: 400, bgColor: "#e8e8e8" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1200, width: 900, height: 40, defaultText: "YourWebsite.com", fontSize: 28, fill: "#e63946" },
    ],
  },
  {
    id: "top-6-clean",
    name: "Top 6 Clean",
    description: "6 images with header title",
    previewLayout: "grid6",
    bgColor: "#fefefe",
    elements: [
      { id: "header", type: "text", label: "Header", x: 500, y: 60, width: 900, height: 50, defaultText: "TOP 6", fontSize: 48, fontWeight: "bold", fill: "#2d3436" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 120, width: 900, height: 40, defaultText: "Vegan Recipes for Christmas", fontSize: 24, fill: "#636e72" },
      { id: "image1", type: "image", label: "Image 1", x: 40, y: 180, width: 300, height: 280, bgColor: "#dfe6e9" },
      { id: "image2", type: "image", label: "Image 2", x: 350, y: 180, width: 300, height: 280, bgColor: "#dfe6e9" },
      { id: "image3", type: "image", label: "Image 3", x: 660, y: 180, width: 300, height: 280, bgColor: "#dfe6e9" },
      { id: "image4", type: "image", label: "Image 4", x: 40, y: 480, width: 300, height: 280, bgColor: "#dfe6e9" },
      { id: "image5", type: "image", label: "Image 5", x: 350, y: 480, width: 300, height: 280, bgColor: "#dfe6e9" },
      { id: "image6", type: "image", label: "Image 6", x: 660, y: 480, width: 300, height: 280, bgColor: "#dfe6e9" },
      { id: "footer", type: "text", label: "Footer", x: 500, y: 820, width: 900, height: 40, defaultText: "Dinner starters, sides & main course dishes", fontSize: 22, fill: "#636e72" },
    ],
  },
  {
    id: "featured-hero",
    name: "Featured Hero",
    description: "Big hero image with overlay text",
    previewLayout: "hero",
    bgColor: "#1a1a2e",
    elements: [
      { id: "hero", type: "image", label: "Hero Image", x: 0, y: 0, width: 1000, height: 1000, bgColor: "#2d2d44" },
      { id: "title", type: "text", label: "Title", x: 500, y: 1100, width: 900, height: 100, defaultText: "AMAZING RECIPE", fontSize: 72, fontWeight: "bold", fill: "#ffffff" },
      { id: "subtitle", type: "text", label: "Description", x: 500, y: 1200, width: 900, height: 60, defaultText: "Quick & Easy to Make", fontSize: 32, fill: "#ffd700" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1400, width: 900, height: 40, defaultText: "YourWebsite.com", fontSize: 24, fill: "#cccccc" },
    ],
  },
];

function TemplatePreview({ layout }: { layout: PinTemplate["previewLayout"] }) {
  const imgBox = "bg-gradient-to-br from-orange-200 to-orange-300 rounded";
  const textBox = "bg-gray-700 rounded";

  if (layout === "simple") {
    return (
      <div className="h-full flex flex-col gap-1 p-1">
        <div className={`${imgBox} flex-[3]`} />
        <div className={`${textBox} flex-[1] flex items-center justify-center text-[8px] text-white font-bold`}>TITLE</div>
        <div className={`${imgBox} flex-[3]`} />
      </div>
    );
  }
  if (layout === "sandwich") {
    return (
      <div className="h-full flex flex-col gap-1 p-1">
        <div className="flex gap-1 flex-[2]">
          <div className={`${imgBox} flex-1`} />
          <div className={`${imgBox} flex-1`} />
        </div>
        <div className={`${textBox} flex-[1.5] flex items-center justify-center text-[8px] text-white font-bold`}>TITLE TEXT</div>
        <div className="flex gap-1 flex-[2]">
          <div className={`${imgBox} flex-1`} />
          <div className={`${imgBox} flex-1`} />
        </div>
      </div>
    );
  }
  if (layout === "grid4") {
    return (
      <div className="h-full flex flex-col gap-1 p-1">
        <div className="flex gap-1 flex-[2]">
          <div className={`${imgBox} flex-1`} />
          <div className={`${imgBox} flex-1`} />
        </div>
        <div className={`${textBox} flex-[1] flex items-center justify-center text-[8px] text-white font-bold`}>TITLE</div>
        <div className="flex gap-1 flex-[2]">
          <div className={`${imgBox} flex-1`} />
          <div className={`${imgBox} flex-1`} />
        </div>
      </div>
    );
  }
  if (layout === "grid6") {
    return (
      <div className="h-full flex flex-col gap-1 p-1">
        <div className={`${textBox} h-4 flex items-center justify-center text-[7px] text-white font-bold`}>TOP 6</div>
        <div className="flex gap-0.5 flex-[2]">
          <div className={`${imgBox} flex-1`} />
          <div className={`${imgBox} flex-1`} />
          <div className={`${imgBox} flex-1`} />
        </div>
        <div className="flex gap-0.5 flex-[2]">
          <div className={`${imgBox} flex-1`} />
          <div className={`${imgBox} flex-1`} />
          <div className={`${imgBox} flex-1`} />
        </div>
      </div>
    );
  }
  if (layout === "hero") {
    return (
      <div className="h-full flex flex-col gap-1 p-1">
        <div className={`${imgBox} flex-[4]`} />
        <div className={`${textBox} flex-[1] flex items-center justify-center text-[8px] text-white font-bold`}>TITLE</div>
      </div>
    );
  }
  return null;
}

export interface PinDesignerProps {
  onClose: () => void;
  templateName?: string;
  initialTitle?: string;
  recipeImages?: string[];
}

export default function PinDesigner({
  onClose,
  templateName = "My Pin",
  initialTitle = "Recipe Title",
  recipeImages = [],
}: PinDesignerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<any>(null);
  const fabricLibRef = useRef<any>(null);
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(35);
  const [leftTab, setLeftTab] = useState<"templates" | "layers" | "elements">("templates");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PinTemplate>(TEMPLATES[0]);
  const [editText, setEditText] = useState("");
  const [pinName, setPinName] = useState(templateName);
  const [layers, setLayers] = useState<{ id: string; label: string; type: string }[]>([]);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadTemplate = async (template: PinTemplate) => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;

    canvas.clear();
    canvas.backgroundColor = template.bgColor;

    const { Rect, FabricText } = fabric;

    for (const el of template.elements) {
      if (el.type === "image") {
        const rect = new Rect({
          left: el.x,
          top: el.y,
          width: el.width,
          height: el.height,
          fill: el.bgColor || "#e0e0e0",
          rx: 8,
          ry: 8,
          selectable: true,
          strokeWidth: 2,
          stroke: "#cccccc",
        });
        (rect as any).__pinId = el.id;
        (rect as any).__pinLabel = el.label;
        (rect as any).__pinType = "image";
        canvas.add(rect);

        const label = new FabricText(el.label, {
          left: el.x + el.width / 2,
          top: el.y + el.height / 2,
          fontSize: 18,
          fontFamily: "Arial",
          fill: "#999999",
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
        });
        (label as any).__isLabel = true;
        (label as any).__forId = el.id;
        canvas.add(label);
      } else if (el.type === "text") {
        const text = new FabricText(el.id === "title" && initialTitle ? initialTitle : (el.defaultText || "Text"), {
          left: el.x,
          top: el.y,
          fontSize: el.fontSize || 32,
          fontFamily: "Arial",
          fontWeight: el.fontWeight || "normal",
          fill: el.fill || "#333333",
          originX: "center",
          originY: "center",
          selectable: true,
          textAlign: "center",
        });
        (text as any).__pinId = el.id;
        (text as any).__pinLabel = el.label;
        (text as any).__pinType = "text";
        canvas.add(text);
      }
    }

    canvas.renderAll();
    updateLayers();
  };

  const updateLayers = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const objs = canvas.getObjects().filter((o: any) => o.__pinId && !o.__isLabel);
    setLayers(objs.map((o: any) => ({ id: o.__pinId, label: o.__pinLabel || o.__pinId, type: o.__pinType })));
  };

  useEffect(() => {
    if (!mounted || !canvasRef.current) return;
    if (fabricCanvasRef.current) return;

    let disposed = false;

    const initCanvas = async () => {
      try {
        const fabric = await import("fabric");
        if (disposed) return;

        fabricLibRef.current = fabric;
        const { Canvas } = fabric;

        const canvas = new Canvas(canvasRef.current!, {
          width: PIN_W,
          height: PIN_H,
          backgroundColor: selectedTemplate.bgColor,
        });
        fabricCanvasRef.current = canvas;

        canvas.on("selection:created", (e: any) => {
          const obj = e.selected?.[0];
          if (obj?.__pinId) {
            setSelectedId(obj.__pinId);
            setEditText(obj.text ?? "");
          }
        });
        canvas.on("selection:updated", (e: any) => {
          const obj = e.selected?.[0];
          if (obj?.__pinId) {
            setSelectedId(obj.__pinId);
            setEditText(obj.text ?? "");
          }
        });
        canvas.on("selection:cleared", () => {
          setSelectedId(null);
          setEditText("");
        });

        setCanvasReady(true);
        await loadTemplate(selectedTemplate);
      } catch (err) {
        console.error("Fabric init error:", err);
      }
    };

    initCanvas();

    return () => {
      disposed = true;
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.dispose();
        fabricCanvasRef.current = null;
      }
    };
  }, [mounted]);

  useEffect(() => {
    if (canvasReady) {
      loadTemplate(selectedTemplate);
    }
  }, [selectedTemplate, canvasReady]);

  const handleUseTemplate = (template: PinTemplate) => {
    setSelectedTemplate(template);
  };

  const setZoomPct = (pct: number) => setZoom(Math.max(20, Math.min(150, pct)));

  const handleExport = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.getObjects().filter((o: any) => o.__isLabel).forEach((o: any) => o.set("visible", false));
    canvas.renderAll();
    const data = canvas.toDataURL({ format: "png", multiplier: 1 });
    canvas.getObjects().filter((o: any) => o.__isLabel).forEach((o: any) => o.set("visible", true));
    canvas.renderAll();
    const a = document.createElement("a");
    a.href = data;
    a.download = `${pinName.replace(/[^a-z0-9]/gi, "_")}_pin.png`;
    a.click();
  };

  const applyEditText = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !selectedId) return;
    const obj = canvas.getObjects().find((o: any) => o.__pinId === selectedId);
    if (obj && obj.set && obj.__pinType === "text") {
      obj.set("text", editText);
      canvas.renderAll();
    }
  };

  const applyImage = (imageUrl: string) => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas || !imageUrl.trim() || !selectedId) return;

    const target = canvas.getObjects().find((o: any) => o.__pinId === selectedId);
    if (!target || target.__pinType !== "image") return;

    const l = target.left ?? 0;
    const t = target.top ?? 0;
    const w = target.width ?? 400;
    const h = target.height ?? 400;

    fabric.FabricImage.fromURL(imageUrl.trim(), { crossOrigin: "anonymous" })
      .then((img: any) => {
        img.set({
          left: l,
          top: t,
          scaleX: w / (img.width || 1),
          scaleY: h / (img.height || 1),
        });
        img.__pinId = selectedId;
        img.__pinLabel = target.__pinLabel;
        img.__pinType = "image";
        canvas.remove(target);
        const label = canvas.getObjects().find((o: any) => o.__forId === selectedId);
        if (label) canvas.remove(label);
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
        updateLayers();
      })
      .catch(() => alert("Could not load image. Check URL or CORS."));
  };

  const selectById = (id: string) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const obj = canvas.getObjects().find((o: any) => o.__pinId === id);
    if (obj) {
      canvas.setActiveObject(obj);
      canvas.renderAll();
      setSelectedId(id);
      setEditText(obj.text ?? "");
    }
  };

  const selectedElement = layers.find((l) => l.id === selectedId);

  if (!mounted) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 text-white">Loading designer...</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950 text-white">
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
        <span className="font-semibold text-white">Pin Designer</span>
        <input
          value={pinName}
          onChange={(e) => setPinName(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm w-64"
          placeholder="Template name"
        />
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-primary flex items-center gap-2 px-3 py-1.5 text-sm">
            <Download size={16} /> Export
          </button>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-64 border-r border-gray-800 flex flex-col">
          <div className="flex border-b border-gray-800">
            <button
              onClick={() => setLeftTab("templates")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs ${leftTab === "templates" ? "text-brand-400 border-b-2 border-brand-500" : "text-gray-500"}`}
            >
              <LayoutTemplate size={14} /> Templates
            </button>
            <button
              onClick={() => setLeftTab("layers")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs ${leftTab === "layers" ? "text-brand-400 border-b-2 border-brand-500" : "text-gray-500"}`}
            >
              <Layers size={14} /> Layers
            </button>
          </div>
          <div className="p-3 overflow-y-auto flex-1">
            {leftTab === "templates" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 mb-2">Choose a template:</p>
                {TEMPLATES.map((t) => (
                  <div
                    key={t.id}
                    className={`rounded-lg border-2 p-3 cursor-pointer transition ${
                      selectedTemplate.id === t.id
                        ? "border-brand-500 bg-brand-500/10"
                        : "border-gray-700 hover:border-gray-500"
                    }`}
                  >
                    <div className="h-28 rounded bg-gray-800 mb-2 overflow-hidden">
                      <TemplatePreview layout={t.previewLayout} />
                    </div>
                    <p className="text-sm font-medium text-white">{t.name}</p>
                    <p className="text-[11px] text-gray-500 mb-2">{t.description}</p>
                    <button
                      onClick={() => handleUseTemplate(t)}
                      className={`text-xs px-3 py-1 rounded ${
                        selectedTemplate.id === t.id
                          ? "bg-brand-500 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      {selectedTemplate.id === t.id ? "✓ Selected" : "Use Template"}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {leftTab === "layers" && (
              <div className="space-y-1">
                <p className="text-xs text-gray-400 mb-2">Click to select & edit:</p>
                {layers.length === 0 && <p className="text-xs text-gray-500">No layers</p>}
                {layers.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => selectById(l.id)}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
                      selectedId === l.id ? "bg-brand-500/20 text-brand-400" : "text-gray-300 hover:bg-gray-800"
                    }`}
                  >
                    {l.type === "image" ? <Grid3X3 size={14} /> : <span className="text-xs">Aa</span>}
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-auto bg-gray-900">
          <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-4 py-2 flex items-center justify-center gap-2">
            <button onClick={() => setZoomPct(zoom - 10)} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700">
              <ZoomOut size={18} />
            </button>
            <span className="text-sm text-gray-400 w-12 text-center">{zoom}%</span>
            <button onClick={() => setZoomPct(zoom + 10)} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700">
              <ZoomIn size={18} />
            </button>
          </div>
          <div className="p-4 flex justify-center" style={{ minHeight: `${(PIN_H * zoom) / 100 + 40}px` }}>
            <div
              style={{ 
                transform: `scale(${zoom / 100})`, 
                transformOrigin: "top center",
                width: PIN_W,
                height: PIN_H,
              }}
              className="shadow-2xl rounded-lg overflow-hidden border-2 border-gray-600 flex-shrink-0"
            >
              <canvas ref={canvasRef} />
            </div>
          </div>
        </main>

        <aside className="w-72 border-l border-gray-800 p-4 overflow-y-auto">
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-3">Properties</h4>
          {selectedElement ? (
            <div className="space-y-4">
              <div className="p-3 bg-gray-800 rounded-lg">
                <p className="text-sm font-medium text-white">{selectedElement.label}</p>
                <p className="text-xs text-gray-500">{selectedElement.type === "image" ? "Image slot" : "Text element"}</p>
              </div>

              {selectedElement.type === "text" && (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Edit Text</label>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={applyEditText}
                    rows={3}
                    className="input-field text-sm w-full"
                    placeholder="Enter text..."
                  />
                  <button onClick={applyEditText} className="btn-primary text-xs px-3 py-1.5 mt-2 w-full">
                    Apply Text
                  </button>
                </div>
              )}

              {selectedElement.type === "image" && (
                <div>
                  <label className="text-xs text-gray-400 block mb-2">Choose Image</label>
                  {recipeImages.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {recipeImages.slice(0, 8).map((url, i) => (
                        <button
                          key={i}
                          onClick={() => applyImage(url)}
                          className="rounded-lg overflow-hidden border-2 border-gray-700 hover:border-brand-500 transition"
                        >
                          <img src={url} alt={`Image ${i + 1}`} className="w-full h-20 object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 mb-2">No recipe images available</p>
                  )}
                  <div className="mt-3">
                    <label className="text-xs text-gray-400 block mb-1">Or paste URL:</label>
                    <input
                      className="input-field text-sm w-full"
                      placeholder="https://..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          applyImage((e.target as HTMLInputElement).value);
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">Select an element on the canvas to edit it.</p>
              <p className="text-xs text-gray-600 mt-2">Or use the Layers tab to select.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
