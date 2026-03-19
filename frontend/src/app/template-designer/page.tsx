"use client";

import React, { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Download,
  Type,
  Image as ImageIcon,
  Minus,
  Trash2,
  Upload,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Loader2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

const PIN_W = 1000;
const PIN_H = 1500;

let _uid = 0;
function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${++_uid}`;
}

type SelType = "text" | "image" | "band" | null;

const TEMPLATE_FONTS = [
  "Triumvirate Compressed",
  "Quintus Regular",
  "Penumbra Sans Std",
];

const SYSTEM_FONTS = [
  "Arial",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Courier New",
  "Impact",
];

function TemplateDesignerInner() {
  const router = useRouter();

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any>(null);
  const fabricLibRef = useRef<any>(null);

  const [mounted, setMounted] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [zoom, setZoom] = useState(38);

  // Template meta
  const [templateName, setTemplateName] = useState("My Template");
  const [bgColor, setBgColor] = useState("#ffffff");

  // Selection
  const [selType, setSelType] = useState<SelType>(null);

  // Text props
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(48);
  const [textColor, setTextColor] = useState("#333333");
  const [textAlign, setTextAlign] = useState("center");
  const [fontWeight, setFontWeight] = useState("normal");
  const [fontStyle, setFontStyle] = useState("normal");
  const [fontFamily, setFontFamily] = useState("Arial");
  const [customFonts, setCustomFonts] = useState<string[]>([]);
  const [fontInput, setFontInput] = useState("");
  const [fontLoading, setFontLoading] = useState(false);

  // Band / image zone color
  const [elemColor, setElemColor] = useState("#4a90d9");

  // Saving
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const injectFontStylesheet = useCallback((fontName: string) => {
    const family = fontName.trim().replace(/ /g, "+");
    if (!family) return;
    const linkId = `gfont-${family}`;
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@100;200;300;400;500;600;700;800;900&display=swap`;
      document.head.appendChild(link);
    }
  }, []);

  const saveFontsToDb = useCallback((fonts: string[]) => {
    api.setCustomFonts(fonts).catch(() => {});
  }, []);

  const loadGoogleFont = useCallback(async (fontName: string) => {
    const trimmed = fontName.trim();
    if (!trimmed) return;
    setFontLoading(true);
    try {
      injectFontStylesheet(trimmed);
      await document.fonts.load(`16px "${trimmed}"`);
      await document.fonts.ready;
      setCustomFonts((prev) => {
        const next = prev.includes(trimmed) ? prev : [...prev, trimmed];
        saveFontsToDb(next);
        return next;
      });
      setFontFamily(trimmed);
      applyText({ fontFamily: trimmed });
      setFontInput("");
    } catch {
      setCustomFonts((prev) => {
        const next = prev.includes(trimmed) ? prev : [...prev, trimmed];
        saveFontsToDb(next);
        return next;
      });
      setFontInput("");
    } finally {
      setFontLoading(false);
    }
  }, [injectFontStylesheet, saveFontsToDb]);

  useEffect(() => {
    Promise.all(TEMPLATE_FONTS.map((f) => document.fonts.load(`16px "${f}"`))).catch(() => {});
    api.getCustomFonts()
      .then((fonts) => {
        setCustomFonts(fonts);
        fonts.forEach(injectFontStylesheet);
      })
      .catch(() => {});
  }, [injectFontStylesheet]);

  // ── Canvas init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted || !canvasRef.current || fabricRef.current) return;
    let disposed = false;

    (async () => {
      try {
        const fabric = await import("fabric");
        if (disposed) return;

        fabricLibRef.current = fabric;
        const canvas = new fabric.Canvas(canvasRef.current!, {
          width: PIN_W,
          height: PIN_H,
          backgroundColor: "#ffffff",
          preserveObjectStacking: true,
        });
        fabricRef.current = canvas;

        canvas.on("selection:created", (e: any) => {
          const obj = e.selected?.[0];
          if (obj) syncSel(obj);
        });
        canvas.on("selection:updated", (e: any) => {
          const obj = e.selected?.[0];
          if (obj) syncSel(obj);
        });
        canvas.on("selection:cleared", () => {
          setSelType(null);
        });
        canvas.on("text:changed", (e: any) => {
          const t = e.target;
          if (t?.__ttype === "text") setText(t.text ?? "");
        });

        setCanvasReady(true);
      } catch (err) {
        console.error("Canvas init failed:", err);
      }
    })();

    return () => {
      disposed = true;
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
  }, [mounted]);

  // Sync bg color to canvas
  useEffect(() => {
    if (!canvasReady || !fabricRef.current) return;
    fabricRef.current.set("backgroundColor", bgColor);
    fabricRef.current.renderAll();
  }, [bgColor, canvasReady]);

  function syncSel(obj: any) {
    const rawType = obj?.__ttype;
    const t: SelType =
      rawType === "text" || rawType === "image" || rawType === "band"
        ? rawType
        : null;
    setSelType(t);
    if (t === "text") {
      setText(obj.text ?? "");
      setFontSize(obj.fontSize ?? 48);
      setTextColor(typeof obj.fill === "string" ? obj.fill : "#333333");
      setTextAlign(obj.textAlign ?? "center");
      setFontWeight(obj.fontWeight ?? "normal");
      setFontStyle(obj.fontStyle ?? "normal");
      setFontFamily(obj.fontFamily ?? "Arial");
    } else if (t === "band" || t === "image") {
      setElemColor(typeof obj.fill === "string" ? obj.fill : "#4a90d9");
    }
  }

  function getActive(): any | null {
    return fabricRef.current?.getActiveObject() ?? null;
  }

  // ── Add elements ───────────────────────────────────────────────────────────
  function addText() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    const tb = new fabric.Textbox("Text", {
      left: PIN_W / 2,
      top: PIN_H / 2 - 50,
      width: 800,
      fontSize: 64,
      fontFamily,
      fontWeight: "bold",
      fill: "#333333",
      textAlign: "center",
      originX: "center",
      originY: "center",
      editable: true,
    });
    (tb as any).__id = uid("text");
    (tb as any).__ttype = "text";
    canvas.add(tb);
    canvas.setActiveObject(tb);
    canvas.renderAll();
  }

  function addImageZone() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    const rect = new fabric.Rect({
      left: PIN_W / 2,
      top: PIN_H / 3,
      width: 800,
      height: 600,
      fill: "#e8e8e8",
      stroke: "#aaaaaa",
      strokeWidth: 3,
      strokeUniform: true,
      strokeDashArray: [10, 6],
      originX: "center",
      originY: "center",
    });
    (rect as any).__id = uid("image");
    (rect as any).__ttype = "image";
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  }

  function addBand() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    const rect = new fabric.Rect({
      left: 0,
      top: PIN_H / 2 - 100,
      width: PIN_W,
      height: 200,
      fill: "#4a90d9",
    });
    (rect as any).__id = uid("band");
    (rect as any).__ttype = "band";
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  }

  async function uploadBackground() {
    const fabric = fabricLibRef.current;
    const canvas = fabricRef.current;
    if (!fabric || !canvas) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const dataUrl = await readFileAsDataURL(file);
      const img = await fabric.FabricImage.fromURL(dataUrl, {
        crossOrigin: "anonymous",
      });
      const scale = Math.max(
        PIN_W / (img.width || 1),
        PIN_H / (img.height || 1)
      );
      img.set({
        left: PIN_W / 2,
        top: PIN_H / 2,
        originX: "center",
        originY: "center",
        scaleX: scale,
        scaleY: scale,
        selectable: true,
      });
      (img as any).__id = uid("bg");
      (img as any).__ttype = "asset";
      canvas.insertAt(0, img);
      canvas.renderAll();
    };
    input.click();
  }

  async function uploadImage() {
    const fabric = fabricLibRef.current;
    const canvas = fabricRef.current;
    if (!fabric || !canvas) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const dataUrl = await readFileAsDataURL(file);
      const img = await fabric.FabricImage.fromURL(dataUrl, {
        crossOrigin: "anonymous",
      });
      const scale = Math.min(
        600 / (img.width || 1),
        600 / (img.height || 1)
      );
      img.set({
        left: PIN_W / 2,
        top: PIN_H / 2,
        originX: "center",
        originY: "center",
        scaleX: scale,
        scaleY: scale,
      });
      (img as any).__id = uid("img");
      (img as any).__ttype = "asset";
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
    };
    input.click();
  }

  function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }

  function deleteSelected() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    canvas.remove(obj);
    canvas.discardActiveObject();
    canvas.renderAll();
    setSelType(null);
  }

  // ── Apply property changes ─────────────────────────────────────────────────
  function applyText(patch: Record<string, unknown>) {
    const obj = getActive();
    if (!obj || obj.__ttype !== "text") return;
    obj.set(patch);
    fabricRef.current?.renderAll();
  }

  function applyColor(color: string) {
    const obj = getActive();
    if (!obj) return;
    obj.set("fill", color);
    fabricRef.current?.renderAll();
    setElemColor(color);
  }

  // ── Extract elements for API ───────────────────────────────────────────────
  function extractElements() {
    const canvas = fabricRef.current;
    if (!canvas) return [];

    const results: object[] = [];
    for (const o of canvas.getObjects() as any[]) {
      if (!o.__id || !o.__ttype) continue;
      const type: string = o.__ttype;
      const scaleX = o.scaleX ?? 1;
      const scaleY = o.scaleY ?? 1;
      const w = (o.width ?? 0) * scaleX;
      const h = (o.height ?? 0) * scaleY;
      const ox = o.originX ?? "left";
      const oy = o.originY ?? "top";
      const x = ox === "center" ? (o.left ?? 0) - w / 2 : (o.left ?? 0);
      const y = oy === "center" ? (o.top ?? 0) - h / 2 : (o.top ?? 0);

      if (type === "text") {
        const cp = typeof o.getCenterPoint === "function"
          ? o.getCenterPoint()
          : { x: o.left ?? 0, y: o.top ?? 0 };
        results.push({
          id: o.__id,
          type: "text",
          label: String(o.text ?? "Text").slice(0, 30) || "Text",
          // PinDesigner text layout uses center coordinates.
          x: cp.x,
          y: cp.y,
          width: w || o.width || 800,
          height: h,
          defaultText: o.text ?? "",
          fontSize: o.fontSize ?? 48,
          fontWeight: o.fontWeight ?? "normal",
          fontStyle: o.fontStyle ?? "normal",
          fontFamily: o.fontFamily ?? "Arial",
          fill: typeof o.fill === "string" ? o.fill : "#333333",
          textAlign: o.textAlign ?? "center",
        });
      } else if (type === "image") {
        if (o.type !== "rect") continue;
        results.push({
          id: o.__id,
          type: "image",
          label: "Image Zone",
          x,
          y,
          width: w,
          height: h,
          bgColor: typeof o.fill === "string" ? o.fill : "#e8e8e8",
        });
      } else if (type === "band") {
        results.push({
          id: o.__id,
          type: "band",
          label: "Color Band",
          x,
          y,
          width: w,
          height: h,
          bgColor: typeof o.fill === "string" ? o.fill : "#4a90d9",
        });
      }
    }
    return results;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    const elements = extractElements();
    if (!elements.length) {
      alert("Add at least one element (Text, Image Zone, or Band) before saving.");
      return;
    }
    setSaving(true);
    try {
      await api.createPinDesignerTemplate({
        name: templateName.trim() || "My Template",
        description: null,
        bgColor,
        elements: elements as any,
      });
      alert(`Template "${templateName.trim() || "My Template"}" saved! You can now use it in the Pin Designer.`);
      router.back();
    } catch (e: any) {
      alert(e?.message || "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 1 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${templateName.replace(/[^a-z0-9]/gi, "_")}.png`;
    a.click();
  }

  const zoomPct = zoom / 100;
  const allFonts = Array.from(
    new Set([
      fontFamily,
      ...customFonts,
      ...TEMPLATE_FONTS,
      ...SYSTEM_FONTS,
    ].filter(Boolean))
  );

  return (
    <div className="fixed inset-0 bg-gray-950 flex flex-col text-white z-50">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="h-12 flex items-center gap-3 border-b border-gray-800 px-4 flex-shrink-0 bg-gray-950">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="font-bold text-white text-sm whitespace-nowrap">
          Template Designer
        </span>
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          className="ml-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 max-w-xs w-full"
          placeholder="Template Name"
        />
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition"
          >
            <Download size={14} /> Export
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-sm text-white transition disabled:opacity-50"
          >
            <Save size={14} /> {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left Panel ─────────────────────────────────────────────────── */}
        <aside className="w-52 border-r border-gray-800 bg-gray-950 flex flex-col overflow-y-auto flex-shrink-0">
          {/* IMAGE TEMPLATE */}
          <div className="p-3 border-b border-gray-800">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
              Image Template
            </p>
            <button
              onClick={uploadBackground}
              className="w-full flex flex-col items-center gap-2 py-5 rounded-xl border-2 border-dashed border-gray-700 hover:border-brand-500 hover:bg-gray-900 transition-all text-gray-400 hover:text-white"
            >
              <Upload size={24} className="text-brand-400" />
              <span className="text-[11px] font-medium">Upload Image Template</span>
            </button>
          </div>

          {/* ADD ELEMENTS */}
          <div className="p-3 border-b border-gray-800">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
              Add Elements
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={addText}
                className="flex flex-col items-center gap-2 py-4 rounded-xl border border-gray-700 hover:border-brand-500 hover:bg-gray-900 transition-all group"
              >
                <Type size={22} className="text-gray-400 group-hover:text-white transition" />
                <span className="text-[11px] text-gray-400 group-hover:text-white transition">
                  Text
                </span>
              </button>
              <button
                onClick={addImageZone}
                className="flex flex-col items-center gap-2 py-4 rounded-xl border border-gray-700 hover:border-brand-500 hover:bg-gray-900 transition-all group"
              >
                <ImageIcon size={22} className="text-gray-400 group-hover:text-white transition" />
                <span className="text-[11px] text-gray-400 group-hover:text-white transition">
                  Image Zone
                </span>
              </button>
              <button
                onClick={addBand}
                className="flex flex-col items-center gap-2 py-4 rounded-xl border border-gray-700 hover:border-brand-500 hover:bg-gray-900 transition-all group"
              >
                <Minus size={22} className="text-gray-400 group-hover:text-white transition" />
                <span className="text-[11px] text-gray-400 group-hover:text-white transition">
                  Band
                </span>
              </button>
              <button
                onClick={uploadImage}
                className="flex flex-col items-center gap-2 py-4 rounded-xl border border-gray-700 hover:border-brand-500 hover:bg-gray-900 transition-all group"
              >
                <Upload size={22} className="text-gray-400 group-hover:text-white transition" />
                <span className="text-[11px] text-gray-400 group-hover:text-white transition">
                  Upload Image
                </span>
              </button>
            </div>
          </div>

          {/* TEMPLATE SETTINGS */}
          <div className="p-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Template Settings
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">
                  Template Size
                </label>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <div className="flex-1 bg-gray-800 rounded-lg px-2 py-1.5 text-center font-mono">
                    {PIN_W}
                  </div>
                  <span className="text-gray-600">×</span>
                  <div className="flex-1 bg-gray-800 rounded-lg px-2 py-1.5 text-center font-mono">
                    {PIN_H}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">
                  Background Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-gray-700 p-0.5 bg-transparent"
                  />
                  <span className="text-xs text-gray-400 font-mono">{bgColor}</span>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">Tags</label>
                <div className="bg-gray-800 rounded-lg px-2 py-2 text-[11px] text-gray-600 text-center">
                  No tags selected
                </div>
                <p className="text-[10px] text-gray-600 mt-1">
                  Click tags to add/remove them
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Canvas Area ────────────────────────────────────────────────── */}
        <main className="flex-1 bg-[#d9d9d9] flex flex-col overflow-hidden">
          {/* Zoom bar */}
          <div className="h-9 bg-white border-b border-gray-200 flex items-center justify-center gap-3 flex-shrink-0">
            <button
              onClick={() => setZoom((z) => Math.max(15, z - 5))}
              className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm"
            >
              −
            </button>
            <span className="text-xs text-gray-600 w-10 text-center">{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(150, z + 5))}
              className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm"
            >
              +
            </button>
          </div>

          <div className="flex-1 overflow-auto p-8">
            <div
              style={{
                width: PIN_W * zoomPct,
                height: PIN_H * zoomPct,
                margin: "0 auto",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  transform: `scale(${zoomPct})`,
                  transformOrigin: "top left",
                  width: PIN_W,
                  height: PIN_H,
                  boxShadow: "0 4px 40px rgba(0,0,0,0.25)",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                {mounted && <canvas ref={canvasRef} />}
              </div>
            </div>
          </div>
        </main>

        {/* ── Right Panel ─────────────────────────────────────────────────── */}
        <aside className="w-64 border-l border-gray-800 bg-gray-950 overflow-y-auto flex-shrink-0 p-4">
          {!selType && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center mb-3">
                <ImageIcon size={22} className="text-gray-600" />
              </div>
              <p className="text-sm font-medium text-gray-400">
                No Element Selected
              </p>
              <p className="text-[11px] text-gray-600 mt-1 leading-relaxed max-w-[160px]">
                Select an element to customize its properties
              </p>
            </div>
          )}

          {selType === "text" && (
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Text Properties
              </h4>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1">
                  Content
                </label>
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    applyText({ text: e.target.value });
                  }}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white resize-none focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">
                  Font Size
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={8}
                    max={200}
                    value={fontSize}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setFontSize(v);
                      applyText({ fontSize: v });
                    }}
                    className="flex-1 accent-brand-500"
                  />
                  <input
                    type="number"
                    min={8}
                    max={200}
                    value={fontSize}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setFontSize(v);
                      applyText({ fontSize: v });
                    }}
                    className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-xs text-white text-center focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">
                  Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={textColor}
                    onChange={(e) => {
                      setTextColor(e.target.value);
                      applyText({ fill: e.target.value });
                    }}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-gray-700 p-0.5 bg-transparent"
                  />
                  <span className="text-xs font-mono text-gray-400">
                    {textColor}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">
                  Font Family
                </label>
                <select
                  value={fontFamily}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFontFamily(next);
                    applyText({ fontFamily: next });
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
                  style={{ fontFamily: `"${fontFamily}", sans-serif` }}
                >
                  {allFonts.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: `"${f}", sans-serif` }}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1">
                  Add Google Font
                </label>
                <div className="flex gap-1.5">
                  <input
                    value={fontInput}
                    onChange={(e) => setFontInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") loadGoogleFont(fontInput);
                    }}
                    placeholder="e.g. Playfair Display"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
                  />
                  <button
                    onClick={() => loadGoogleFont(fontInput)}
                    disabled={fontLoading || !fontInput.trim()}
                    className="px-2 py-1.5 rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {fontLoading ? <Loader2 size={13} className="animate-spin" /> : "Add"}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">
                  Alignment
                </label>
                <div className="flex gap-1">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => {
                        setTextAlign(a);
                        applyText({ textAlign: a });
                      }}
                      className={`flex-1 py-1.5 rounded-lg transition ${
                        textAlign === a
                          ? "bg-brand-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                    >
                      {a === "left" ? (
                        <AlignLeft size={13} className="mx-auto" />
                      ) : a === "center" ? (
                        <AlignCenter size={13} className="mx-auto" />
                      ) : (
                        <AlignRight size={13} className="mx-auto" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">
                  Style
                </label>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      const w = fontWeight === "bold" ? "normal" : "bold";
                      setFontWeight(w);
                      applyText({ fontWeight: w });
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-bold transition ${
                      fontWeight === "bold"
                        ? "bg-brand-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    B
                  </button>
                  <button
                    onClick={() => {
                      const s = fontStyle === "italic" ? "normal" : "italic";
                      setFontStyle(s);
                      applyText({ fontStyle: s });
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-sm italic transition ${
                      fontStyle === "italic"
                        ? "bg-brand-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    I
                  </button>
                </div>
              </div>

              <button
                onClick={deleteSelected}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-950/50 border border-red-900/40 text-red-400 text-xs hover:bg-red-950 transition"
              >
                <Trash2 size={13} /> Delete Element
              </button>
            </div>
          )}

          {(selType === "band" || selType === "image") && (
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {selType === "band" ? "Color Band" : "Image Zone"}
              </h4>

              {selType === "image" && (
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  This zone will be filled with the recipe image when using this template in the Pin Designer.
                </p>
              )}

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">
                  {selType === "band" ? "Band Color" : "Placeholder Color"}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={elemColor}
                    onChange={(e) => applyColor(e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-gray-700 p-0.5 bg-transparent"
                  />
                  <span className="text-xs font-mono text-gray-400">
                    {elemColor}
                  </span>
                </div>
              </div>

              <button
                onClick={deleteSelected}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-950/50 border border-red-900/40 text-red-400 text-xs hover:bg-red-950 transition"
              >
                <Trash2 size={13} /> Delete Element
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function TemplateDesignerPage() {
  return (
    <Suspense>
      <TemplateDesignerInner />
    </Suspense>
  );
}
