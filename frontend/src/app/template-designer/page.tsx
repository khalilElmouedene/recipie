"use client";

import React, { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Download,
  Type,
  Globe,
  Image as ImageIcon,
  Minus,
  Trash2,
  Upload,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Loader2,
  X,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  Layers,
  Pencil,
  Check,
  FlipHorizontal2,
  FlipVertical2,
  Square,
  ZoomIn,
  ZoomOut,
  Lock,
  Unlock,
} from "lucide-react";
import { api } from "@/lib/api";
import { applyTextTransform } from "@/components/PinDesigner";

const SELECTION_ACCENT = "#2563eb";

let _uid = 0;
function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${++_uid}`;
}

type SelType = "text" | "image" | "band" | "asset" | "frame" | null;
type StrokeStyle = "solid" | "dashed" | "dotted";

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
  const searchParams = useSearchParams();
  const editingTemplateId = searchParams.get("templateId");

  const canvasW = Math.max(100, parseInt(searchParams.get("w") || "1000", 10));
  const canvasH = Math.max(100, parseInt(searchParams.get("h") || "1500", 10));

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
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
  const [textTransform, setTextTransform] = useState<"none" | "uppercase" | "lowercase" | "capitalize">("none");
  const [textVariable, setTextVariable] = useState<"" | "title" | "website">("");
  const [customFonts, setCustomFonts] = useState<string[]>([]);
  const [fontInput, setFontInput] = useState("");
  const [fontLoading, setFontLoading] = useState(false);

  // Band / image zone color
  const [elemColor, setElemColor] = useState("#4a90d9");
  const [isFlipZone, setIsFlipZone] = useState(false);

  // Frame props
  const [frameStrokeColor, setFrameStrokeColor] = useState("#333333");
  const [frameStrokeWidth, setFrameStrokeWidth] = useState(4);
  const [frameStrokeStyle, setFrameStrokeStyle] = useState<StrokeStyle>("solid");
  const [frameRadius, setFrameRadius] = useState(0);

  // Floating toolbar
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);

  // Layers panel
  const [layers, setLayers] = useState<{ id: string; type: string; label: string; visible: boolean; locked: boolean }[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");

  // Saving
  const [saving, setSaving] = useState(false);
  const [editingLoaded, setEditingLoaded] = useState(false);
  const undoHistoryRef = useRef<string[]>([]);
  const isRestoringRef = useRef(false);
  const transformSaveDoneRef = useRef(false);
  const UNDO_CUSTOM_KEYS = ["__id", "__ttype", "__strokeStyle", "__textVariable", "__textTransform", "__rawText", "__flipX", "__pinLocked"];
  const MAX_UNDO = 50;

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

  const saveUndoState = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || isRestoringRef.current) return;
    try {
      const json = JSON.stringify(canvas.toObject(UNDO_CUSTOM_KEYS));
      const history = undoHistoryRef.current;
      if (history.length > 0 && history[history.length - 1] === json) return;
      history.push(json);
      if (history.length > MAX_UNDO) history.shift();
    } catch {
      // ignore
    }
  }, []);

  const applySelectionVisuals = useCallback((obj: any) => {
    if (!obj) return;
    obj.set({
      hasControls: true,
      hasBorders: true,
      borderColor: SELECTION_ACCENT,
      cornerColor: SELECTION_ACCENT,
      cornerStrokeColor: "#ffffff",
      cornerStyle: "circle",
      transparentCorners: false,
      cornerSize: 22,
      borderScaleFactor: 3,
      padding: 12,
    });
  }, []);

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
          width: canvasW,
          height: canvasH,
          backgroundColor: "#ffffff",
          preserveObjectStacking: true,
          selectionColor: "rgba(37, 99, 235, 0.15)",
          selectionBorderColor: SELECTION_ACCENT,
          selectionLineWidth: 2,
        });
        fabricRef.current = canvas;

        canvas.on("selection:created", (e: any) => {
          const obj = e.selected?.[0];
          if (obj) {
            applySelectionVisuals(obj);
            syncSel(obj);
          }
        });
        canvas.on("selection:updated", (e: any) => {
          const obj = e.selected?.[0];
          if (obj) {
            applySelectionVisuals(obj);
            syncSel(obj);
          }
        });
        canvas.on("selection:cleared", () => {
          setSelType(null);
        });
        canvas.on("text:changed", (e: any) => {
          const t = e.target;
          if (t?.__ttype === "text") {
            // When typing directly on canvas, the typed text becomes the new raw text.
            // Store it and show it in the sidebar (without transform applied).
            t.__rawText = t.text ?? "";
            setText(t.text ?? "");
          }
        });
        canvas.on("object:moving", () => {
          if (!transformSaveDoneRef.current) {
            transformSaveDoneRef.current = true;
            saveUndoState();
          }
        });
        canvas.on("object:scaling", () => {
          if (!transformSaveDoneRef.current) {
            transformSaveDoneRef.current = true;
            saveUndoState();
          }
        });
        canvas.on("object:rotating", () => {
          if (!transformSaveDoneRef.current) {
            transformSaveDoneRef.current = true;
            saveUndoState();
          }
        });
        canvas.on("object:modified", () => {
          transformSaveDoneRef.current = false;
        });

        // Seed undo stack with initial empty canvas.
        saveUndoState();

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
  }, [mounted, saveUndoState, applySelectionVisuals]);

  // Sync bg color to canvas
  useEffect(() => {
    if (!canvasReady || !fabricRef.current) return;
    fabricRef.current.set("backgroundColor", bgColor);
    fabricRef.current.renderAll();
  }, [bgColor, canvasReady]);

  function syncSel(obj: any) {
    const rawType = obj?.__ttype;
    const t: SelType =
      rawType === "text" || rawType === "image" || rawType === "band" || rawType === "asset" || rawType === "frame"
        ? rawType
        : null;
    setSelType(t);
    if (t === "text") {
      setText((obj.__rawText as string) ?? obj.text ?? "");
      setFontSize(obj.fontSize ?? 48);
      setTextColor(typeof obj.fill === "string" ? obj.fill : "#333333");
      setTextAlign(obj.textAlign ?? "center");
      setFontWeight(obj.fontWeight ?? "normal");
      setFontStyle(obj.fontStyle ?? "normal");
      setFontFamily(obj.fontFamily ?? "Arial");
      setTextTransform((obj.__textTransform as "none" | "uppercase" | "lowercase" | "capitalize") ?? "none");
      setTextVariable((obj.__textVariable as "" | "title" | "website") ?? "");
    } else if (t === "band" || t === "image") {
      setElemColor(typeof obj.fill === "string" ? obj.fill : "#4a90d9");
      if (t === "image") setIsFlipZone(obj.__flipX === true);
    } else if (t === "frame") {
      setFrameStrokeColor(obj.stroke ?? "#333333");
      setFrameStrokeWidth(obj.strokeWidth ?? 4);
      setFrameStrokeStyle((obj.__strokeStyle as StrokeStyle) ?? "solid");
      setFrameRadius(obj.rx ?? 0);
    }
  }

  function getActive(): any | null {
    return fabricRef.current?.getActiveObject() ?? null;
  }

  const performUndo = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || isRestoringRef.current) return;
    const history = undoHistoryRef.current;
    if (history.length <= 1) return;
    history.pop();
    const previous = history[history.length - 1];
    if (!previous) return;

    isRestoringRef.current = true;
    try {
      await canvas.loadFromJSON(previous);
      canvas.renderAll();
      setSelType(null);
    } catch {
      // ignore
    } finally {
      isRestoringRef.current = false;
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;

      // Undo (Ctrl/Cmd+Z)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (isEditing) return;
        e.preventDefault();
        void performUndo();
        return;
      }

      const canvas = fabricRef.current;
      if (!canvas) return;

      // Duplicate (Ctrl/Cmd+D)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        if (isEditing) return;
        const obj = canvas.getActiveObject();
        if (!obj) return;
        e.preventDefault();
        obj.clone().then((cloned: any) => {
          cloned.__id = uid(cloned.__ttype || "obj");
          cloned.__label = (cloned.__label || getLayerLabel(cloned.__ttype)) + " copy";
          cloned.set({ left: (obj.left ?? 0) + 20, top: (obj.top ?? 0) + 20 });
          saveUndoState();
          canvas.add(cloned);
          canvas.setActiveObject(cloned);
          canvas.renderAll();
          syncLayers();
        });
        return;
      }

      // Delete (Delete or Backspace)
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isEditing) return;
        const obj = canvas.getActiveObject() as any;
        if (!obj) return;
        if (obj.__pinLocked) return;
        e.preventDefault();
        saveUndoState();
        canvas.remove(obj);
        canvas.discardActiveObject();
        canvas.renderAll();
        setSelType(null);
        syncLayers();
        return;
      }

      // Arrow keys — move selected object by 1px (10px with Shift)
      const arrowKeys: Record<string, [number, number]> = {
        ArrowLeft:  [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp:    [0, -1],
        ArrowDown:  [0, 1],
      };
      if (e.key in arrowKeys) {
        if (isEditing) return;
        const obj = canvas.getActiveObject() as any;
        if (!obj) return;
        e.preventDefault();
        const [dx, dy] = arrowKeys[e.key];
        const step = e.shiftKey ? 10 : 1;
        saveUndoState();
        obj.set({ left: (obj.left ?? 0) + dx * step, top: (obj.top ?? 0) + dy * step });
        obj.setCoords();
        canvas.renderAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performUndo]);

  const loadExistingTemplate = useCallback(async () => {
    if (!editingTemplateId || editingLoaded) return;
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;

    try {
      const all = await api.getPinDesignerTemplates();
      const tmpl = all.find((t) => t.id === editingTemplateId);
      if (!tmpl) return;

      setTemplateName(tmpl.name);
      setBgColor(tmpl.bgColor || "#ffffff");

      canvas.clear();
      canvas.set("backgroundColor", tmpl.bgColor || "#ffffff");

      for (const el of tmpl.elements || []) {
        if (el.type === "text") {
          const rawText = el.defaultText || "Text";
          const tt = (el as any).textTransform ?? "none";
          const tb = new fabric.Textbox(applyTextTransform(rawText, tt), {
            left: el.x ?? canvasW / 2,
            top: el.y ?? canvasH / 2,
            width: el.width || 800,
            fontSize: el.fontSize || 48,
            fontFamily: el.fontFamily || "Arial",
            fontWeight: el.fontWeight || "normal",
            fontStyle: el.fontStyle || "normal",
            fill: el.fill || "#333333",
            textAlign: (el.textAlign as any) || "center",
            originX: "center",
            originY: "center",
            editable: true,
          });
          (tb as any).__id = el.id || uid("text");
          (tb as any).__ttype = "text";
          (tb as any).__textVariable = (el as any).textVariable ?? "";
          (tb as any).__textTransform = tt;
          (tb as any).__rawText = rawText;
          (tb as any).__pinLocked = !!(el as any).locked;
          applyLockStateDesigner(tb);
          applySelectionVisuals(tb);
          canvas.add(tb);
        } else if (el.type === "image") {
          const isFlip = (el as any).flipX === true;
          const rect = new fabric.Rect({
            left: el.x ?? 100,
            top: el.y ?? 100,
            width: el.width || 400,
            height: el.height || 300,
            fill: isFlip ? "#b3d9ff" : (el.bgColor || "#e8e8e8"),
            stroke: isFlip ? "#4a90d9" : "#aaaaaa",
            strokeWidth: 3,
            strokeUniform: true,
            strokeDashArray: [10, 6],
            originX: "left",
            originY: "top",
          });
          (rect as any).__id = el.id || uid("image");
          (rect as any).__flipX = isFlip;
          (rect as any).__ttype = "image";
          (rect as any).__pinLocked = !!(el as any).locked;
          applyLockStateDesigner(rect);
          applySelectionVisuals(rect);
          canvas.add(rect);
        } else if (el.type === "band") {
          const rect = new fabric.Rect({
            left: el.x ?? 0,
            top: el.y ?? 0,
            width: el.width || canvasW,
            height: el.height || 120,
            fill: el.bgColor || "#4a90d9",
            originX: "left",
            originY: "top",
          });
          (rect as any).__id = el.id || uid("band");
          (rect as any).__ttype = "band";
          (rect as any).__pinLocked = !!(el as any).locked;
          applyLockStateDesigner(rect);
          applySelectionVisuals(rect);
          canvas.add(rect);
        } else if (el.type === "asset" && el.imageUrl) {
          try {
            // Manually load + decode the image so it's fully ready before Fabric renders it.
            // FabricImage.fromURL resolves before the browser finishes decoding pixel data,
            // which causes blank images on first render.
            const htmlImg = new Image();
            await new Promise<void>((resolve, reject) => {
              htmlImg.onload = () => resolve();
              htmlImg.onerror = () => reject(new Error("Image load error"));
              htmlImg.src = el.imageUrl!;
            });
            // decode() waits until the browser has fully decoded the image pixels
            if (typeof htmlImg.decode === "function") {
              await htmlImg.decode().catch(() => {});
            }
            const naturalW = htmlImg.naturalWidth || htmlImg.width || 1;
            const naturalH = htmlImg.naturalHeight || htmlImg.height || 1;
            const img = new fabric.FabricImage(htmlImg);
            img.set({
              left: el.x ?? 0,
              top: el.y ?? 0,
              originX: "left",
              originY: "top",
              scaleX: el.width / naturalW,
              scaleY: el.height / naturalH,
              flipX: el.flipX ?? false,
              flipY: el.flipY ?? false,
            });
            (img as any).__id = el.id || uid("img");
            (img as any).__ttype = "asset";
            (img as any).__pinLocked = !!(el as any).locked;
            applyLockStateDesigner(img);
            applySelectionVisuals(img);
            canvas.add(img);
          } catch { /* ignore broken image */ }
        } else if (el.type === "frame") {
          const strokeStyle = (el.strokeStyle as string) ?? "solid";
          let dashArray: number[] | null = null;
          if (strokeStyle === "dashed") dashArray = [20, 10];
          else if (strokeStyle === "dotted") dashArray = [4, 8];
          const rect = new fabric.Rect({
            left: el.x ?? 0,
            top: el.y ?? 0,
            width: el.width || 900,
            height: el.height || 1400,
            fill: "rgba(0,0,0,0)",
            stroke: el.fill ?? "#333333",
            strokeWidth: el.strokeWidth ?? 4,
            strokeUniform: true,
            strokeDashArray: dashArray,
            rx: el.radius ?? 0,
            ry: el.radius ?? 0,
            originX: "left",
            originY: "top",
          });
          (rect as any).__id = el.id || uid("frame");
          (rect as any).__ttype = "frame";
          (rect as any).__strokeStyle = strokeStyle;
          (rect as any).__pinLocked = !!(el as any).locked;
          applyLockStateDesigner(rect);
          applySelectionVisuals(rect);
          canvas.add(rect);
        }
      }

      canvas.renderAll();
      // Schedule a second render on next frame in case any image decode finishes late
      requestAnimationFrame(() => { fabricRef.current?.renderAll(); });
      undoHistoryRef.current = [];
      saveUndoState();
      setEditingLoaded(true);
    } catch {
      // ignore
    }
  }, [editingTemplateId, editingLoaded, saveUndoState, applySelectionVisuals]);

  useEffect(() => {
    if (!canvasReady) return;
    void loadExistingTemplate();
  }, [canvasReady, loadExistingTemplate]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !canvasReady) return;
    const sync = () => syncLayers();
    const onSelected = (e: any) => { syncLayers(); recalcToolbarPos(e.selected?.[0]); };
    const onModified = (e: any) => { syncLayers(); recalcToolbarPos(e.target); };
    const onCleared  = () => { syncLayers(); setToolbarPos(null); };
    canvas.on("object:added", sync);
    canvas.on("object:removed", sync);
    canvas.on("object:modified", onModified);
    canvas.on("object:moving",   onModified);
    canvas.on("object:scaling",  onModified);
    canvas.on("selection:created", onSelected);
    canvas.on("selection:updated", onSelected);
    canvas.on("selection:cleared", onCleared);
    return () => {
      canvas.off("object:added", sync);
      canvas.off("object:removed", sync);
      canvas.off("object:modified", onModified);
      canvas.off("object:moving",   onModified);
      canvas.off("object:scaling",  onModified);
      canvas.off("selection:created", onSelected);
      canvas.off("selection:updated", onSelected);
      canvas.off("selection:cleared", onCleared);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasReady]);

  // ── Add elements ───────────────────────────────────────────────────────────
  function addText() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    saveUndoState();
    const tb = new fabric.Textbox("Text", {
      left: canvasW / 2,
      top: canvasH / 2 - 50,
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
    (tb as any).__textVariable = "";
    (tb as any).__textTransform = "none";
    (tb as any).__rawText = "Text";
    applySelectionVisuals(tb);
    canvas.add(tb);
    canvas.setActiveObject(tb);
    canvas.renderAll();
  }

  function addImageZone() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    saveUndoState();
    const rect = new fabric.Rect({
      left: canvasW / 2,
      top: canvasH / 3,
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
    applySelectionVisuals(rect);
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  }

  function addFlipImageZone() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    saveUndoState();
    const rect = new fabric.Rect({
      left: canvasW / 2,
      top: canvasH / 3,
      width: 800,
      height: 600,
      fill: "#b3d9ff",
      stroke: "#4a90d9",
      strokeWidth: 3,
      strokeUniform: true,
      strokeDashArray: [10, 6],
      originX: "center",
      originY: "center",
    });
    (rect as any).__id = uid("image");
    (rect as any).__ttype = "image";
    (rect as any).__flipX = true;
    applySelectionVisuals(rect);
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  }

  function addBand() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    saveUndoState();
    const rect = new fabric.Rect({
      left: 0,
      top: canvasH / 2 - 100,
      width: canvasW,
      height: 200,
      fill: "#4a90d9",
    });
    (rect as any).__id = uid("band");
    (rect as any).__ttype = "band";
    applySelectionVisuals(rect);
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  }

  function addFrame() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    saveUndoState();
    const padding = 40;
    const rect = new fabric.Rect({
      left: padding,
      top: padding,
      width: canvasW - padding * 2,
      height: canvasH - padding * 2,
      fill: "rgba(0,0,0,0)",
      stroke: "#333333",
      strokeWidth: 4,
      strokeUniform: true,
      rx: 0,
      ry: 0,
      originX: "left",
      originY: "top",
    });
    (rect as any).__id = uid("frame");
    (rect as any).__ttype = "frame";
    (rect as any).__strokeStyle = "solid";
    applySelectionVisuals(rect);
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
    syncSel(rect);
  }

  function applyFrameProperty(property: string, value: any) {
    const obj = getActive();
    if (!obj || obj.__ttype !== "frame") return;
    saveUndoState();
    if (property === "strokeColor") {
      obj.set("stroke", value);
      setFrameStrokeColor(value);
    } else if (property === "strokeWidth") {
      obj.set("strokeWidth", parseInt(value));
      setFrameStrokeWidth(parseInt(value));
    } else if (property === "strokeStyle") {
      obj.__strokeStyle = value;
      if (value === "dashed") {
        obj.set("strokeDashArray", [20, 10]);
      } else if (value === "dotted") {
        obj.set("strokeDashArray", [4, 8]);
      } else {
        obj.set("strokeDashArray", null);
      }
      setFrameStrokeStyle(value as StrokeStyle);
    } else if (property === "radius") {
      const r = parseInt(value);
      obj.set({ rx: r, ry: r });
      setFrameRadius(r);
    }
    fabricRef.current?.renderAll();
  }

  function addWebsiteLink() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    saveUndoState();
    const tb = new fabric.Textbox("WWW.YOURSITE.COM", {
      left: canvasW / 2,
      top: canvasH - 60,
      width: 900,
      fontSize: 26,
      fontFamily,
      fontWeight: "bold",
      fill: "#ffffff",
      textAlign: "center",
      originX: "center",
      originY: "center",
      editable: true,
    });
    (tb as any).__id = uid("website");
    (tb as any).__ttype = "text";
    (tb as any).__textVariable = "website";
    (tb as any).__textTransform = "none";
    (tb as any).__rawText = "WWW.YOURSITE.COM";
    applySelectionVisuals(tb);
    canvas.add(tb);
    canvas.setActiveObject(tb);
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
      saveUndoState();
      const img = await fabric.FabricImage.fromURL(dataUrl, {
        crossOrigin: "anonymous",
      });
      const scale = Math.max(
        canvasW / (img.width || 1),
        canvasH / (img.height || 1)
      );
      img.set({
        left: canvasW / 2,
        top: canvasH / 2,
        originX: "center",
        originY: "center",
        scaleX: scale,
        scaleY: scale,
        selectable: true,
      });
      (img as any).__id = uid("bg");
      (img as any).__ttype = "asset";
      applySelectionVisuals(img);
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
      saveUndoState();
      const img = await fabric.FabricImage.fromURL(dataUrl, {
        crossOrigin: "anonymous",
      });
      const scale = Math.min(
        600 / (img.width || 1),
        600 / (img.height || 1)
      );
      img.set({
        left: canvasW / 2,
        top: canvasH / 2,
        originX: "center",
        originY: "center",
        scaleX: scale,
        scaleY: scale,
      });
      (img as any).__id = uid("img");
      (img as any).__ttype = "asset";
      applySelectionVisuals(img);
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

  // ── Floating toolbar position ─────────────────────────────────────────────
  function recalcToolbarPos(obj?: any) {
    const wrapper = canvasWrapperRef.current;
    const canvas = fabricRef.current;
    if (!wrapper || !canvas) { setToolbarPos(null); return; }
    const target = obj ?? canvas.getActiveObject();
    if (!target) { setToolbarPos(null); return; }
    const bound = target.getBoundingRect(true, true);
    const wRect = wrapper.getBoundingClientRect();
    const zf = zoom / 100;
    setToolbarPos({
      x: wRect.left + (bound.left + bound.width / 2) * zf,
      y: wRect.top + bound.top * zf,
    });
  }

  function sendToBack() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj) return;
    saveUndoState();
    canvas.sendObjectToBack(obj);
    canvas.requestRenderAll();
    syncLayers();
  }

  function bringToFront() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj) return;
    saveUndoState();
    canvas.bringObjectToFront(obj);
    canvas.requestRenderAll();
    syncLayers();
  }

  function flipHorizontal() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj) return;
    saveUndoState();
    obj.set({ flipX: !obj.flipX });
    canvas.requestRenderAll();
  }

  function flipVertical() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj) return;
    saveUndoState();
    obj.set({ flipY: !obj.flipY });
    canvas.requestRenderAll();
  }

  function zoomAsset(direction: "in" | "out") {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject() as any;
    if (!canvas || !obj || obj.__ttype !== "asset") return;
    saveUndoState();
    const factor = direction === "in" ? 1.1 : 1 / 1.1;
    obj.set({ scaleX: (obj.scaleX ?? 1) * factor, scaleY: (obj.scaleY ?? 1) * factor });
    obj.setCoords?.();
    canvas.requestRenderAll();
  }

  function toggleFlipZone() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject() as any;
    if (!canvas || !obj || obj.__ttype !== "image") return;
    saveUndoState();
    const nowFlip = !(obj.__flipX === true);
    obj.__flipX = nowFlip;
    obj.set({
      fill: nowFlip ? "#b3d9ff" : "#e8e8e8",
      stroke: nowFlip ? "#4a90d9" : "#aaaaaa",
    });
    canvas.requestRenderAll();
    syncLayers();
  }

  // ── Layers ────────────────────────────────────────────────────────────────
  function getLayerLabel(type: string): string {
    switch (type) {
      case "text": return "Text";
      case "image": return "Image Zone";
      case "band": return "Band";
      case "asset": return "Image";
      default: return "Element";
    }
  }

  function applyLockStateDesigner(obj: any) {
    const locked = !!obj.__pinLocked;
    obj.set({
      lockMovementX: locked, lockMovementY: locked,
      lockRotation: locked, lockScalingX: locked, lockScalingY: locked,
      hasControls: !locked,
    });
  }

  function toggleLockDesigner(id: string) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = (canvas.getObjects() as any[]).find(o => o.__id === id);
    if (!obj) return;
    obj.__pinLocked = !obj.__pinLocked;
    applyLockStateDesigner(obj);
    canvas.renderAll();
    syncLayers();
    saveUndoState();
  }

  function syncLayers() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objs = (canvas.getObjects() as any[]).filter(o => o.__id && o.__ttype);
    // Reversed: top object first (Canva style)
    setLayers([...objs].reverse().map(o => ({
      id: o.__id as string,
      type: o.__ttype as string,
      label: (o.__label as string) || getLayerLabel(o.__ttype),
      visible: o.visible !== false,
      locked: !!o.__pinLocked,
    })));
    const active = canvas.getActiveObject() as any;
    setSelectedLayerId(active?.__id ?? null);
  }

  function selectLayer(id: string) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = (canvas.getObjects() as any[]).find(o => o.__id === id);
    if (!obj) return;
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    syncLayers();
  }

  function moveLayerUp(id: string) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = (canvas.getObjects() as any[]).find(o => o.__id === id);
    if (!obj) return;
    saveUndoState();
    canvas.bringObjectForward(obj);
    canvas.requestRenderAll();
    syncLayers();
  }

  function moveLayerDown(id: string) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = (canvas.getObjects() as any[]).find(o => o.__id === id);
    if (!obj) return;
    saveUndoState();
    canvas.sendObjectBackwards(obj);
    canvas.requestRenderAll();
    syncLayers();
  }

  function toggleLayerVisibility(id: string) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = (canvas.getObjects() as any[]).find(o => o.__id === id);
    if (!obj) return;
    obj.visible = obj.visible === false ? true : false;
    canvas.requestRenderAll();
    syncLayers();
  }

  function deleteLayerById(id: string) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = (canvas.getObjects() as any[]).find(o => o.__id === id);
    if (!obj) return;
    saveUndoState();
    canvas.remove(obj);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    setSelType(null);
    syncLayers();
  }

  function commitRenameLayer(id: string, newLabel: string) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = (canvas.getObjects() as any[]).find(o => o.__id === id);
    if (obj) obj.__label = newLabel.trim() || getLayerLabel(obj.__ttype);
    setEditingLayerId(null);
    syncLayers();
  }

  function deleteSelected() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    saveUndoState();
    canvas.remove(obj);
    canvas.discardActiveObject();
    canvas.renderAll();
    setSelType(null);
  }

  // ── Apply property changes ─────────────────────────────────────────────────
  function applyText(patch: Record<string, unknown>) {
    const obj = getActive();
    if (!obj || obj.__ttype !== "text") return;
    saveUndoState();
    // If updating text content, store raw and apply current transform
    if ("text" in patch) {
      const raw = patch.text as string;
      obj.__rawText = raw;
      const tt = (obj.__textTransform as string) ?? "none";
      patch = { ...patch, text: applyTextTransform(raw, tt) };
    }
    // If updating textTransform, re-derive displayed text from raw
    if ("textTransform" in patch) {
      const raw = (obj.__rawText as string) ?? (obj.text as string) ?? "";
      obj.__rawText = raw;
      obj.__textTransform = patch.textTransform;
      patch = { ...patch, text: applyTextTransform(raw, patch.textTransform as string) };
    }
    obj.set(patch);
    fabricRef.current?.renderAll();
  }

  function applyColor(color: string) {
    const obj = getActive();
    if (!obj) return;
    saveUndoState();
    obj.set("fill", color);
    fabricRef.current?.renderAll();
    setElemColor(color);
  }

  function applyBackgroundColor(color: string) {
    const canvas = fabricRef.current;
    if (canvas && canvas.backgroundColor !== color) {
      saveUndoState();
    }
    setBgColor(color);
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
          defaultText: (o.__rawText as string) ?? o.text ?? "",
          textVariable: (o.__textVariable as string) ?? "",
          textTransform: (o.__textTransform as string) ?? "none",
          fontSize: o.fontSize ?? 48,
          fontWeight: o.fontWeight ?? "normal",
          fontStyle: o.fontStyle ?? "normal",
          fontFamily: o.fontFamily ?? "Arial",
          fill: typeof o.fill === "string" ? o.fill : "#333333",
          textAlign: o.textAlign ?? "center",
          locked: !!o.__pinLocked,
        });
      } else if (type === "image") {
        if (o.type !== "rect") continue;
        results.push({
          id: o.__id,
          type: "image",
          label: o.__flipX ? "Flip Image Zone" : "Image Zone",
          x,
          y,
          width: w,
          height: h,
          bgColor: typeof o.fill === "string" ? o.fill : "#e8e8e8",
          flipX: o.__flipX === true,
          locked: !!o.__pinLocked,
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
          locked: !!o.__pinLocked,
        });
      } else if (type === "asset") {
        // Actual uploaded image — persist its src so it can be restored on reload
        const src = typeof o.getSrc === "function" ? o.getSrc() : null;
        if (!src) continue;
        results.push({
          id: o.__id,
          type: "asset",
          label: "Image",
          x,
          y,
          width: w || o.width || 200,
          height: h || o.height || 200,
          imageUrl: src,
          flipX: o.flipX ?? false,
          flipY: o.flipY ?? false,
          locked: !!o.__pinLocked,
        });
      } else if (type === "frame") {
        results.push({
          id: o.__id,
          type: "frame",
          label: "Frame",
          x,
          y,
          width: w || o.width || 900,
          height: h || o.height || 1400,
          strokeWidth: o.strokeWidth ?? 4,
          strokeStyle: (o.__strokeStyle as string) ?? "solid",
          fill: typeof o.stroke === "string" ? o.stroke : "#333333",
          radius: o.rx ?? 0,
          locked: !!o.__pinLocked,
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
      const payload = {
        name: templateName.trim() || "My Template",
        description: null,
        bgColor,
        canvasWidth: canvasW,
        canvasHeight: canvasH,
        elements: elements as any,
      };
      if (editingTemplateId) {
        await api.updatePinDesignerTemplate(editingTemplateId, payload);
        alert(`Template "${templateName.trim() || "My Template"}" updated.`);
      } else {
        await api.createPinDesignerTemplate(payload);
        alert(`Template "${templateName.trim() || "My Template"}" saved! You can now use it in the Pin Designer.`);
      }
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
            <Save size={14} /> {saving ? "Saving…" : (editingTemplateId ? "Update" : "Save")}
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
                onClick={addFlipImageZone}
                className="flex flex-col items-center gap-2 py-4 rounded-xl border border-blue-800 hover:border-blue-400 hover:bg-gray-900 transition-all group"
              >
                <div className="relative">
                  <ImageIcon size={22} className="text-blue-400 group-hover:text-blue-300 transition" />
                  <FlipHorizontal2 size={12} className="absolute -bottom-1 -right-1 text-blue-400 group-hover:text-blue-300 transition" />
                </div>
                <span className="text-[11px] text-blue-400 group-hover:text-blue-300 transition">
                  Flip Image
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
                onClick={addFrame}
                className="flex flex-col items-center gap-2 py-4 rounded-xl border border-gray-700 hover:border-brand-500 hover:bg-gray-900 transition-all group"
              >
                <Square size={22} className="text-gray-400 group-hover:text-white transition" />
                <span className="text-[11px] text-gray-400 group-hover:text-white transition">
                  Frame
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
              <button
                onClick={addWebsiteLink}
                className="col-span-2 flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-700 hover:border-brand-500 hover:bg-gray-900 transition-all group"
              >
                <Globe size={18} className="text-gray-400 group-hover:text-white transition" />
                <span className="text-[11px] text-gray-400 group-hover:text-white transition">
                  Add Website Link
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
                    {canvasW}
                  </div>
                  <span className="text-gray-600">×</span>
                  <div className="flex-1 bg-gray-800 rounded-lg px-2 py-1.5 text-center font-mono">
                    {canvasH}
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
                    onChange={(e) => applyBackgroundColor(e.target.value)}
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
                width: canvasW * zoomPct,
                height: canvasH * zoomPct,
                margin: "0 auto",
                flexShrink: 0,
              }}
            >
              <div
                ref={canvasWrapperRef}
                style={{
                  transform: `scale(${zoomPct})`,
                  transformOrigin: "top left",
                  width: canvasW,
                  height: canvasH,
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

        {/* ── Floating Toolbar ────────────────────────────────────────────── */}
        {toolbarPos && selType && (
          <div
            style={{
              position: "fixed",
              left: toolbarPos.x,
              top: toolbarPos.y - 48,
              transform: "translateX(-50%)",
              zIndex: 200,
              pointerEvents: "auto",
            }}
            className="flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button onClick={sendToBack}   title="Send to back"   className="p-1 rounded hover:bg-gray-700 text-gray-300"><ChevronsDown size={14} /></button>
            <button onClick={() => moveLayerDown(selectedLayerId!)} title="Move down" disabled={!selectedLayerId} className="p-1 rounded hover:bg-gray-700 text-gray-300 disabled:opacity-30"><ChevronDown size={14} /></button>
            <button onClick={() => moveLayerUp(selectedLayerId!)}   title="Move up"   disabled={!selectedLayerId} className="p-1 rounded hover:bg-gray-700 text-gray-300 disabled:opacity-30"><ChevronUp   size={14} /></button>
            <button onClick={bringToFront} title="Bring to front"  className="p-1 rounded hover:bg-gray-700 text-gray-300"><ChevronsUp   size={14} /></button>

            {selType === "image" && (
              <>
                <div className="w-px h-4 bg-gray-700 mx-0.5" />
                <button
                  onClick={toggleFlipZone}
                  title={isFlipZone ? "Remove flip (make normal Image Zone)" : "Enable flip (mirror recipe image)"}
                  className={`p-1 rounded transition ${isFlipZone ? "bg-blue-700 text-white hover:bg-blue-600" : "hover:bg-gray-700 text-gray-400"}`}
                >
                  <FlipHorizontal2 size={14} />
                </button>
              </>
            )}

            {selType === "asset" && (
              <>
                <div className="w-px h-4 bg-gray-700 mx-0.5" />
                <button onClick={() => zoomAsset("in")}  title="Zoom in"  className="p-1 rounded hover:bg-gray-700 text-gray-300"><ZoomIn  size={14} /></button>
                <button onClick={() => zoomAsset("out")} title="Zoom out" className="p-1 rounded hover:bg-gray-700 text-gray-300"><ZoomOut size={14} /></button>
                <div className="w-px h-4 bg-gray-700 mx-0.5" />
                <button onClick={flipHorizontal} title="Flip horizontal" className="p-1 rounded hover:bg-gray-700 text-gray-300"><FlipHorizontal2 size={14} /></button>
                <button onClick={flipVertical}   title="Flip vertical"   className="p-1 rounded hover:bg-gray-700 text-gray-300"><FlipVertical2   size={14} /></button>
              </>
            )}

            <div className="w-px h-4 bg-gray-700 mx-0.5" />

            <button
              onClick={deleteSelected}
              title="Delete"
              className="p-1 rounded hover:bg-red-900/60 text-gray-400 hover:text-red-400"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}

        {/* ── Right Panel ─────────────────────────────────────────────────── */}
        <aside className="w-64 border-l border-gray-800 bg-gray-950 flex flex-col flex-shrink-0 overflow-hidden">
          {/* scrollable properties area */}
          <div className="flex-1 overflow-y-auto p-4">
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
                <label className="text-[10px] text-gray-500 block mb-1">
                  Bind to (Pin Designer)
                </label>
                <select
                  value={textVariable}
                  onChange={(e) => {
                    const v = e.target.value as "" | "title" | "website";
                    setTextVariable(v);
                    const obj = getActive();
                    if (obj && obj.__ttype === "text") {
                      obj.__textVariable = v;
                      saveUndoState();
                    }
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
                >
                  <option value="">— None (static text) —</option>
                  <option value="title">Recipe Title</option>
                  <option value="website">Website URL</option>
                </select>
                {textVariable !== "" && (
                  <p className="text-[10px] text-brand-400 mt-1">
                    {textVariable === "title"
                      ? "Will show the recipe title when used in Pin Designer."
                      : "Will show the site domain when used in Pin Designer."}
                  </p>
                )}
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

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">Case</label>
                <div className="flex gap-1">
                  {([["uppercase", "AA", "UPPERCASE"], ["capitalize", "Aa", "Title Case"], ["lowercase", "aa", "lowercase"], ["none", "a", "Normal"]] as const).map(([val, label, title]) => (
                    <button
                      key={val}
                      title={title}
                      onClick={() => {
                        setTextTransform(val);
                        applyText({ textTransform: val });
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-mono transition ${
                        textTransform === val
                          ? "bg-brand-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
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

          {selType === "asset" && (
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Image</h4>
              <p className="text-[11px] text-gray-500 leading-relaxed">Uploaded image. Use the flip buttons in the toolbar above to mirror it.</p>
              <div className="flex gap-2">
                <button onClick={flipHorizontal} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:bg-gray-700 transition">
                  <FlipHorizontal2 size={13} /> Flip H
                </button>
                <button onClick={flipVertical} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:bg-gray-700 transition">
                  <FlipVertical2 size={13} /> Flip V
                </button>
              </div>
              <button onClick={deleteSelected} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-950/50 border border-red-900/40 text-red-400 text-xs hover:bg-red-950 transition">
                <Trash2 size={13} /> Delete Image
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

          {selType === "frame" && (
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Frame</h4>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">Border Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={frameStrokeColor}
                    onChange={(e) => applyFrameProperty("strokeColor", e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-gray-700 p-0.5 bg-transparent"
                  />
                  <span className="text-xs font-mono text-gray-400">{frameStrokeColor}</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Border Style</label>
                <div className="flex gap-1">
                  {(["solid", "dashed", "dotted"] as const).map((style) => (
                    <button
                      key={style}
                      onClick={() => applyFrameProperty("strokeStyle", style)}
                      className={`flex-1 py-2 rounded text-xs font-medium transition flex flex-col items-center gap-1 ${frameStrokeStyle === style ? "bg-brand-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                    >
                      <div className="w-7 h-0 border-t-2" style={{ borderStyle: style, borderColor: frameStrokeStyle === style ? "white" : "#9ca3af" }} />
                      <span className="capitalize">{style}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Border Width</label>
                <div className="flex gap-2 items-center">
                  <input type="range" min="1" max="20" value={frameStrokeWidth} onChange={(e) => applyFrameProperty("strokeWidth", e.target.value)} className="flex-1" />
                  <span className="text-sm text-gray-300 w-8">{frameStrokeWidth}px</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Corner Radius</label>
                <div className="flex gap-2 items-center">
                  <input type="range" min="0" max="200" value={frameRadius} onChange={(e) => applyFrameProperty("radius", e.target.value)} className="flex-1" />
                  <span className="text-sm text-gray-300 w-8">{frameRadius}px</span>
                </div>
              </div>

              <button
                onClick={deleteSelected}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-950/50 border border-red-900/40 text-red-400 text-xs hover:bg-red-950 transition"
              >
                <Trash2 size={13} /> Delete Frame
              </button>
            </div>
          )}
          </div>{/* end scrollable properties */}

          {/* ── Layers Panel ──────────────────────────────────────────────── */}
          <div className="border-t border-gray-800 flex flex-col flex-shrink-0" style={{ maxHeight: "45%" }}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 flex-shrink-0">
              <Layers size={13} className="text-gray-500" />
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest flex-1">
                Layers
              </span>
              <span className="text-[10px] text-gray-600">{layers.length}</span>
            </div>

            {layers.length === 0 && (
              <div className="flex-1 flex items-center justify-center py-6">
                <p className="text-[11px] text-gray-600 text-center px-3">No layers yet.<br />Add an element to get started.</p>
              </div>
            )}

            <div className="overflow-y-auto flex-1">
              {layers.map((layer, i) => {
                const isSelected = layer.id === selectedLayerId;
                const isEditing = editingLayerId === layer.id;
                const isTop = i === 0;
                const isBottom = i === layers.length - 1;

                return (
                  <div
                    key={layer.id}
                    onClick={() => selectLayer(layer.id)}
                    className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition select-none ${
                      isSelected ? "bg-brand-500/15 border-l-2 border-brand-500" : "hover:bg-gray-800/60 border-l-2 border-transparent"
                    } ${layer.locked ? "opacity-60" : ""}`}
                  >
                    {/* Type icon */}
                    <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-gray-500">
                      {layer.type === "text" ? <Type size={11} /> :
                       layer.type === "band" ? <Minus size={11} /> :
                       layer.type === "frame" ? <Square size={11} /> :
                       <ImageIcon size={11} />}
                    </div>

                    {/* Label */}
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editingLabelValue}
                          onChange={(e) => setEditingLabelValue(e.target.value)}
                          onBlur={() => commitRenameLayer(layer.id, editingLabelValue)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRenameLayer(layer.id, editingLabelValue);
                            if (e.key === "Escape") setEditingLayerId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-gray-800 border border-brand-500 rounded px-1 py-0.5 text-[11px] text-white focus:outline-none"
                        />
                      ) : (
                        <span
                          className={`block truncate text-[11px] ${isSelected ? "text-white" : "text-gray-400"}`}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingLayerId(layer.id);
                            setEditingLabelValue(layer.label);
                          }}
                          title="Double-click to rename"
                        >
                          {layer.label}
                        </span>
                      )}
                    </div>

                    {/* Action buttons — visible on hover or when selected */}
                    <div className={`flex items-center gap-0.5 flex-shrink-0 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
                      {/* Lock */}
                      <button
                        title={layer.locked ? "Unlock layer" : "Lock layer"}
                        onClick={(e) => { e.stopPropagation(); toggleLockDesigner(layer.id); }}
                        className={`w-5 h-5 flex items-center justify-center rounded transition ${layer.locked ? "text-amber-400 hover:text-amber-300 !opacity-100" : "text-gray-500 hover:text-white"}`}
                      >
                        {layer.locked ? <Lock size={9} /> : <Unlock size={9} />}
                      </button>
                      {/* Rename */}
                      <button
                        title="Rename"
                        onClick={(e) => { e.stopPropagation(); setEditingLayerId(layer.id); setEditingLabelValue(layer.label); }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-700 text-gray-500 hover:text-white transition"
                      >
                        <Pencil size={9} />
                      </button>
                      {/* Visibility */}
                      <button
                        title={layer.visible ? "Hide" : "Show"}
                        onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-700 text-gray-500 hover:text-white transition"
                      >
                        {layer.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                      </button>
                      {/* Move up */}
                      <button
                        title="Move up"
                        disabled={isTop}
                        onClick={(e) => { e.stopPropagation(); moveLayerUp(layer.id); }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-700 text-gray-500 hover:text-white transition disabled:opacity-20 disabled:pointer-events-none"
                      >
                        <ChevronUp size={11} />
                      </button>
                      {/* Move down */}
                      <button
                        title="Move down"
                        disabled={isBottom}
                        onClick={(e) => { e.stopPropagation(); moveLayerDown(layer.id); }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-700 text-gray-500 hover:text-white transition disabled:opacity-20 disabled:pointer-events-none"
                      >
                        <ChevronDown size={11} />
                      </button>
                      {/* Delete */}
                      <button
                        title="Delete layer"
                        disabled={layer.locked}
                        onClick={(e) => { e.stopPropagation(); deleteLayerById(layer.id); }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-900/60 text-gray-500 hover:text-red-400 transition disabled:opacity-20 disabled:pointer-events-none"
                      >
                        <Trash2 size={9} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
