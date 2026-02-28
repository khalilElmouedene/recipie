"use client";

import { useEffect, useRef, useState } from "react";
import { X, Download, ZoomIn, ZoomOut, Layers, LayoutTemplate, Grid3X3, Type, Upload, Image as ImageIcon, Minus, Trash2, Square } from "lucide-react";

const PIN_W = 1000;
const PIN_H = 1500;

interface TemplateElement {
  id: string;
  type: "image" | "text" | "band" | "frame";
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
  textAlign?: string;
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
}

interface PinTemplate {
  id: string;
  name: string;
  description: string;
  previewLayout: "simple" | "grid4" | "grid6" | "hero" | "sandwich" | "band-white" | "band-blue" | "band-peach";
  bgColor: string;
  elements: TemplateElement[];
}

const TEMPLATES: PinTemplate[] = [
  {
    id: "peach-band",
    name: "Peach Band Style",
    description: "Image, peach text band, image, footer",
    previewLayout: "band-peach",
    bgColor: "#ffffff",
    elements: [
      { id: "image1", type: "image", label: "Top Image", x: 0, y: 0, width: 1000, height: 550, bgColor: "#e8e8e8" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 550, width: 1000, height: 120, bgColor: "#ffecd2" },
      { id: "title", type: "text", label: "Title", x: 500, y: 610, width: 940, height: 80, defaultText: "Easy Strawberry Cheesecake Recipe | Simple Dessert", fontSize: 36, fontWeight: "bold", fill: "#333333", textAlign: "center" },
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 670, width: 1000, height: 550, bgColor: "#e8e8e8" },
      { id: "footerBand", type: "band", label: "Footer Band", x: 0, y: 1220, width: 1000, height: 80, bgColor: "#ffd4d4" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1260, width: 940, height: 40, defaultText: "WWW.YOURSITE.COM", fontSize: 28, fontWeight: "bold", fill: "#333333", textAlign: "center" },
    ],
  },
  {
    id: "white-band",
    name: "White Band Style",
    description: "Image, white band with colored text, image",
    previewLayout: "band-white",
    bgColor: "#ffffff",
    elements: [
      { id: "image1", type: "image", label: "Top Image", x: 0, y: 0, width: 1000, height: 580, bgColor: "#e8e8e8" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 580, width: 1000, height: 140, bgColor: "#ffffff" },
      { id: "title", type: "text", label: "Title", x: 500, y: 650, width: 940, height: 90, defaultText: "9 BEST SALAD RECIPES", fontSize: 56, fontWeight: "bold", fill: "#e65100", textAlign: "center" },
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 720, width: 1000, height: 580, bgColor: "#e8e8e8" },
    ],
  },
  {
    id: "blue-band",
    name: "Blue Band Style",
    description: "Image, blue band with multi-line text, image",
    previewLayout: "band-blue",
    bgColor: "#ffffff",
    elements: [
      { id: "image1", type: "image", label: "Top Image", x: 0, y: 0, width: 1000, height: 520, bgColor: "#e8e8e8" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 520, width: 1000, height: 200, bgColor: "#1565c0" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 560, width: 940, height: 30, defaultText: "SIMPLE AND EASY", fontSize: 22, fontWeight: "normal", fill: "#ffffff", textAlign: "center" },
      { id: "title", type: "text", label: "Title", x: 500, y: 620, width: 940, height: 70, defaultText: "Delicious Recipe Title", fontSize: 44, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
      { id: "website", type: "text", label: "Website", x: 500, y: 690, width: 940, height: 30, defaultText: "WWW.YOURSITE.COM", fontSize: 20, fontWeight: "normal", fill: "#ffffff", textAlign: "center" },
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 720, width: 1000, height: 520, bgColor: "#e8e8e8" },
    ],
  },
  {
    id: "images-text-images",
    name: "4 Images + Text",
    description: "2 images top, text center, 2 images bottom",
    previewLayout: "sandwich",
    bgColor: "#ffffff",
    elements: [
      { id: "image1", type: "image", label: "Top Left", x: 0, y: 0, width: 500, height: 400, bgColor: "#e8e8e8" },
      { id: "image2", type: "image", label: "Top Right", x: 500, y: 0, width: 500, height: 400, bgColor: "#e8e8e8" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 400, width: 1000, height: 180, bgColor: "#ffffff" },
      { id: "title", type: "text", label: "Title", x: 500, y: 460, width: 940, height: 70, defaultText: "THE BEST RECIPES", fontSize: 52, fontWeight: "bold", fill: "#e63946", textAlign: "center" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 530, width: 940, height: 40, defaultText: "Comfort Food Collection", fontSize: 28, fill: "#666666", textAlign: "center" },
      { id: "image3", type: "image", label: "Bottom Left", x: 0, y: 580, width: 500, height: 400, bgColor: "#e8e8e8" },
      { id: "image4", type: "image", label: "Bottom Right", x: 500, y: 580, width: 500, height: 400, bgColor: "#e8e8e8" },
      { id: "footerBand", type: "band", label: "Footer", x: 0, y: 980, width: 1000, height: 60, bgColor: "#e63946" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1010, width: 940, height: 30, defaultText: "WWW.YOURSITE.COM", fontSize: 24, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
    ],
  },
  {
    id: "top-4-grid",
    name: "Top 4 Grid",
    description: "4 images in 2x2 grid with title",
    previewLayout: "grid4",
    bgColor: "#ffffff",
    elements: [
      { id: "image1", type: "image", label: "Image 1", x: 0, y: 0, width: 500, height: 450, bgColor: "#e8e8e8" },
      { id: "image2", type: "image", label: "Image 2", x: 500, y: 0, width: 500, height: 450, bgColor: "#e8e8e8" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 450, width: 1000, height: 150, bgColor: "#ffffff" },
      { id: "title", type: "text", label: "Title", x: 500, y: 500, width: 940, height: 70, defaultText: "THE BEST 4", fontSize: 56, fontWeight: "bold", fill: "#e63946", textAlign: "center" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 570, width: 940, height: 40, defaultText: "COMFORT FOOD RECIPES", fontSize: 28, fontWeight: "bold", fill: "#1d3557", textAlign: "center" },
      { id: "image3", type: "image", label: "Image 3", x: 0, y: 600, width: 500, height: 450, bgColor: "#e8e8e8" },
      { id: "image4", type: "image", label: "Image 4", x: 500, y: 600, width: 500, height: 450, bgColor: "#e8e8e8" },
      { id: "footerBand", type: "band", label: "Footer", x: 0, y: 1050, width: 1000, height: 50, bgColor: "#e63946" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1075, width: 940, height: 30, defaultText: "WWW.YOURSITE.COM", fontSize: 22, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
    ],
  },
  {
    id: "top-6-clean",
    name: "Top 6 Grid",
    description: "6 images with header title",
    previewLayout: "grid6",
    bgColor: "#fefefe",
    elements: [
      { id: "headerBand", type: "band", label: "Header Band", x: 0, y: 0, width: 1000, height: 140, bgColor: "#2d3436" },
      { id: "header", type: "text", label: "Header", x: 500, y: 50, width: 940, height: 50, defaultText: "TOP 6", fontSize: 48, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 100, width: 940, height: 35, defaultText: "Vegan Recipes for Christmas", fontSize: 22, fill: "#cccccc", textAlign: "center" },
      { id: "image1", type: "image", label: "Image 1", x: 0, y: 140, width: 334, height: 320, bgColor: "#dfe6e9" },
      { id: "image2", type: "image", label: "Image 2", x: 334, y: 140, width: 333, height: 320, bgColor: "#dfe6e9" },
      { id: "image3", type: "image", label: "Image 3", x: 667, y: 140, width: 333, height: 320, bgColor: "#dfe6e9" },
      { id: "image4", type: "image", label: "Image 4", x: 0, y: 460, width: 334, height: 320, bgColor: "#dfe6e9" },
      { id: "image5", type: "image", label: "Image 5", x: 334, y: 460, width: 333, height: 320, bgColor: "#dfe6e9" },
      { id: "image6", type: "image", label: "Image 6", x: 667, y: 460, width: 333, height: 320, bgColor: "#dfe6e9" },
      { id: "footerBand", type: "band", label: "Footer Band", x: 0, y: 780, width: 1000, height: 60, bgColor: "#2d3436" },
      { id: "footer", type: "text", label: "Footer", x: 500, y: 810, width: 940, height: 30, defaultText: "Dinner starters, sides & main course dishes", fontSize: 20, fill: "#ffffff", textAlign: "center" },
    ],
  },
  {
    id: "featured-hero",
    name: "Hero Image",
    description: "Big hero image with overlay text",
    previewLayout: "hero",
    bgColor: "#1a1a2e",
    elements: [
      { id: "hero", type: "image", label: "Hero Image", x: 0, y: 0, width: 1000, height: 1100, bgColor: "#2d2d44" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 1100, width: 1000, height: 200, bgColor: "#1a1a2e" },
      { id: "title", type: "text", label: "Title", x: 500, y: 1150, width: 940, height: 80, defaultText: "AMAZING RECIPE", fontSize: 64, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
      { id: "subtitle", type: "text", label: "Description", x: 500, y: 1220, width: 940, height: 50, defaultText: "Quick & Easy to Make", fontSize: 28, fill: "#ffd700", textAlign: "center" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1270, width: 940, height: 30, defaultText: "WWW.YOURSITE.COM", fontSize: 22, fill: "#cccccc", textAlign: "center" },
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
  if (layout === "band-peach") {
    return (
      <div className="h-full flex flex-col p-0.5">
        <div className={`${imgBox} flex-[3]`} />
        <div className="bg-orange-100 flex-[1] flex items-center justify-center text-[7px] text-gray-800 font-bold px-1 text-center">Recipe Title Here</div>
        <div className={`${imgBox} flex-[3]`} />
        <div className="bg-pink-200 flex-[0.5] flex items-center justify-center text-[6px] text-gray-700 font-bold">WWW.SITE.COM</div>
      </div>
    );
  }
  if (layout === "band-white") {
    return (
      <div className="h-full flex flex-col p-0.5">
        <div className={`${imgBox} flex-[3]`} />
        <div className="bg-white flex-[1] flex items-center justify-center text-[8px] text-orange-600 font-bold px-1 text-center">BEST RECIPES</div>
        <div className={`${imgBox} flex-[3]`} />
      </div>
    );
  }
  if (layout === "band-blue") {
    return (
      <div className="h-full flex flex-col p-0.5">
        <div className={`${imgBox} flex-[3]`} />
        <div className="bg-blue-600 flex-[1.2] flex flex-col items-center justify-center px-1">
          <span className="text-[5px] text-white">SIMPLE & EASY</span>
          <span className="text-[7px] text-white font-bold">Recipe Title</span>
          <span className="text-[5px] text-white">WWW.SITE.COM</span>
        </div>
        <div className={`${imgBox} flex-[3]`} />
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
  const [leftTab, setLeftTab] = useState<"elements" | "layers" | "templates">("elements");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PinTemplate>(TEMPLATES[0]);
  const [editText, setEditText] = useState("");
  const [pinName, setPinName] = useState(templateName);
  const [layers, setLayers] = useState<{ id: string; label: string; type: string }[]>([]);
  const [canvasReady, setCanvasReady] = useState(false);
  
  // Text properties
  const [fontFamily, setFontFamily] = useState("Arial");
  const [fontSize, setFontSize] = useState(32);
  const [fontWeight, setFontWeight] = useState("normal");
  const [textAlign, setTextAlign] = useState("center");
  const [textColor, setTextColor] = useState("#333333");
  const [textEffect, setTextEffect] = useState("none");
  
  // Frame properties
  const [frameStrokeWidth, setFrameStrokeWidth] = useState(4);
  const [frameStrokeColor, setFrameStrokeColor] = useState("#333333");
  const [frameStrokeStyle, setFrameStrokeStyle] = useState<"solid" | "dashed" | "dotted">("solid");

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
      } else if (el.type === "band") {
        const band = new Rect({
          left: el.x,
          top: el.y,
          width: el.width,
          height: el.height,
          fill: el.bgColor || "#ffffff",
          selectable: true,
          strokeWidth: 0,
          originX: "left",
          originY: "top",
        });
        (band as any).__pinId = el.id;
        (band as any).__pinLabel = el.label;
        (band as any).__pinType = "band";
        canvas.add(band);
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
          textAlign: el.textAlign || "center",
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
            if (obj.__pinType === "text") {
              setEditText(obj.text ?? "");
              setFontFamily(obj.fontFamily ?? "Arial");
              setFontSize(obj.fontSize ?? 32);
              setFontWeight(obj.fontWeight ?? "normal");
              setTextAlign(obj.textAlign ?? "center");
              setTextColor(obj.fill ?? "#333333");
            } else if (obj.__pinType === "frame") {
              setFrameStrokeWidth(obj.strokeWidth ?? 4);
              setFrameStrokeColor(obj.stroke ?? "#333333");
              setFrameStrokeStyle(obj.__strokeStyle ?? "solid");
            }
          }
        });
        canvas.on("selection:updated", (e: any) => {
          const obj = e.selected?.[0];
          if (obj?.__pinId) {
            setSelectedId(obj.__pinId);
            if (obj.__pinType === "text") {
              setEditText(obj.text ?? "");
              setFontFamily(obj.fontFamily ?? "Arial");
              setFontSize(obj.fontSize ?? 32);
              setFontWeight(obj.fontWeight ?? "normal");
              setTextAlign(obj.textAlign ?? "center");
              setTextColor(obj.fill ?? "#333333");
            } else if (obj.__pinType === "frame") {
              setFrameStrokeWidth(obj.strokeWidth ?? 4);
              setFrameStrokeColor(obj.stroke ?? "#333333");
              setFrameStrokeStyle(obj.__strokeStyle ?? "solid");
            }
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

  const deleteSelectedElement = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !selectedId) return;
    
    const obj = canvas.getObjects().find((o: any) => o.__pinId === selectedId);
    if (obj) {
      canvas.remove(obj);
      const label = canvas.getObjects().find((o: any) => o.__forId === selectedId);
      if (label) canvas.remove(label);
      canvas.discardActiveObject();
      canvas.renderAll();
      setSelectedId(null);
      updateLayers();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        const activeElement = document.activeElement;
        const isInputFocused = activeElement?.tagName === "INPUT" || 
                               activeElement?.tagName === "TEXTAREA" ||
                               activeElement?.getAttribute("contenteditable") === "true";
        if (!isInputFocused) {
          e.preventDefault();
          deleteSelectedElement();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId]);

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

  const updateTextProperty = (property: string, value: any) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !selectedId) return;
    const obj = canvas.getObjects().find((o: any) => o.__pinId === selectedId);
    if (obj && obj.set && obj.__pinType === "text") {
      if (property === "fontFamily") {
        obj.set("fontFamily", value);
        setFontFamily(value);
      } else if (property === "fontSize") {
        obj.set("fontSize", parseInt(value));
        setFontSize(parseInt(value));
      } else if (property === "fontWeight") {
        obj.set("fontWeight", value);
        setFontWeight(value);
      } else if (property === "textAlign") {
        obj.set("textAlign", value);
        setTextAlign(value);
      } else if (property === "fill") {
        obj.set("fill", value);
        setTextColor(value);
      }
      canvas.renderAll();
    }
  };

  const addTextElement = () => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;

    const id = `text_${Date.now()}`;
    const text = new fabric.FabricText("New Text", {
      left: PIN_W / 2,
      top: PIN_H / 2,
      fontSize: 36,
      fontFamily: "Arial",
      fontWeight: "normal",
      fill: "#333333",
      originX: "center",
      originY: "center",
      selectable: true,
      textAlign: "center",
    });
    (text as any).__pinId = id;
    (text as any).__pinLabel = "Text";
    (text as any).__pinType = "text";
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    updateLayers();
    setSelectedId(id);
    setEditText("New Text");
  };

  const addImageZone = () => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;

    const id = `image_${Date.now()}`;
    const rect = new fabric.Rect({
      left: 100,
      top: 100,
      width: 300,
      height: 300,
      fill: "#e0e0e0",
      rx: 8,
      ry: 8,
      selectable: true,
      strokeWidth: 2,
      stroke: "#cccccc",
    });
    (rect as any).__pinId = id;
    (rect as any).__pinLabel = "Image Zone";
    (rect as any).__pinType = "image";
    canvas.add(rect);

    const label = new fabric.FabricText("Image Zone", {
      left: 100 + 150,
      top: 100 + 150,
      fontSize: 16,
      fontFamily: "Arial",
      fill: "#999999",
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    });
    (label as any).__isLabel = true;
    (label as any).__forId = id;
    canvas.add(label);

    canvas.setActiveObject(rect);
    canvas.renderAll();
    updateLayers();
    setSelectedId(id);
  };

  const addFrame = () => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;

    const id = `frame_${Date.now()}`;
    const frame = new fabric.Rect({
      left: PIN_W / 2,
      top: PIN_H / 2,
      width: 800,
      height: 120,
      fill: "transparent",
      stroke: "#333333",
      strokeWidth: 4,
      rx: 0,
      ry: 0,
      originX: "center",
      originY: "center",
      selectable: true,
    });
    (frame as any).__pinId = id;
    (frame as any).__pinLabel = "Frame";
    (frame as any).__pinType = "frame";
    (frame as any).__strokeStyle = "solid";
    canvas.add(frame);
    canvas.setActiveObject(frame);
    canvas.renderAll();
    updateLayers();
    setSelectedId(id);
    setFrameStrokeWidth(4);
    setFrameStrokeColor("#333333");
    setFrameStrokeStyle("solid");
  };

  const updateFrameProperty = (property: string, value: any) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !selectedId) return;
    const obj = canvas.getObjects().find((o: any) => o.__pinId === selectedId);
    if (obj && obj.__pinType === "frame") {
      if (property === "strokeWidth") {
        obj.set("strokeWidth", parseInt(value));
        setFrameStrokeWidth(parseInt(value));
      } else if (property === "stroke") {
        obj.set("stroke", value);
        setFrameStrokeColor(value);
      } else if (property === "strokeStyle") {
        setFrameStrokeStyle(value);
        (obj as any).__strokeStyle = value;
        if (value === "solid") {
          obj.set("strokeDashArray", undefined);
        } else if (value === "dashed") {
          obj.set("strokeDashArray", [15, 10]);
        } else if (value === "dotted") {
          obj.set("strokeDashArray", [4, 6]);
        }
      } else if (property === "rx") {
        obj.set("rx", parseInt(value));
        obj.set("ry", parseInt(value));
      }
      canvas.renderAll();
    }
  };

  const syncTextProperties = (obj: any) => {
    if (obj && obj.__pinType === "text") {
      setEditText(obj.text ?? "");
      setFontFamily(obj.fontFamily ?? "Arial");
      setFontSize(obj.fontSize ?? 32);
      setFontWeight(obj.fontWeight ?? "normal");
      setTextAlign(obj.textAlign ?? "center");
      setTextColor(obj.fill ?? "#333333");
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
              onClick={() => setLeftTab("elements")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs ${leftTab === "elements" ? "text-brand-400 border-b-2 border-brand-500" : "text-gray-500"}`}
            >
              <Grid3X3 size={14} /> Elements
            </button>
            <button
              onClick={() => setLeftTab("layers")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs ${leftTab === "layers" ? "text-brand-400 border-b-2 border-brand-500" : "text-gray-500"}`}
            >
              <Layers size={14} /> Layers
            </button>
            <button
              onClick={() => setLeftTab("templates")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs ${leftTab === "templates" ? "text-brand-400 border-b-2 border-brand-500" : "text-gray-500"}`}
            >
              <LayoutTemplate size={14} /> Templates
            </button>
          </div>
          <div className="p-3 overflow-y-auto flex-1">
            {leftTab === "elements" && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Add Elements</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={addTextElement}
                      className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition"
                    >
                      <Type size={28} className="text-gray-300" />
                      <span className="text-xs text-gray-400">Text</span>
                    </button>
                    <button
                      onClick={addImageZone}
                      className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition"
                    >
                      <ImageIcon size={28} className="text-gray-300" />
                      <span className="text-xs text-gray-400">Image Zone</span>
                    </button>
                    <button
                      onClick={() => {
                        const fabric = fabricLibRef.current;
                        const canvas = fabricCanvasRef.current;
                        if (!fabric || !canvas) return;
                        const id = `band_${Date.now()}`;
                        const band = new fabric.Rect({
                          left: 0,
                          top: PIN_H / 2 - 75,
                          width: PIN_W,
                          height: 150,
                          fill: "#1565c0",
                          selectable: true,
                          strokeWidth: 0,
                          originX: "left",
                          originY: "top",
                        });
                        (band as any).__pinId = id;
                        (band as any).__pinLabel = "Color Band";
                        (band as any).__pinType = "band";
                        canvas.add(band);
                        canvas.setActiveObject(band);
                        canvas.renderAll();
                        updateLayers();
                        setSelectedId(id);
                      }}
                      className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition"
                    >
                      <div className="w-7 h-5 bg-blue-500 rounded" />
                      <span className="text-xs text-gray-400">Color Band</span>
                    </button>
                    <button
                      onClick={addFrame}
                      className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition"
                    >
                      <Square size={28} className="text-gray-300" />
                      <span className="text-xs text-gray-400">Frame</span>
                    </button>
                    <button
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.onchange = (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = () => {
                              const fabric = fabricLibRef.current;
                              const canvas = fabricCanvasRef.current;
                              if (!fabric || !canvas || !reader.result) return;
                              const id = `image_${Date.now()}`;
                              fabric.FabricImage.fromURL(reader.result as string, { crossOrigin: "anonymous" })
                                .then((img: any) => {
                                  const scale = Math.min(400 / img.width, 400 / img.height);
                                  img.set({
                                    left: PIN_W / 2,
                                    top: PIN_H / 2,
                                    scaleX: scale,
                                    scaleY: scale,
                                    originX: "center",
                                    originY: "center",
                                  });
                                  (img as any).__pinId = id;
                                  (img as any).__pinLabel = "Uploaded Image";
                                  (img as any).__pinType = "image";
                                  canvas.add(img);
                                  canvas.setActiveObject(img);
                                  canvas.renderAll();
                                  updateLayers();
                                });
                            };
                            reader.readAsDataURL(file);
                          }
                        };
                        input.click();
                      }}
                      className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition col-span-2"
                    >
                      <Upload size={28} className="text-gray-300" />
                      <span className="text-xs text-gray-400">Upload Image</span>
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Template Size</p>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500">Width</label>
                      <div className="bg-gray-800 rounded px-2 py-1 text-sm text-gray-300">{PIN_W}</div>
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500">Height</label>
                      <div className="bg-gray-800 rounded px-2 py-1 text-sm text-gray-300">{PIN_H}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
              <div className="p-3 bg-gray-800 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{selectedElement.label}</p>
                  <p className="text-xs text-gray-500">
                    {selectedElement.type === "image" ? "Image slot" : 
                     selectedElement.type === "band" ? "Color band" : 
                     selectedElement.type === "frame" ? "Border frame" : "Text element"}
                  </p>
                </div>
                <button
                  onClick={deleteSelectedElement}
                  className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg transition"
                  title="Delete element (Del)"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              {selectedElement.type === "text" && (
                <div className="space-y-4">
                  {/* Text Content */}
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Text Content</label>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={applyEditText}
                      rows={2}
                      className="input-field text-sm w-full"
                      placeholder="Enter text..."
                    />
                  </div>

                  {/* Font Family & Size */}
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Text Properties</label>
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] text-gray-500">Font Family</label>
                        <select
                          value={fontFamily}
                          onChange={(e) => updateTextProperty("fontFamily", e.target.value)}
                          className="input-field text-sm w-full"
                        >
                          <option value="Arial">Arial</option>
                          <option value="Georgia">Georgia</option>
                          <option value="Times New Roman">Times New Roman</option>
                          <option value="Verdana">Verdana</option>
                          <option value="Courier New">Courier New</option>
                          <option value="Impact">Impact</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500">Font Size</label>
                          <input
                            type="number"
                            value={fontSize}
                            onChange={(e) => updateTextProperty("fontSize", e.target.value)}
                            className="input-field text-sm w-full"
                            min="8"
                            max="200"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500">Font Weight</label>
                          <select
                            value={fontWeight}
                            onChange={(e) => updateTextProperty("fontWeight", e.target.value)}
                            className="input-field text-sm w-full"
                          >
                            <option value="normal">Normal</option>
                            <option value="bold">Bold</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Text Align */}
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Text Align</label>
                    <div className="flex gap-1">
                      {["left", "center", "right"].map((align) => (
                        <button
                          key={align}
                          onClick={() => updateTextProperty("textAlign", align)}
                          className={`flex-1 py-1.5 rounded text-xs font-medium transition ${
                            textAlign === align
                              ? "bg-brand-500 text-white"
                              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                          }`}
                        >
                          {align.charAt(0).toUpperCase() + align.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Color */}
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Text Color</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => updateTextProperty("fill", e.target.value)}
                        className="w-10 h-8 rounded border border-gray-600 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={textColor}
                        onChange={(e) => updateTextProperty("fill", e.target.value)}
                        className="input-field text-sm flex-1"
                        placeholder="#000000"
                      />
                    </div>
                  </div>

                  {/* Quick Colors */}
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Quick Colors</label>
                    <div className="flex gap-1 flex-wrap">
                      {["#000000", "#ffffff", "#e63946", "#2d5016", "#1d3557", "#f4a261", "#2a9d8f", "#9b59b6"].map((color) => (
                        <button
                          key={color}
                          onClick={() => updateTextProperty("fill", color)}
                          className={`w-6 h-6 rounded border-2 ${textColor === color ? "border-brand-500" : "border-gray-600"}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <button onClick={applyEditText} className="btn-primary text-xs px-3 py-1.5 w-full">
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

              {selectedElement.type === "band" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Band Color</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        defaultValue="#ffffff"
                        onChange={(e) => {
                          const canvas = fabricCanvasRef.current;
                          if (!canvas || !selectedId) return;
                          const obj = canvas.getObjects().find((o: any) => o.__pinId === selectedId);
                          if (obj && obj.set) {
                            obj.set("fill", e.target.value);
                            canvas.renderAll();
                          }
                        }}
                        className="w-10 h-8 rounded border border-gray-600 cursor-pointer"
                      />
                      <span className="text-xs text-gray-400">Click to change color</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Quick Colors</label>
                    <div className="flex gap-1 flex-wrap">
                      {["#ffffff", "#ffecd2", "#ffd4d4", "#1565c0", "#2d3436", "#e63946", "#2a9d8f", "#f4a261", "#000000"].map((color) => (
                        <button
                          key={color}
                          onClick={() => {
                            const canvas = fabricCanvasRef.current;
                            if (!canvas || !selectedId) return;
                            const obj = canvas.getObjects().find((o: any) => o.__pinId === selectedId);
                            if (obj && obj.set) {
                              obj.set("fill", color);
                              canvas.renderAll();
                            }
                          }}
                          className="w-6 h-6 rounded border-2 border-gray-600 hover:border-brand-500"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectedElement.type === "frame" && (
                <div className="space-y-4">
                  {/* Border Style */}
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Border Style</label>
                    <div className="flex gap-1">
                      {(["solid", "dashed", "dotted"] as const).map((style) => (
                        <button
                          key={style}
                          onClick={() => updateFrameProperty("strokeStyle", style)}
                          className={`flex-1 py-2 rounded text-xs font-medium transition flex flex-col items-center gap-1 ${
                            frameStrokeStyle === style
                              ? "bg-brand-500 text-white"
                              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                          }`}
                        >
                          <div 
                            className="w-8 h-0 border-t-2"
                            style={{ 
                              borderStyle: style,
                              borderColor: frameStrokeStyle === style ? "white" : "#9ca3af"
                            }}
                          />
                          <span className="capitalize">{style}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Border Width */}
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Border Width</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="range"
                        min="1"
                        max="20"
                        value={frameStrokeWidth}
                        onChange={(e) => updateFrameProperty("strokeWidth", e.target.value)}
                        className="flex-1"
                      />
                      <span className="text-sm text-gray-300 w-8">{frameStrokeWidth}px</span>
                    </div>
                  </div>

                  {/* Corner Radius */}
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Corner Radius</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="range"
                        min="0"
                        max="50"
                        defaultValue="0"
                        onChange={(e) => updateFrameProperty("rx", e.target.value)}
                        className="flex-1"
                      />
                      <span className="text-sm text-gray-300 w-8">{0}px</span>
                    </div>
                  </div>

                  {/* Border Color */}
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Border Color</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={frameStrokeColor}
                        onChange={(e) => updateFrameProperty("stroke", e.target.value)}
                        className="w-10 h-8 rounded border border-gray-600 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={frameStrokeColor}
                        onChange={(e) => updateFrameProperty("stroke", e.target.value)}
                        className="input-field text-sm flex-1"
                        placeholder="#000000"
                      />
                    </div>
                  </div>

                  {/* Quick Colors */}
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Quick Colors</label>
                    <div className="flex gap-1 flex-wrap">
                      {["#000000", "#333333", "#666666", "#ffffff", "#e63946", "#1565c0", "#2a9d8f", "#f4a261", "#9b59b6"].map((color) => (
                        <button
                          key={color}
                          onClick={() => updateFrameProperty("stroke", color)}
                          className={`w-6 h-6 rounded border-2 ${frameStrokeColor === color ? "border-brand-500" : "border-gray-600"}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
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
