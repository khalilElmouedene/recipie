"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  X, Download, ZoomIn, ZoomOut, Layers, LayoutTemplate, Grid3X3,
  Type, Upload, Image as ImageIcon, Minus, Trash2, Square,
  Send, Save, AlignLeft, AlignCenter,
  AlignRight, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown,
  PanelLeft, PanelRight, Settings, ChevronLeft, ChevronRight,
  Plus, Loader2, ALargeSmall, Check,
  CalendarClock,
  History,
  FlipHorizontal2, FlipVertical2,
  Lock, Unlock,
  Sheet,
} from "lucide-react";
import { api, getApiBaseUrl } from "@/lib/api";
import { appendPinImageToArticleHtml } from "@/lib/pinArticleEmbed";
import { getUserRole, getUserId } from "@/lib/auth";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";
import { useDesignerStore } from "@/store/useDesignerStore";
import type { StrokeStyle, ShapeProps } from "@/store/useDesignerStore";
import {
  PINTEREST_WORKSHEET_HEADER,
  PINTEREST_WORKSHEET_INIT_KEY,
  PinterestWorksheetRecipe,
  PinterestWorksheetSnapshot,
  buildPinterestWorksheetRows,
  rowsToCsv,
} from "@/lib/pinterestWorksheet";

const PIN_W = 1000;
const PIN_H = 1500;

// ─── Helpers ────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  hex = hex.replace("#", "");
  if (hex.length === 3)
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function rgbaToHex(rgba: string): { hex: string; alpha: number } {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, "0");
    const g = parseInt(match[2]).toString(16).padStart(2, "0");
    const b = parseInt(match[3]).toString(16).padStart(2, "0");
    return { hex: `#${r}${g}${b}`, alpha: parseFloat(match[4] ?? "1") };
  }
  return { hex: rgba.startsWith("#") ? rgba : "#ffffff", alpha: 1 };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface TemplateElement {
  id: string;
  // `type` comes from stored template data; runtime behavior relies on
  // string comparisons inside the template loader.
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defaultText?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  fill?: string;
  bgColor?: string;
  textAlign?: string;
  textVariable?: string;
  textTransform?: string;
  flipX?: boolean;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  radius?: number;
  locked?: boolean;
  [key: string]: unknown; // allow extra fields from API
}

export interface PinTemplate {
  id: string;
  owner_id?: string;
  name: string;
  description: string;
  previewLayout:
    | "simple" | "grid4" | "grid6" | "hero" | "sandwich" | "card-overlap"
    | "band-white" | "band-blue" | "band-peach" | "band-brown";
  bgColor: string;
  elements: TemplateElement[];
  exampleImage?: string;
  canvasWidth?: number;
  canvasHeight?: number;
}

// ─── Templates ───────────────────────────────────────────────────────────────

export const TEMPLATES: PinTemplate[] = [];

// (kept for import compatibility — all templates are now custom/project templates)
const _UNUSED_BUILTIN_TEMPLATES_REMOVED: PinTemplate[] = [
  {
    id: "canva-brown-bars",
    name: "Canva Style: Brown Band",
    description: "Like Knock You Naked Bars – image, brown band with white title, image",
    previewLayout: "band-brown",
    bgColor: "#ffffff",
    exampleImage: "/template images/d2b66990e00856a279d4028d04a4d3dc.png",
    elements: [
      { id: "image1", type: "image", label: "Top Image", x: 0, y: 0, width: 1000, height: 600, bgColor: "#e8e8e8" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 600, width: 1000, height: 140, bgColor: "#8b6914" },
      { id: "title", type: "text", label: "Title", x: 500, y: 670, width: 940, height: 80, defaultText: "Recipe Title Here", fontSize: 48, fontWeight: "normal", fill: "#ffffff", textAlign: "center" },
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 740, width: 1000, height: 760, bgColor: "#e8e8e8" },
    ],
  },
  {
    id: "canva-peach-brownie",
    name: "Canva Style: Peach Multi-Text",
    description: "Like Chocolate Brownie Cookies – subtitle, main title, logo space",
    previewLayout: "band-peach",
    bgColor: "#ffffff",
    exampleImage: "/template images/018e61fd82eb8a091fc8fa52a6c26309.png",
    elements: [
      { id: "image1", type: "image", label: "Top Image", x: 0, y: 0, width: 1000, height: 560, bgColor: "#e8e8e8" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 560, width: 1000, height: 200, bgColor: "#ffecd2" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 590, width: 940, height: 30, defaultText: "The Best", fontSize: 24, fontWeight: "normal", fill: "#1a5f5f", textAlign: "center" },
      { id: "title1", type: "text", label: "Title Line 1", x: 500, y: 640, width: 940, height: 50, defaultText: "RECIPE TITLE LINE 1", fontSize: 42, fontWeight: "bold", fill: "#1a5f5f", textAlign: "center" },
      { id: "title2", type: "text", label: "Title Line 2", x: 500, y: 700, width: 940, height: 50, defaultText: "LINE 2", fontSize: 42, fontWeight: "bold", fill: "#1a5f5f", textAlign: "center" },
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 760, width: 1000, height: 740, bgColor: "#e8e8e8" },
    ],
  },
  {
    id: "canva-cinnamon-rolls",
    name: "Canva Style: Brown + URL",
    description: "Like Biscoff Cinnamon Rolls – dark band, title + website footer",
    previewLayout: "band-brown",
    bgColor: "#ffffff",
    exampleImage: "/template images/240dd71b9abbf222812816708239b680.png",
    elements: [
      { id: "image1", type: "image", label: "Top Image", x: 0, y: 0, width: 1000, height: 560, bgColor: "#e8e8e8" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 560, width: 1000, height: 180, bgColor: "#4a3728" },
      { id: "title", type: "text", label: "Title", x: 500, y: 610, width: 940, height: 70, defaultText: "Recipe Title Here", fontSize: 38, fontWeight: "bold", fill: "#f5e6d3", textAlign: "center" },
      { id: "website", type: "text", label: "Website", x: 500, y: 680, width: 940, height: 35, defaultText: "WWW.YOURSITE.COM", fontSize: 22, fontWeight: "bold", fill: "#f5e6d3", textAlign: "center" },
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 740, width: 1000, height: 760, bgColor: "#e8e8e8" },
    ],
  },
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
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 670, width: 1000, height: 750, bgColor: "#e8e8e8" },
      { id: "footerBand", type: "band", label: "Footer Band", x: 0, y: 1420, width: 1000, height: 80, bgColor: "#ffd4d4" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1460, width: 940, height: 40, defaultText: "WWW.YOURSITE.COM", fontSize: 28, fontWeight: "bold", fill: "#333333", textAlign: "center" },
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
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 720, width: 1000, height: 780, bgColor: "#e8e8e8" },
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
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 720, width: 1000, height: 780, bgColor: "#e8e8e8" },
    ],
  },
  {
    id: "images-text-images",
    name: "4 Images + Text",
    description: "2 images top, text center, 2 images bottom",
    previewLayout: "sandwich",
    bgColor: "#ffffff",
    elements: [
      { id: "image1", type: "image", label: "Top Left", x: 0, y: 0, width: 500, height: 500, bgColor: "#e8e8e8" },
      { id: "image2", type: "image", label: "Top Right", x: 500, y: 0, width: 500, height: 500, bgColor: "#e8e8e8" },
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 500, width: 1000, height: 180, bgColor: "#ffffff" },
      { id: "title", type: "text", label: "Title", x: 500, y: 560, width: 940, height: 70, defaultText: "THE BEST RECIPES", fontSize: 52, fontWeight: "bold", fill: "#e63946", textAlign: "center" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 630, width: 940, height: 40, defaultText: "Comfort Food Collection", fontSize: 28, fill: "#666666", textAlign: "center" },
      { id: "image3", type: "image", label: "Bottom Left", x: 0, y: 680, width: 500, height: 760, bgColor: "#e8e8e8" },
      { id: "image4", type: "image", label: "Bottom Right", x: 500, y: 680, width: 500, height: 760, bgColor: "#e8e8e8" },
      { id: "footerBand", type: "band", label: "Footer", x: 0, y: 1440, width: 1000, height: 60, bgColor: "#e63946" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1470, width: 940, height: 30, defaultText: "WWW.YOURSITE.COM", fontSize: 24, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
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
      { id: "image3", type: "image", label: "Image 3", x: 0, y: 600, width: 500, height: 850, bgColor: "#e8e8e8" },
      { id: "image4", type: "image", label: "Image 4", x: 500, y: 600, width: 500, height: 850, bgColor: "#e8e8e8" },
      { id: "footerBand", type: "band", label: "Footer", x: 0, y: 1450, width: 1000, height: 50, bgColor: "#e63946" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1475, width: 940, height: 30, defaultText: "WWW.YOURSITE.COM", fontSize: 22, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
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
      { id: "image1", type: "image", label: "Image 1", x: 0, y: 140, width: 334, height: 640, bgColor: "#dfe6e9" },
      { id: "image2", type: "image", label: "Image 2", x: 334, y: 140, width: 333, height: 640, bgColor: "#dfe6e9" },
      { id: "image3", type: "image", label: "Image 3", x: 667, y: 140, width: 333, height: 640, bgColor: "#dfe6e9" },
      { id: "image4", type: "image", label: "Image 4", x: 0, y: 780, width: 334, height: 640, bgColor: "#dfe6e9" },
      { id: "image5", type: "image", label: "Image 5", x: 334, y: 780, width: 333, height: 640, bgColor: "#dfe6e9" },
      { id: "image6", type: "image", label: "Image 6", x: 667, y: 780, width: 333, height: 640, bgColor: "#dfe6e9" },
      { id: "footerBand", type: "band", label: "Footer Band", x: 0, y: 1420, width: 1000, height: 80, bgColor: "#2d3436" },
      { id: "footer", type: "text", label: "Footer", x: 500, y: 1460, width: 940, height: 30, defaultText: "Dinner starters, sides & main course dishes", fontSize: 20, fill: "#ffffff", textAlign: "center" },
    ],
  },
  {
    id: "canva-card-overlap",
    name: "Card Overlap Style",
    description: "Image, floating white card with circle badge, image, footer",
    previewLayout: "card-overlap",
    bgColor: "#ffffff",
    elements: [
      { id: "image1", type: "image", label: "Top Image", x: 0, y: 0, width: 1000, height: 510, bgColor: "#e8e8e8" },
      { id: "card", type: "band", label: "Card", x: 0, y: 440, width: 1000, height: 300, bgColor: "#faf8f3" },
      { id: "badge", type: "circle", label: "Badge Circle", x: 500, y: 440, width: 136, height: 136, radius: 68, bgColor: "#7a2d2d" },
      { id: "badgeNum", type: "text", label: "Badge Number", x: 500, y: 440, width: 136, height: 60, defaultText: "30", fontSize: 52, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
      { id: "title", type: "text", label: "Title", x: 500, y: 565, width: 900, height: 90, defaultText: "Fall Recipes", fontSize: 72, fontWeight: "normal", fontStyle: "italic", fill: "#1a1a1a", textAlign: "center" },
      { id: "lineLeft", type: "band", label: "Line Left", x: 30, y: 639, width: 175, height: 2, bgColor: "#aaaaaa" },
      { id: "subtitle", type: "text", label: "Subtitle", x: 500, y: 640, width: 540, height: 40, defaultText: "EASY & DELICIOUS", fontSize: 22, fill: "#666666", textAlign: "center" },
      { id: "lineRight", type: "band", label: "Line Right", x: 795, y: 639, width: 175, height: 2, bgColor: "#aaaaaa" },
      { id: "image2", type: "image", label: "Bottom Image", x: 0, y: 740, width: 1000, height: 680, bgColor: "#e8e8e8" },
      { id: "footer", type: "band", label: "Footer", x: 0, y: 1420, width: 1000, height: 80, bgColor: "#7a2d2d" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1460, width: 940, height: 40, defaultText: "REALLYGREATSITE.COM", fontSize: 22, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
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
      { id: "textBand", type: "band", label: "Text Band", x: 0, y: 1100, width: 1000, height: 400, bgColor: "#1a1a2e" },
      { id: "title", type: "text", label: "Title", x: 500, y: 1160, width: 940, height: 80, defaultText: "AMAZING RECIPE", fontSize: 64, fontWeight: "bold", fill: "#ffffff", textAlign: "center" },
      { id: "subtitle", type: "text", label: "Description", x: 500, y: 1280, width: 940, height: 50, defaultText: "Quick & Easy to Make", fontSize: 28, fill: "#ffd700", textAlign: "center" },
      { id: "website", type: "text", label: "Website", x: 500, y: 1440, width: 940, height: 30, defaultText: "WWW.YOURSITE.COM", fontSize: 22, fill: "#cccccc", textAlign: "center" },
    ],
  },
];

// ─── Bulk style overrides (shared across all recipes in bulk mode) ────────────

export interface BulkOverrides {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  titleColor?: string;
  bandColor?: string;
  websiteText?: string;
  bgColor?: string;
}

// ─── Text case transform helper ──────────────────────────────────────────────

export function applyTextTransform(text: string, transform: string): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

// ─── Standalone template renderer (used for batch Save All) ──────────────────

function _applyTemplateLock(obj: any, locked: boolean | undefined) {
  if (!locked) return;
  obj.__pinLocked = true;
  obj.set({ lockMovementX: true, lockMovementY: true, lockRotation: true, lockScalingX: true, lockScalingY: true, hasControls: false });
}

export async function buildTemplateOnCanvas(
  fabric: any,
  canvas: any,
  template: PinTemplate,
  images: string[],
  proxyBase: string,
  title: string = "Recipe Title",
  website: string = "",
  overrides?: BulkOverrides,
): Promise<void> {
  const isCustomTemplateId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(template.id || "")
  );
  const shouldAutoStretchLastElement = !isCustomTemplateId;

  canvas.clear();
  canvas.backgroundColor = overrides?.bgColor || template.bgColor;
  let imageIndex = 0;

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const fetchAsDataUrl = async (url: string): Promise<string> => {
    const proxyEndpoint = `${proxyBase}/api/image-proxy?url=${encodeURIComponent(url)}`;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(proxyEndpoint, { headers });
    if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const resolveImageUrl = async (url: string): Promise<string> => {
    if (!url) return url;
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    if (url.startsWith("/")) return url;
    if (proxyBase && url.startsWith(proxyBase)) return url;
    try { if (typeof window !== "undefined" && url.startsWith(window.location.origin)) return url; } catch {}
    return fetchAsDataUrl(url);
  };

  const oFont = overrides?.fontFamily;
  const oSize = overrides?.fontSize;
  const oWeight = overrides?.fontWeight;
  const oTitleColor = overrides?.titleColor;
  const oBandColor = overrides?.bandColor;
  const oWebsite = overrides?.websiteText;

  for (const el of template.elements) {
    if (el.type === "image") {
      const legacyAssetId = String(el.id || "");
      if (legacyAssetId.startsWith("bg_") || legacyAssetId.startsWith("img_")) {
        continue;
      }
      const imageUrl = images.length > 0 ? (images[imageIndex % images.length]?.trim() || "") : "";
      imageIndex++;
      if (imageUrl) {
        try {
          const resolved = await resolveImageUrl(imageUrl);
          const img = await fabric.FabricImage.fromURL(resolved, { crossOrigin: "anonymous" });
          const scale = Math.max(el.width / (img.width || 1), el.height / (img.height || 1));
          img.set({ left: el.x + el.width / 2, top: el.y + el.height / 2, originX: "center", originY: "center", scaleX: scale, scaleY: scale });
          (img as any).__pinId = el.id; (img as any).__pinType = "image";
          _applyTemplateLock(img, el.locked);
          const clipRect = new fabric.Rect({ left: el.x, top: el.y, width: el.width, height: el.height, absolutePositioned: true, fill: "" });
          (img as any).clipPath = clipRect;
          canvas.add(img);
        } catch {
          const rect = new fabric.Rect({ left: el.x, top: el.y, width: el.width, height: el.height, fill: el.bgColor || "#e0e0e0" });
          canvas.add(rect);
        }
      } else {
        const rect = new fabric.Rect({ left: el.x, top: el.y, width: el.width, height: el.height, fill: el.bgColor || "#e0e0e0" });
        canvas.add(rect);
      }
    } else if (el.type === "band" || el.type === "circle") {
      const bandFill = (el.id === "textBand" && oBandColor) ? oBandColor : (el.bgColor || (el.type === "circle" ? "#8b0000" : "#ffffff"));
      const shape = el.type === "circle"
        ? new fabric.Circle({ left: el.x, top: el.y, radius: el.radius || 60, fill: bandFill, originX: "center", originY: "center" })
        : new fabric.Rect({ left: el.x, top: el.y, width: el.width, height: el.height, fill: bandFill, strokeWidth: 0 });
      _applyTemplateLock(shape, el.locked);
      canvas.add(shape);
    } else if (el.type === "text") {
      const titleLines = (title || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const firstLine = titleLines[0] || title || "";
      const secondLine = titleLines[1] || "";
      const thirdLine = titleLines[2] || "";
      const tv = (el as any).textVariable ?? "";
      // Explicit textVariable wins. ID-based fallbacks only apply for built-in semantic IDs,
      // never for auto-generated IDs (text_*, website_*) — those must use textVariable.
      let text: string;
      if (tv === "title" || el.id === "title") {
        text = title || el.defaultText || "";
      } else if (el.id === "title1") {
        text = firstLine || el.defaultText || "";
      } else if (el.id === "title2") {
        text = secondLine || el.defaultText || "";
      } else if (el.id === "title3") {
        text = thirdLine || el.defaultText || "";
      } else if (tv === "website" || el.id === "website") {
        text = oWebsite || website || el.defaultText || "";
      } else {
        text = el.defaultText || "";
      }
      const isTitle = tv === "title" || el.id === "title";
      const isWebsite = tv === "website" || el.id === "website";
      const fill = isTitle && oTitleColor ? oTitleColor : (el.fill || "#333333");
      const tt = (el as any).textTransform ?? "none";
      const displayText = applyTextTransform(text, tt);
      const tb = new fabric.Textbox(displayText, {
        left: el.x, top: el.y, width: el.width || 940, originX: "center", originY: "center",
        fontSize: (isTitle && oSize) ? oSize : (el.fontSize || 32),
        fontFamily: oFont || el.fontFamily || "Arial",
        fontWeight: (isTitle && oWeight) ? oWeight : (el.fontWeight || "normal"),
        fontStyle: (el.fontStyle as any) || "normal",
        fill,
        textAlign: el.textAlign || "center",
      });
      (tb as any).__pinId = el.id;
      (tb as any).__pinLabel = el.label;
      (tb as any).__pinType = "text";
      (tb as any).__textTransform = tt;
      (tb as any).__rawText = text;
      _applyTemplateLock(tb, el.locked);
      canvas.add(tb);
    }
  }

  if (shouldAutoStretchLastElement) {
    // Keep old behavior for built-ins only.
    const objs: any[] = canvas.getObjects();
    if (objs.length > 0) {
      const last = objs[objs.length - 1];
      const bottom = last.originY === "center"
        ? (last.top ?? 0) + ((last.height ?? 0) * (last.scaleY ?? 1)) / 2
        : (last.top ?? 0) + (last.height ?? 0) * (last.scaleY ?? 1);
      const gap = PIN_H - bottom;
      if (gap > 1) {
        if (last.type === "image") {
          const origH = last.height ?? 1;
          const newSY = (origH * (last.scaleY ?? 1) + gap) / origH;
          last.set({ scaleY: newSY, top: (last.top ?? 0) + gap / 2 });
          if (last.clipPath) last.clipPath.set("height", (last.clipPath.height ?? 0) + gap);
        } else {
          last.set("height", (last.height ?? 0) + gap);
        }
        last.setCoords();
      }
    }
  }
  canvas.renderAll();
}

// ─── Template Preview ─────────────────────────────────────────────────────────

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
  if (layout === "card-overlap") {
    return (
      <div className="h-full flex flex-col p-1 relative">
        <div className={`${imgBox} flex-[3]`} />
        <div className="absolute left-1 right-1 bg-amber-50 rounded shadow flex flex-col items-center justify-center py-1" style={{ top: "38%", height: "22%" }}>
          <div className="w-5 h-5 rounded-full bg-red-900 flex items-center justify-center text-[6px] text-white font-bold -mt-3 mb-0.5">30</div>
          <div className="text-[7px] italic text-gray-800 leading-tight">Recipe Title</div>
          <div className="text-[5px] text-gray-500 tracking-wide">EASY &amp; DELICIOUS</div>
        </div>
        <div className={`${imgBox} flex-[2]`} />
        <div className="bg-red-900 h-2 w-full rounded-b" />
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
  if (layout === "band-brown") {
    return (
      <div className="h-full flex flex-col p-0.5">
        <div className={`${imgBox} flex-[3]`} />
        <div className="bg-amber-900 flex-[1] flex items-center justify-center text-[7px] text-amber-100 font-bold px-1 text-center">Recipe Title</div>
        <div className={`${imgBox} flex-[3]`} />
      </div>
    );
  }
  return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type PinDesignerApi = { getJson: () => string; exportPng: () => string | null };

export interface FrameInfo {
  recipeId: string;
  title: string;
  images: string[];
}

export interface PinDesignerProps {
  onClose: () => void;
  templateName?: string;
  initialTitle?: string;
  recipeImages?: string[];
  projectId?: string;
  siteId?: string;
  recipeId?: string;
  recipePinTitle?: string;
  recipePinDescription?: string;
  /** Restore a previously saved canvas JSON (takes priority over initialTemplateId) */
  initialJson?: string;
  /** Auto-apply this template on mount (only if no initialJson) */
  initialTemplateId?: string;
  /** Called once the canvas is ready, exposes getJson/exportPng */
  onApiReady?: (api: PinDesignerApi) => void;
  /** Called when user selects a template, passes the template id */
  onTemplateSelected?: (templateId: string) => void;
  /** When true, renders as absolute fill instead of fixed full-screen */
  embedded?: boolean;
  /** Multiple recipe frames for batch design */
  frames?: FrameInfo[];
  /** Website/domain to display on pin templates that have a website element */
  website?: string;
  /** Override access level — pass true for project admins who have global role "member" */
  canManage?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PinDesigner({
  onClose,
  templateName = "My Pin",
  initialTitle = "Recipe Title",
  recipeImages = [],
  projectId,
  siteId,
  recipeId,
  recipePinTitle,
  recipePinDescription,
  initialJson,
  initialTemplateId,
  onApiReady,
  onTemplateSelected,
  embedded = false,
  frames,
  website = "",
  canManage,
}: PinDesignerProps) {
  // ── Multi-frame state ────────────────────────────────────────────────────
  const router = useRouter();
  const [activeFrameIdx, setActiveFrameIdx] = useState(0);
  const frameJsonsRef = useRef<Record<number, string>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [saveAllProgress, setSaveAllProgress] = useState(0);
  const [framePreviews, setFramePreviews] = useState<Record<number, string>>({});

  // ── Custom fonts (persisted to database) ─────────────────────────────
  const [customFonts, setCustomFonts] = useState<string[]>([]);
  const [fontInput, setFontInput] = useState("");
  const [fontLoading, setFontLoading] = useState(false);
  const fontsLoadedRef = useRef(false);

  const injectFontStylesheet = useCallback((fontName: string): Promise<void> => {
    const family = fontName.replace(/ /g, "+");
    const linkId = `gfont-${family}`;
    const waitForFont = () =>
      document.fonts.load(`400 16px "${fontName}"`).then(() => {}).catch(() => {});
    if (document.getElementById(linkId)) {
      // Stylesheet already injected — just ensure the font bytes are ready
      return waitForFont();
    }
    return new Promise<void>((resolve) => {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@100;200;300;400;500;600;700;800;900&display=swap`;
      link.onload = () => waitForFont().then(resolve);
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });
  }, []);

  // Load saved fonts from database on mount
  useEffect(() => {
    if (fontsLoadedRef.current) return;
    fontsLoadedRef.current = true;
    api.getCustomFonts()
      .then((fonts) => {
        setCustomFonts(fonts);
        fonts.forEach(injectFontStylesheet);
      })
      .catch(() => {});
  }, [injectFontStylesheet]);

  // Load user-created Pin Designer templates (filtered by project if available)
  useEffect(() => {
    api.getPinDesignerTemplates(projectId ?? undefined)
      .then((t) => {
        setCustomTemplates(t as PinTemplate[]);
        // Make all fonts used in loaded templates available in the font dropdown
        // and inject their stylesheets — without saving to DB (session-only).
        const templateFonts = Array.from(new Set(
          t.flatMap((tmpl) =>
            tmpl.elements
              .filter((el) => el.type === "text" && (el as any).fontFamily)
              .map((el) => (el as any).fontFamily as string)
          )
        ));
        if (templateFonts.length > 0) {
          templateFonts.forEach(injectFontStylesheet);
          setCustomFonts((prev) => {
            const extra = templateFonts.filter((f) => !prev.includes(f));
            return extra.length > 0 ? [...prev, ...extra] : prev;
          });
        }
      })
      .catch(() => {});
  }, [projectId, injectFontStylesheet]);

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
      await new Promise((r) => setTimeout(r, 300));
      await document.fonts.ready;
      setCustomFonts((prev) => {
        const next = prev.includes(trimmed) ? prev : [...prev, trimmed];
        saveFontsToDb(next);
        return next;
      });
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
  }, []);

  // Derive effective images/title from frames prop if present
  const activeFrame = frames?.[activeFrameIdx];
  const effectiveImages = activeFrame ? activeFrame.images : recipeImages;
  const effectiveTitle = activeFrame ? activeFrame.title : initialTitle;
  // Route external image URLs through backend proxy to avoid browser CORS restrictions
  const proxyUrl = (url: string) => {
    if (!url) return url;
    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/")) return url;
    if (url.startsWith(window.location.origin)) return url;
    const apiBase = getApiBaseUrl();
    if (apiBase && url.startsWith(apiBase)) return url;
    return `${apiBase}/api/image-proxy?url=${encodeURIComponent(url)}`;
  };

  // ── Canvas refs ──────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);  // scaled canvas wrapper
  const canvasAreaRef = useRef<HTMLDivElement>(null);     // scroll container
  const fabricCanvasRef = useRef<any>(null);
  const fabricLibRef = useRef<any>(null);

  // ── Undo ────────────────────────────────────────────────────────────────
  const undoHistoryRef = useRef<{ json: string; selectedId: string | null }[]>([]);
  const isRestoringRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const activeObjRef = useRef<any>(null);
  const transformSaveDoneRef = useRef(false);
  const imageEditModeIdRef = useRef<string | null>(null);
  // When creating a new custom template, we don't want to re-apply it to the canvas,
  // otherwise we'd lose any "image pan within the frame" edits.
  const skipTemplateAutoApplyRef = useRef(false);

  // ── Zustand store ───────────────────────────────────────────────────────
  const {
    selectedId, setSelectedId,
    layers, setLayers,
    leftTab, setLeftTab,
    canvasW, canvasH, setCanvasDimensions,
    zoom, setZoom,
    textProps, setTextProps,
    bandProps, setBandProps,
    frameProps, setFrameProps,
    imageProps, setImageProps,
    shapeProps, setShapeProps,
    toolbarPos, setToolbarPos,
    resetStore,
  } = useDesignerStore();

  // ── Local UI state ──────────────────────────────────────────────────────
  const toast = useToast();
  const openConfirm = useConfirm();
  const [mounted, setMounted] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [imageEditModeId, setImageEditModeId] = useState<string | null>(null);
  const setEditMode = (id: string | null) => { imageEditModeIdRef.current = id; setImageEditModeId(id); };
  const [selectedTemplate, setSelectedTemplate] = useState<PinTemplate | null>(null);
  const [customTemplates, setCustomTemplates] = useState<PinTemplate[]>([]);
  const allTemplates: PinTemplate[] = customTemplates;
  const currentUserId = getUserId();
  const myTemplates = customTemplates.filter((t) => t.owner_id === currentUserId);
  const sharedTemplates = customTemplates.filter((t) => t.owner_id !== currentUserId);
  const [pinName, setPinName] = useState(templateName);

  // Pinterest
  const [pinterestConnected, setPinterestConnected] = useState(false);
  const [pinterestBoards, setPinterestBoards] = useState<{ id: string; name: string }[]>([]);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [pinSuccessUrl, setPinSuccessUrl] = useState<string | null>(null);
  const [selectedBoard, setSelectedBoard] = useState("");
  const [pinTitle, setPinTitle] = useState(initialTitle);
  const [pinDescription, setPinDescription] = useState("");
  const [pinLink, setPinLink] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [savingToRecipe, setSavingToRecipe] = useState(false);
  const [wpBatchBusy, setWpBatchBusy] = useState<null | "wordpress_scheduled" | "manual_backdate">(null);
  const [wpBatchDone, setWpBatchDone] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvStartDate, setCsvStartDate] = useState(() => {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  });
  const [csvInterval, setCsvInterval] = useState(300);
  const [csvGenerating, setCsvGenerating] = useState(false);
  const [worksheetPreparing, setWorksheetPreparing] = useState(false);
  const [showWpScheduleModal, setShowWpScheduleModal] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateDesc, setSaveTemplateDesc] = useState("");
  const [wpScheduleFirstAt, setWpScheduleFirstAt] = useState(() => {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  });
  const [wpScheduleInterval, setWpScheduleInterval] = useState(240);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  const wpPublishRole = typeof window !== "undefined" ? getUserRole() : null;
  const canPublishWpBatch =
    Boolean(projectId) && (
      canManage === true ||
      wpPublishRole === "owner" ||
      wpPublishRole === "admin"
    );

  // ── Frame switching ──────────────────────────────────────────────────────
  const switchToFrame = async (newIdx: number) => {
    if (!frames || newIdx === activeFrameIdx || newIdx < 0 || newIdx >= frames.length) return;
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Save current frame JSON
    frameJsonsRef.current[activeFrameIdx] = JSON.stringify(
      canvas.toObject(["__pinId", "__pinLabel", "__pinType", "__isLabel", "__forId", "__strokeStyle", "__pinLocked", "__designerBorder", "__forPinId", "__flipX"])
    );

    // Generate preview of current frame before switching
    try {
      canvas.getObjects().filter((o: any) => o.__isLabel || o.__designerBorder).forEach((o: any) => o.set("visible", false));
      canvas.renderAll();
      const preview = canvas.toDataURL({ format: "png", multiplier: 0.5 });
      canvas.getObjects().filter((o: any) => o.__isLabel || o.__designerBorder).forEach((o: any) => o.set("visible", true));
      canvas.renderAll();
      setFramePreviews((prev) => ({ ...prev, [activeFrameIdx]: preview }));
    } catch { /* skip */ }

    setActiveFrameIdx(newIdx);
    setPinName(frames[newIdx].title);

    const savedJson = frameJsonsRef.current[newIdx];
    if (savedJson && savedJson !== "{}") {
      await canvas.loadFromJSON(savedJson);
      normalizeCanvasObjectMetadata();
      canvas.renderAll();
      updateLayers();
    } else if (selectedTemplate) {
      await loadTemplate(selectedTemplate, frames[newIdx].images, frames[newIdx].title);
    } else {
      canvas.clear();
      canvas.renderAll();
      updateLayers();
    }
  };

  const generateAllFramePreviews = async (template: PinTemplate) => {
    if (!frames || frames.length <= 1) return;
    const fabricMod = await import("fabric");
    const proxyBase = getApiBaseUrl();
    const newPreviews: Record<number, string> = {};
    const tmplW = template.canvasWidth || PIN_W;
    const tmplH = template.canvasHeight || PIN_H;

    for (let i = 0; i < frames.length; i++) {
      if (i === activeFrameIdx) continue;
      const frame = frames[i];
      const savedJson = frameJsonsRef.current[i];
      const canvasEl = document.createElement("canvas");
      canvasEl.width = tmplW;
      canvasEl.height = tmplH;
      canvasEl.style.display = "none";
      document.body.appendChild(canvasEl);

      try {
        const FC = (fabricMod as any).Canvas || (fabricMod as any).default?.Canvas;
        const fc = new FC(canvasEl, { width: tmplW, height: tmplH, enableRetinaScaling: false });

        if (savedJson && savedJson !== "{}") {
          await fc.loadFromJSON(savedJson);
        } else {
          await buildTemplateOnCanvas(fabricMod, fc, template, frame.images, proxyBase, frame.title, website);
        }

        fc.getObjects().filter((o: any) => o.__isLabel || o.__designerBorder).forEach((o: any) => o.set("visible", false));
        fc.renderAll();
        newPreviews[i] = fc.toDataURL({ format: "png", multiplier: 0.5 });
        fc.dispose();
      } catch { /* skip */ } finally {
        document.body.removeChild(canvasEl);
      }
    }

    setFramePreviews((prev) => ({ ...prev, ...newPreviews }));
  };

  const savePinToRecipeWithArticleEmbed = useCallback(
    async (
      rid: string,
      dataUrl: string,
      titleAlt: string,
      extra?: { pin_title?: string; pin_description?: string }
    ) => {
      const full = await api.getRecipe(rid);
      const nextArticle = appendPinImageToArticleHtml(full.generated_article ?? "", dataUrl, {
        alt: titleAlt,
      });
      await api.updateRecipe(rid, {
        pin_design_image: dataUrl,
        pin_template_id: selectedTemplate?.id,
        generated_article: nextArticle,
        ...(extra?.pin_title !== undefined ? { pin_title: extra.pin_title } : {}),
        ...(extra?.pin_description !== undefined ? { pin_description: extra.pin_description } : {}),
      });
    },
    [selectedTemplate?.id]
  );

  // Shared: render every frame, save pin image to recipe (embed in article), optionally download
  const saveAllFrames = async (download: boolean) => {
    if (!frames || frames.length === 0) return;
    const canvas = fabricCanvasRef.current;
    if (canvas) {
      frameJsonsRef.current[activeFrameIdx] = JSON.stringify(
        canvas.toObject(["__pinId", "__pinLabel", "__pinType", "__isLabel", "__forId", "__strokeStyle", "__pinLocked", "__designerBorder", "__forPinId", "__flipX"])
      );
    }
    setSavingAll(true);
    setSaveAllProgress(0);

    const fabricMod = await import("fabric");
    const proxyBase = getApiBaseUrl();
    const tmplW = selectedTemplate?.canvasWidth || PIN_W;
    const tmplH = selectedTemplate?.canvasHeight || PIN_H;

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const savedJson = frameJsonsRef.current[i];
      setSaveAllProgress(Math.round(((i + 0.5) / frames.length) * 100));

      let dataUrl: string | null = null;
      const canvasEl = document.createElement("canvas");
      canvasEl.width = tmplW;
      canvasEl.height = tmplH;
      document.body.appendChild(canvasEl);

      try {
        const FC = (fabricMod as any).Canvas || (fabricMod as any).default?.Canvas;
        const fc = new FC(canvasEl, { width: tmplW, height: tmplH, enableRetinaScaling: false });

        if (savedJson && savedJson !== "{}") {
          await fc.loadFromJSON(savedJson);
          fc.renderAll();
        } else if (selectedTemplate) {
          await buildTemplateOnCanvas(fabricMod, fc, selectedTemplate, frame.images, proxyBase, frame.title, website);
        }

        fc.getObjects().filter((o: any) => o.__isLabel || o.__designerBorder).forEach((o: any) => o.set("visible", false));
        fc.renderAll();
        dataUrl = fc.toDataURL({ format: "png", multiplier: 1 });
        fc.dispose();
      } catch { /* skip */ } finally {
        document.body.removeChild(canvasEl);
      }

      if (dataUrl) {
        // Save pin image embedded in article HTML (after Conclusion, before WPRM recipe card)
        if (frame.recipeId) {
          try {
            await savePinToRecipeWithArticleEmbed(frame.recipeId, dataUrl, frame.title);
          } catch { /* skip */ }
        }
        if (download) {
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `pin-${String(i + 1).padStart(2, "0")}-${frame.title.replace(/[^a-z0-9]/gi, "_").slice(0, 30)}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          await new Promise((r) => setTimeout(r, 350));
        }
      }
    }
    setSaveAllProgress(100);
    setSavingAll(false);
  };

  const handleSaveAll = () => saveAllFrames(true);

  const runWordPressBatchFromDesigner = async (
    mode: "wordpress_scheduled" | "manual_backdate",
    opts?: { first_publish_at?: string; interval_minutes?: number }
  ) => {
    if (!projectId) return;
    setWpBatchBusy(mode);
    try {
      // 1. Save all pin designs into their recipes first (embed image in article after Conclusion)
      if (frames && frames.length > 0) {
        await saveAllFrames(false);
      } else if (recipeId) {
        // Single recipe mode — save current canvas pin into article
        const data = getExportDataUrl();
        if (data) {
          await savePinToRecipeWithArticleEmbed(recipeId, data, recipePinTitle || initialTitle || "Recipe");
        }
      }
      // 2. WordPress batch — scoped to siteId when available so only this site's recipes are published.
      const res = await api.publishBatchToWordPress(projectId, { mode, ...opts, ...(siteId ? { site_id: siteId } : {}) });
      toast.info(`Publishing ${res.total} recipes in background. Refresh in a few minutes.`);
      if (res.total > 0) setWpBatchDone(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Batch publish failed");
    } finally {
      setWpBatchBusy(null);
    }
  };

  // ── Mount ────────────────────────────────────────────────────────────────
  useEffect(() => { setMounted(true); }, []);

  // Preload fonts
  useEffect(() => {
    const fonts = ["Triumvirate Compressed", "Quintus Regular", "Penumbra Sans Std"];
    Promise.all(fonts.map((f) => document.fonts.load(`16px "${f}"`))).catch(() => {});
  }, []);

  useEffect(() => {
    if (projectId) checkPinterestStatus();
  }, [projectId]);

  // ── Pinterest ────────────────────────────────────────────────────────────

  const checkPinterestStatus = async () => {
    if (!projectId) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${getApiBaseUrl()}/pinterest/status?project_id=${projectId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setPinterestConnected(data.connected);
        if (data.connected) fetchPinterestBoards();
      }
    } catch (err) {
      console.error("Failed to check Pinterest status:", err);
    }
  };

  const fetchPinterestBoards = async () => {
    if (!projectId) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${getApiBaseUrl()}/pinterest/boards?project_id=${projectId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const boards = await res.json();
        setPinterestBoards(boards);
        if (boards.length > 0) setSelectedBoard(boards[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch boards:", err);
    }
  };

  const connectPinterest = async () => {
    if (!projectId) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${getApiBaseUrl()}/pinterest/auth-url?project_id=${projectId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("pinterest_oauth_project_id", projectId);
        localStorage.setItem("pinterest_oauth_state", data.state);
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Failed to get Pinterest auth URL:", err);
    }
  };

  const publishToPinterest = async (imageDataUrl: string) => {
    if (!projectId || !selectedBoard) return;
    setPublishing(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${getApiBaseUrl()}/pinterest/create-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          project_id: projectId,
          board_id: selectedBoard,
          image_url: imageDataUrl,
          title: pinTitle,
          description: pinDescription,
          link: pinLink,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowPublishModal(false);
        setPinSuccessUrl(data.pin_url || null);
      } else {
        toast.error(`Failed: ${data.error}`);
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  // ── Canvas helpers ────────────────────────────────────────────────────────

  const extractTemplateElementsFromCanvas = (): TemplateElement[] => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return [];

    const objs: any[] = canvas.getObjects?.() || [];
    const elements: TemplateElement[] = [];

    for (const o of objs) {
      if (!o) continue;
      if (o.__isLabel) continue;
      const pinId = o.__pinId;
      if (!pinId) continue;

      const pinType = o.__pinType;
      const label: string = o.__pinLabel || pinId;

      // Skip internal image content objects — their zone is captured via imageFrame
      if (pinType === "imageContent") continue;

      // Only persist element types supported by the template loader.
      if (pinType === "image") {
        // Old-style placeholder rect (no image loaded)
        let x = typeof o.left === "number" ? o.left : 0;
        let y = typeof o.top === "number" ? o.top : 0;
        let width = typeof o.width === "number" ? o.width * (o.scaleX ?? 1) : 0;
        let height = typeof o.height === "number" ? o.height * (o.scaleY ?? 1) : 0;
        let bgColor: string | undefined = typeof o.fill === "string" ? o.fill : undefined;

        if (o.clipPath && typeof o.clipPath.left === "number" && typeof o.clipPath.top === "number") {
          const clip = o.clipPath;
          x = clip.left ?? x;
          y = clip.top ?? y;
          width = typeof clip.width === "number" ? clip.width : width;
          height = typeof clip.height === "number" ? clip.height : height;
          bgColor = bgColor || "#e0e0e0";
        }

        elements.push({ id: String(pinId), type: "image", label, x, y, width, height, bgColor, flipX: !!(o as any).flipX });
      } else if (pinType === "imageFrame") {
        // New-style: frame rect position IS the zone bounds
        elements.push({
          id: String(pinId),
          type: "image",
          label,
          x: typeof o.left === "number" ? o.left : 0,
          y: typeof o.top === "number" ? o.top : 0,
          width: typeof o.width === "number" ? o.width * (o.scaleX ?? 1) : 0,
          height: typeof o.height === "number" ? o.height * (o.scaleY ?? 1) : 0,
          bgColor: "#e0e0e0",
          flipX: !!(o as any).__flipX,
        });
      } else if (pinType === "text") {
        elements.push({
          id: String(pinId),
          type: "text",
          label,
          x: typeof o.left === "number" ? o.left : 0,
          y: typeof o.top === "number" ? o.top : 0,
          width: typeof o.width === "number" ? o.width : 940,
          height: typeof o.height === "number" ? o.height : 0,
          defaultText: o.text ?? "",
          fontFamily: o.fontFamily != null ? String(o.fontFamily) : undefined,
          fontSize: typeof o.fontSize === "number" ? o.fontSize : undefined,
          fontWeight: o.fontWeight != null ? String(o.fontWeight) : undefined,
          fontStyle: o.fontStyle != null ? String(o.fontStyle) : undefined,
          fill: typeof o.fill === "string" ? o.fill : undefined,
          textAlign: o.textAlign != null ? String(o.textAlign) : undefined,
        });
      } else if (pinType === "band") {
        const isCircle = o.type === "circle";
        if (isCircle) {
          const radius = typeof o.radius === "number" ? o.radius : 60;
          const diameter = radius * 2;
          elements.push({
            id: String(pinId),
            type: "circle",
            label,
            x: typeof o.left === "number" ? o.left : 0,
            y: typeof o.top === "number" ? o.top : 0,
            width: diameter,
            height: diameter,
            radius,
            bgColor: typeof o.fill === "string" ? o.fill : undefined,
          });
        } else {
          elements.push({
            id: String(pinId),
            type: "band",
            label,
            x: typeof o.left === "number" ? o.left : 0,
            y: typeof o.top === "number" ? o.top : 0,
            width: typeof o.width === "number" ? o.width * (o.scaleX ?? 1) : 0,
            height: typeof o.height === "number" ? o.height * (o.scaleY ?? 1) : 0,
            bgColor: typeof o.fill === "string" ? o.fill : undefined,
          });
        }
      }
    }

    // Keep bottom-most element last so the loader's stretch logic works better.
    elements.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.height ?? 0) - (b.height ?? 0));
    return elements;
  };

  const extractCanvasBgColor = (): string => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return "#ffffff";
    const bg = canvas.backgroundColor;
    return typeof bg === "string" ? bg : "#ffffff";
  };

  const handleSaveCurrentAsTemplate = () => {
    setSaveTemplateName("");
    setSaveTemplateDesc("");
    setShowSaveTemplateModal(true);
  };

  const handleSaveCurrentAsTemplateSubmit = async () => {
    const name = saveTemplateName.trim();
    if (!name) return;

    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const elements = extractTemplateElementsFromCanvas();
    if (!elements.length) {
      toast.warning("No supported elements found on the canvas. Add image/text/band/circle and try again.");
      setShowSaveTemplateModal(false);
      return;
    }

    try {
      const created = await api.createPinDesignerTemplate({
        name,
        description: saveTemplateDesc.trim() || null,
        bgColor: extractCanvasBgColor(),
        elements: elements as any,
      });

      skipTemplateAutoApplyRef.current = true;
      setCustomTemplates((prev) => [created as unknown as PinTemplate, ...prev]);
      setSelectedTemplate(created as unknown as PinTemplate);
      onTemplateSelected?.(created.id);
      setPinName(name);
      setShowSaveTemplateModal(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save template");
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!await openConfirm({ message: "Delete this template?", danger: true, confirmLabel: "Delete" })) return;
    try {
      await api.deletePinDesignerTemplate(templateId);
      setCustomTemplates((prev) => prev.filter((t) => t.id !== templateId));
      if (selectedTemplate?.id === templateId) setSelectedTemplate(null);
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete template");
    }
  };

  const getExportDataUrl = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return null;
    canvas.getObjects().filter((o: any) => o.__isLabel || o.__designerBorder).forEach((o: any) => o.set("visible", false));
    canvas.renderAll();
    const data = canvas.toDataURL({ format: "png", multiplier: 1 });
    canvas.getObjects().filter((o: any) => o.__isLabel || o.__designerBorder).forEach((o: any) => o.set("visible", true));
    canvas.renderAll();
    return data;
  };

  const handleExport = () => {
    const data = getExportDataUrl();
    if (!data) return;
    const a = document.createElement("a");
    a.href = data;
    a.download = `${pinName.replace(/[^a-z0-9]/gi, "_")}_pin.png`;
    a.click();
  };

  const handlePublish = () => {
    const data = getExportDataUrl();
    if (data) publishToPinterest(data);
  };

  const buildPinterestWorksheetRowsFromFrames = useCallback(async (): Promise<string[][]> => {
    if (!frames || frames.length === 0) return [];

    // Fetch fresh recipe data for all frames to keep worksheet/CSV aligned with latest recipe metadata.
    const recipes = await Promise.all(
      frames.map((f) => api.getRecipe(f.recipeId).catch(() => null)),
    );

    const worksheetRecipes: PinterestWorksheetRecipe[] = recipes.map((r) => {
      if (!r) {
        return {
          siteId: siteId ?? "",
          pinTitle: "",
          recipeText: "",
          pinDesignImage: null,
          pinBoard: null,
          pinDescription: null,
          wpPermalink: null,
          pinTags: null,
        };
      }

      return {
        siteId: r.site_id || siteId || "",
        pinTitle: r.pin_title,
        recipeText: r.recipe_text || "",
        pinDesignImage: r.pin_design_image,
        pinBoard: r.pin_board,
        pinDescription: r.pin_description,
        wpPermalink: r.wp_permalink,
        pinTags: r.pin_tags,
      };
    });

    const resolveMediaUrl = async (recipe: PinterestWorksheetRecipe): Promise<string> => {
      const pinDesignImage = recipe.pinDesignImage;
      if (pinDesignImage?.startsWith("data:") && recipe.siteId) {
        try {
          return await api.uploadPinImageToServer(recipe.siteId, pinDesignImage);
        } catch {
          return "";
        }
      }
      return "";
    };

    return buildPinterestWorksheetRows(
      worksheetRecipes,
      csvStartDate,
      csvInterval,
      resolveMediaUrl,
    );
  }, [csvInterval, csvStartDate, frames, siteId]);

  const downloadPinterestCsv = async () => {
    if (!frames || frames.length === 0) return;
    setCsvGenerating(true);
    try {
      const rows = await buildPinterestWorksheetRowsFromFrames();
      const csvContent = rowsToCsv(PINTEREST_WORKSHEET_HEADER, rows);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pinterest-pins-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowCsvModal(false);

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "CSV generation failed");
    } finally {
      setCsvGenerating(false);
    }
  };

  const openPinterestWorksheet = async () => {
    if (!frames || frames.length === 0) return;
    setWorksheetPreparing(true);
    try {
      const rows = await buildPinterestWorksheetRowsFromFrames();
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

  const handleSaveToRecipe = async () => {
    if (!recipeId) return;
    const data = getExportDataUrl();
    if (!data) return;
    setSavingToRecipe(true);
    try {
      await savePinToRecipeWithArticleEmbed(recipeId, data, recipePinTitle || initialTitle, {
        pin_title: recipePinTitle || initialTitle,
        pin_description: recipePinDescription || initialTitle,
      });
      toast.success("Design saved to recipe. The pin image was added near the end of the generated article HTML.");
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSavingToRecipe(false);
    }
  };

  // ── Toolbar position (floating toolbar above selected object) ────────────

  const recalcToolbarPos = useCallback((obj?: any) => {
    const wrapper = canvasWrapperRef.current;
    const canvas = fabricCanvasRef.current;
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
  }, [zoom, setToolbarPos]);

  // ── Selection sync ────────────────────────────────────────────────────────
  // Single function used by both selection:created and selection:updated

  const syncSelectionFromObject = useCallback((obj: any) => {
    if (!obj?.__pinId) return;
    selectedIdRef.current = obj.__pinId;
    activeObjRef.current = obj;
    setSelectedId(obj.__pinId);

    if (obj.__pinType === "text") {
      setTextProps({
        editText: obj.__rawText ?? obj.text ?? "",
        fontFamily: obj.fontFamily ?? "Arial",
        fontSize: obj.fontSize ?? 32,
        fontWeight: obj.fontWeight ?? "normal",
        textAlign: obj.textAlign ?? "center",
        textColor: obj.fill ?? "#333333",
        textTransform: obj.__textTransform ?? "none",
      });
    } else if (obj.__pinType === "frame") {
      setFrameProps({
        strokeWidth: obj.strokeWidth ?? 4,
        strokeColor: obj.stroke ?? "#333333",
        strokeStyle: obj.__strokeStyle ?? "solid",
        rx: obj.rx ?? 0,
      });
    } else if (obj.__pinType === "band") {
      const fill = typeof obj.fill === "string" ? obj.fill : "#ffffff";
      const parsed = rgbaToHex(fill);
      setBandProps({ bandFill: parsed.hex, bandOpacity: parsed.alpha });
    } else if (obj.__pinType === "image" || obj.__pinType === "imageFrame" || obj.__pinType === "imageContent") {
      setImageProps({
        left: Math.round(obj.left ?? 0),
        top: Math.round(obj.top ?? 0),
        width: Math.round((obj.width ?? 0) * (obj.scaleX ?? 1)),
        height: Math.round((obj.height ?? 0) * (obj.scaleY ?? 1)),
        angle: Math.round(obj.angle ?? 0),
      });
    } else if (obj.__pinType === "shape") {
      const fill = typeof obj.fill === "string" ? obj.fill : "#6366f1";
      setShapeProps({
        fill,
        strokeColor: obj.stroke ?? "#333333",
        strokeWidth: obj.strokeWidth ?? 0,
        opacity: Math.round((obj.opacity ?? 1) * 100),
      });
    }

    recalcToolbarPos(obj);
  }, [setSelectedId, setTextProps, setBandProps, setFrameProps, setImageProps, setShapeProps, recalcToolbarPos]);

  // ── Undo ─────────────────────────────────────────────────────────────────

  const MAX_UNDO = 50;

  // Fabric v6: toJSON() ignores propertiesToInclude — must use toObject() to include custom keys
  const UNDO_CUSTOM_KEYS = ["__pinId", "__pinLabel", "__pinType", "__isLabel", "__forId", "__strokeStyle", "__flipX", "__textTransform", "__rawText", "__pinLocked", "__designerBorder", "__forPinId"];

  const saveUndoState = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || isRestoringRef.current) return;
    try {
      const json = JSON.stringify(canvas.toObject(UNDO_CUSTOM_KEYS));
      const history = undoHistoryRef.current;
      history.push({ json, selectedId: selectedIdRef.current });
      if (history.length > MAX_UNDO) history.shift();
    } catch {}
  };

  const performUndo = async () => {
    if (isRestoringRef.current) return;
    const canvas = fabricCanvasRef.current;
    if (!canvas || undoHistoryRef.current.length === 0) return;

    const entry = undoHistoryRef.current.pop()!;
    isRestoringRef.current = true;

    let ok = false;

    try {
      // Parse first so we have the saved custom props for post-load restoration
      const savedData = JSON.parse(entry.json);
      const savedObjs: any[] = savedData.objects || [];

      await canvas.loadFromJSON(entry.json);

      // Post-load: restore custom properties by matching type + position.
      // Needed because Fabric v6 toJSON() ignores propertiesToInclude — we use
      // toObject() when saving, but loadFromJSON does not auto-restore unknown keys.
      const remaining = [...savedObjs];
      (canvas.getObjects() as any[]).forEach((canvasObj) => {
        const idx = remaining.findIndex((s) =>
          s.type === canvasObj.type &&
          Math.abs((s.left ?? 0) - (canvasObj.left ?? 0)) < 1 &&
          Math.abs((s.top ?? 0) - (canvasObj.top ?? 0)) < 1
        );
        if (idx !== -1) {
          UNDO_CUSTOM_KEYS.forEach((k) => {
            if (remaining[idx][k] !== undefined) canvasObj[k] = remaining[idx][k];
          });
          remaining.splice(idx, 1);
        }
      });

      const objs = canvas.getObjects().filter((o: any) => o.__pinId && !o.__isLabel && !o.__designerBorder);
      objs.forEach((o: any) => applyLockState(o));
      setLayers(objs.map((o: any) => ({ id: o.__pinId, label: o.__pinLabel || o.__pinId, type: o.__pinType, locked: !!o.__pinLocked })));
      ok = true;
    } catch {
      undoHistoryRef.current.push(entry);
    }

    if (!ok) {
      isRestoringRef.current = false;
      return;
    }

    // Find the previously selected object (now correctly tagged via reviver)
    const prevId = entry.selectedId;
    const restoredObj = prevId
      ? (canvas.getObjects().find((o: any) => o.__pinId === prevId) as any)
      : null;

    if (restoredObj) {
      // setActiveObject fires selection:created which is still blocked by isRestoringRef.
      // We update all state inline here to avoid any stale-closure issues.
      canvas.setActiveObject(restoredObj);
      canvas.renderAll();

      selectedIdRef.current = restoredObj.__pinId;
      setSelectedId(restoredObj.__pinId);

      if (restoredObj.__pinType === "text") {
        setTextProps({
          editText: restoredObj.__rawText ?? restoredObj.text ?? "",
          fontFamily: restoredObj.fontFamily ?? "Arial",
          fontSize: restoredObj.fontSize ?? 32,
          fontWeight: restoredObj.fontWeight ?? "normal",
          textAlign: restoredObj.textAlign ?? "center",
          textColor: restoredObj.fill ?? "#333333",
          textTransform: restoredObj.__textTransform ?? "none",
        });
      } else if (restoredObj.__pinType === "frame") {
        setFrameProps({
          strokeWidth: restoredObj.strokeWidth ?? 4,
          strokeColor: restoredObj.stroke ?? "#333333",
          strokeStyle: restoredObj.__strokeStyle ?? "solid",
          rx: restoredObj.rx ?? 0,
        });
      } else if (restoredObj.__pinType === "band") {
        const fill = typeof restoredObj.fill === "string" ? restoredObj.fill : "#ffffff";
        const parsed = rgbaToHex(fill);
        setBandProps({ bandFill: parsed.hex, bandOpacity: parsed.alpha });
      } else if (restoredObj.__pinType === "image") {
        setImageProps({
          left: Math.round(restoredObj.left ?? 0),
          top: Math.round(restoredObj.top ?? 0),
          width: Math.round((restoredObj.width ?? 0) * (restoredObj.scaleX ?? 1)),
          height: Math.round((restoredObj.height ?? 0) * (restoredObj.scaleY ?? 1)),
          angle: Math.round(restoredObj.angle ?? 0),
        });
      }

      // Compute toolbar position with fresh zoom from store (avoids stale closure)
      const wrapper = canvasWrapperRef.current;
      if (wrapper) {
        const bound = restoredObj.getBoundingRect(true, true);
        const wRect = wrapper.getBoundingClientRect();
        const zf = useDesignerStore.getState().zoom / 100;
        setToolbarPos({
          x: wRect.left + (bound.left + bound.width / 2) * zf,
          y: wRect.top + bound.top * zf,
        });
      }
    } else {
      canvas.discardActiveObject();
      canvas.renderAll();
      selectedIdRef.current = null;
      setSelectedId(null);
      setTextProps({ editText: "" });
      setToolbarPos(null);
    }

    // Release lock last — after all state is committed
    isRestoringRef.current = false;
  };

  // ── Layer helpers ─────────────────────────────────────────────────────────

  const updateLayers = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const objs = canvas.getObjects().filter((o: any) =>
      o.__pinId &&
      !o.__isLabel &&
      !o.__designerBorder &&
      o.__pinType !== "imageContent" // internal — represented by its imageFrame
    );
    setLayers(objs.map((o: any) => ({ id: o.__pinId, label: o.__pinLabel || o.__pinId, type: o.__pinType, locked: !!o.__pinLocked })));
  };

  const applyLockState = (obj: any) => {
    const locked = !!obj.__pinLocked;
    if (obj.__pinType === "imageContent") return;
    obj.set({
      lockMovementX: locked,
      lockMovementY: locked,
      lockRotation: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      hasControls: !locked,
    });
  };

  const toggleLock = (id: string) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    // Prefer imageFrame over imageContent when both share the same __pinId
    const obj = (canvas.getObjects().find((o: any) => o.__pinId === id && o.__pinType !== "imageContent")
      ?? canvas.getObjects().find((o: any) => o.__pinId === id)) as any;
    if (!obj) return;
    obj.__pinLocked = !obj.__pinLocked;
    applyLockState(obj);
    canvas.renderAll();
    updateLayers();
    saveUndoState();
  };

  // Repair old JSON objects missing pin metadata so selection/properties keep working.
  const normalizeCanvasObjectMetadata = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const objs = canvas.getObjects() as any[];
    objs.forEach((o, idx) => {
      if (o.__isLabel || o.__designerBorder) return;
      if (!o.__pinType) {
        if (o.type === "textbox") o.__pinType = "text";
        else if (o.type === "image") o.__pinType = "imageContent";
        else if (o.type === "circle") o.__pinType = "shape";
        else if (o.type === "rect") o.__pinType = "band";
      }
      if (!o.__pinId) o.__pinId = `${o.__pinType || o.type || "obj"}_${idx}_${Date.now()}`;
      if (!o.__pinLabel) {
        if (o.__pinType === "text") o.__pinLabel = "Text";
        else if (o.__pinType === "image") o.__pinLabel = "Image";
        else if (o.__pinType === "imageFrame") o.__pinLabel = "Image";
        else if (o.__pinType === "imageContent") o.__pinLabel = "Image";
        else if (o.__pinType === "band") o.__pinLabel = "Band";
        else if (o.__pinType === "shape") o.__pinLabel = "Shape";
        else o.__pinLabel = o.__pinId;
      }
      // Reapply lock constraints (lost after loadFromJSON)
      applyLockState(o);

      // Restore absolutePositioned + ensure non-selectable for imageContent objects
      if (o.__pinType === "imageContent" && o.clipPath) {
        o.clipPath.absolutePositioned = true;
        o.selectable = false;
        o.evented = false;
        o.hasControls = false;
        o.hasBorders = false;
      }
    });

    // Re-link imageFrame ↔ imageContent pairs (links are lost across JSON round-trips)
    const frameObjs = objs.filter((o: any) => o.__pinType === "imageFrame");
    const contentObjs = objs.filter((o: any) => o.__pinType === "imageContent");
    frameObjs.forEach((frame: any) => {
      const content = contentObjs.find((c: any) => c.__pinId === frame.__pinId);
      if (content) {
        frame.__linkedImg = content;
        content.__frameRect = frame;
      }
    });
  };

  const getSelectedObject = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return null;
    const active = canvas.getActiveObject();
    if (active && (active as any).__pinId) return active as any;
    if ((active as any)?._objects?.length === 1) return (active as any)._objects[0];
    // Ref-tracked object is always up-to-date (set synchronously in syncSelectionFromObject)
    if (activeObjRef.current?.__pinId) return activeObjRef.current;
    const currentId = selectedIdRef.current || selectedId;
    if (currentId) {
      const obj = canvas.getObjects().find((o: any) => o.__pinId === currentId);
      if (obj) return obj;
    }
    return null;
  };

  // ── Designer border overlay helper ────────────────────────────────────────

  const addDesignerBorder = (fabric: any, canvas: any, x: number, y: number, w: number, h: number, forPinId?: string) => {
    const border = new fabric.Rect({
      left: x,
      top: y,
      width: w,
      height: h,
      fill: "transparent",
      stroke: "#aaaaaa",
      strokeWidth: 2,
      strokeDashArray: [10, 6],
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
      objectCaching: false,
    });
    (border as any).__designerBorder = true;
    if (forPinId) (border as any).__forPinId = forPinId;
    canvas.add(border);
    // Keep guide overlays above content layers so zone boundaries remain visible.
    canvas.bringObjectToFront(border);
    return border;
  };

  /** Update a designer border's position/size to match its linked element's bounding box. */
  const syncDesignerBorder = (canvas: any, obj: any) => {
    if (!obj.__pinId) return;
    const border = canvas.getObjects().find((o: any) => o.__designerBorder && o.__forPinId === obj.__pinId);
    if (!border) return;

    // For clipped image zones, keep the guide border anchored to the clip frame
    // (the zone), not to the oversized image bounds used for panning.
    const clip = obj.clipPath;
    if (
      obj.__pinType === "image" &&
      clip &&
      clip.absolutePositioned &&
      typeof clip.left === "number" &&
      typeof clip.top === "number" &&
      typeof clip.width === "number" &&
      typeof clip.height === "number"
    ) {
      border.set({
        left: clip.left,
        top: clip.top,
        width: clip.width,
        height: clip.height,
      });
      border.setCoords();
      canvas.bringObjectToFront(border);
      return;
    }

    const br = obj.getBoundingRect(true);
    border.set({ left: br.left, top: br.top, width: br.width, height: br.height });
    border.setCoords();
    canvas.bringObjectToFront(border);
  };

  // ── Template loading ──────────────────────────────────────────────────────

  const loadTemplate = async (template: PinTemplate, imagesOverride?: string[], titleOverride?: string, websiteOverride?: string) => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;

    // Wait for every font used in this template to be fully downloaded before
    // building canvas objects — prevents the first-load fallback-font flash.
    const templateFonts = Array.from(new Set(
      template.elements
        .filter((el) => el.type === "text" && (el as any).fontFamily)
        .map((el) => (el as any).fontFamily as string)
    ));
    if (templateFonts.length > 0) {
      await Promise.all(templateFonts.map(injectFontStylesheet));
    }

    const imgs = imagesOverride ?? effectiveImages;
    const ttl = titleOverride ?? effectiveTitle;
    const siteWebsite = websiteOverride ?? website;
    const isCustomTemplateId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(template.id || "")
    );
    const shouldAutoStretchLastElement = !isCustomTemplateId;

    // Resize canvas if custom template has different dimensions
    const tmplW = template.canvasWidth || PIN_W;
    const tmplH = template.canvasHeight || PIN_H;
    if (canvas.width !== tmplW || canvas.height !== tmplH) {
      canvas.setWidth(tmplW);
      canvas.setHeight(tmplH);
    }
    // Always sync store so the CSS wrapper dimensions update
    setCanvasDimensions(tmplW, tmplH);

    undoHistoryRef.current = [];
    canvas.clear();
    canvas.backgroundColor = template.bgColor;

    const { Rect, FabricText } = fabric;
    let imageIndex = 0;

    for (const el of template.elements) {
      if (el.type === "asset" && (el as any).imageUrl) {
        // Restore uploaded image asset
        try {
          const img = await fabric.FabricImage.fromURL((el as any).imageUrl, { crossOrigin: "anonymous" });
          img.set({
            left: el.x ?? 0,
            top: el.y ?? 0,
            originX: "left",
            originY: "top",
            scaleX: el.width / (img.width || 1),
            scaleY: el.height / (img.height || 1),
            flipX: (el as any).flipX ?? false,
            flipY: (el as any).flipY ?? false,
          });
          (img as any).__pinId = el.id;
          (img as any).__pinType = "image";
          (img as any).__pinLabel = el.label || "Image";
          applyLockState(img);
          canvas.add(img);
        } catch { /* ignore broken images */ }
        continue;
      }
      if (el.type === "image") {
        const legacyAssetId = String(el.id || "");
        if (legacyAssetId.startsWith("bg_") || legacyAssetId.startsWith("img_")) {
          continue;
        }
        const imageUrl = imgs.length > 0 ? (imgs[imageIndex % imgs.length]?.trim() || "") : "";
        imageIndex++;
        let imageLoaded = false;

        if (imageUrl) {
          try {
            const img = await fabric.FabricImage.fromURL(proxyUrl(imageUrl), { crossOrigin: "anonymous" });
            const zoneW = el.width;
            const zoneH = el.height;
            const imgW = img.width || 1;
            const imgH = img.height || 1;

            // Cover fit + a small overflow margin so users can pan both axes.
            const panMarginPx = Math.max(24, Math.min(zoneW, zoneH) * 0.06);
            const scale = Math.max(
              zoneW / imgW,
              zoneH / imgH,
              (zoneW + panMarginPx) / imgW,
              (zoneH + panMarginPx) / imgH
            );
            const shouldFlip = (el as any).flipX === true;
            img.set({
              left: el.x + zoneW / 2,
              top: el.y + zoneH / 2,
              originX: "center",
              originY: "center",
              scaleX: scale,
              scaleY: scale,
              flipX: shouldFlip,
              selectable: false,
              evented: false,
              hasControls: false,
              hasBorders: false,
            });

            (img as any).__pinId = el.id;
            (img as any).__pinLabel = el.label;
            (img as any).__pinType = "imageContent";
            (img as any).__pinLocked = !!(el as any).locked;

            // Clip image to zone bounds
            const clipRect = new fabric.Rect({
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              absolutePositioned: true,
              fill: "",
            });
            (img as any).clipPath = clipRect;

            // Transparent interactive frame rect on top — this is what the user clicks/moves
            const frameRect = new Rect({
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              fill: "transparent",
              stroke: "#666",
              strokeWidth: 1,
              strokeDashArray: [8, 5],
              strokeUniform: true,
              originX: "left",
              originY: "top",
              selectable: true,
              evented: true,
              hasControls: false,
              hasBorders: true,
              borderColor: "#6366f1",
              objectCaching: false,
            });
            (frameRect as any).__pinId = el.id;
            (frameRect as any).__pinLabel = el.label || "Image";
            (frameRect as any).__pinType = "imageFrame";
            (frameRect as any).__pinLocked = !!(el as any).locked;
            (frameRect as any).__flipX = shouldFlip;
            (frameRect as any).__linkedImg = img;
            (img as any).__frameRect = frameRect;
            applyLockState(frameRect);

            canvas.add(img);       // content behind
            canvas.add(frameRect); // frame on top — intercepts clicks
            imageLoaded = true;
          } catch {
            // fall through to placeholder
          }
        }

        if (!imageLoaded) {
          const rect = new Rect({
            left: el.x,
            top: el.y,
            width: el.width,
            height: el.height,
            fill: el.bgColor || "#e0e0e0",
            rx: 0,
            ry: 0,
            selectable: true,
            strokeWidth: 0,
            stroke: "transparent",
          });
          (rect as any).__pinId = el.id;
          (rect as any).__pinLabel = el.label;
          (rect as any).__pinType = "image";
          (rect as any).__pinLocked = !!(el as any).locked;
          applyLockState(rect);
          canvas.add(rect);
          addDesignerBorder(fabric, canvas, el.x, el.y, el.width, el.height, el.id);

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
        }
      } else if (el.type === "circle") {
        const circle = new fabric.Circle({
          left: el.x,
          top: el.y,
          radius: el.radius || 60,
          fill: el.bgColor || "#8b0000",
          originX: "center",
          originY: "center",
          selectable: true,
          strokeWidth: 0,
          objectCaching: false,
        });
        (circle as any).__pinId = el.id;
        (circle as any).__pinLabel = el.label;
        (circle as any).__pinType = "band";
        canvas.add(circle);
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
          objectCaching: false,
        });
        (band as any).__pinId = el.id;
        (band as any).__pinLabel = el.label;
        (band as any).__pinType = "band";
        (band as any).__pinLocked = !!(el as any).locked;
        applyLockState(band);
        canvas.add(band);
        addDesignerBorder(fabric, canvas, el.x, el.y, el.width, el.height, el.id);
      } else if (el.type === "text") {
        const titleLines = (ttl || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        const firstLine = titleLines[0] || ttl || "";
        const secondLine = titleLines[1] || "";
        const thirdLine = titleLines[2] || "";
        const tv = (el as any).textVariable ?? "";
        let textContent: string;
        if (tv === "title" || el.id === "title") {
          textContent = ttl || el.defaultText || "Text";
        } else if (el.id === "title1") {
          textContent = firstLine || el.defaultText || "Text";
        } else if (el.id === "title2") {
          textContent = secondLine || el.defaultText || "";
        } else if (el.id === "title3") {
          textContent = thirdLine || el.defaultText || "";
        } else if (tv === "website" || el.id === "website") {
          textContent = siteWebsite || el.defaultText || "Text";
        } else {
          textContent = el.defaultText || "Text";
        }
        const tt = (el as any).textTransform ?? el.textTransform ?? "none";
        const textbox = new fabric.Textbox(
          applyTextTransform(textContent, tt),
          {
            left: el.x,
            top: el.y,
            width: el.width || 940,
            fontSize: el.fontSize || 32,
            fontFamily: el.fontFamily || "Arial",
            fontWeight: el.fontWeight || "normal",
            fontStyle: (el.fontStyle as any) || "normal",
            fill: el.fill || "#333333",
            originX: "center",
            originY: "center",
            selectable: true,
            textAlign: el.textAlign || "center",
            editable: true,
            splitByGrapheme: false,
          }
        );
        (textbox as any).__pinId = el.id;
        (textbox as any).__pinLabel = el.label;
        (textbox as any).__pinType = "text";
        (textbox as any).__textTransform = tt;
        (textbox as any).__rawText = textContent;
        (textbox as any).__pinLocked = !!(el as any).locked;
        applyLockState(textbox);
        canvas.add(textbox);
        addDesignerBorder(fabric, canvas, el.x - (el.width || 940) / 2, el.y - (el.height || 50) / 2, el.width || 940, el.height || 50, el.id);
      } else if (el.type === "frame") {
        const strokeStyle = (el.strokeStyle as string) ?? (el as any).__strokeStyle ?? "solid";
        let dashArray: number[] | null = null;
        if (strokeStyle === "dashed") dashArray = [20, 10];
        else if (strokeStyle === "dotted") dashArray = [4, 8];
        const frame = new fabric.Rect({
          left: el.x,
          top: el.y,
          width: el.width,
          height: el.height,
          fill: "transparent",
          stroke: el.fill ?? "#333333",
          strokeWidth: el.strokeWidth ?? 4,
          strokeUniform: true,
          strokeDashArray: dashArray,
          rx: el.radius ?? 0,
          ry: el.radius ?? 0,
          originX: "left",
          originY: "top",
          selectable: true,
        });
        (frame as any).__pinId = el.id;
        (frame as any).__pinLabel = el.label || "Frame";
        (frame as any).__pinType = "frame";
        (frame as any).__strokeStyle = strokeStyle;
        (frame as any).__pinLocked = !!(el as any).locked;
        applyLockState(frame);
        canvas.add(frame);
      }
    }


    if (shouldAutoStretchLastElement) {
      // Keep historical behavior for built-ins only.
      const contentObjs = canvas.getObjects().filter(
        (o: any) => (o.__pinType === "image" || o.__pinType === "band") && !o.__isLabel
      );
      if (contentObjs.length > 0) {
        const last = contentObjs[contentObjs.length - 1] as any;

        // Compute the current bottom edge of this object
        let bottomEdge: number;
        if (last.originY === "center") {
          // FabricImage loaded with originY:"center"
          bottomEdge = (last.top ?? 0) + ((last.height ?? 0) * (last.scaleY ?? 1)) / 2;
        } else {
          // Rect (band / placeholder) with default top-left origin
          bottomEdge = (last.top ?? 0) + (last.height ?? 0) * (last.scaleY ?? 1);
        }

        const gap = PIN_H - bottomEdge;
        if (gap > 1) {
          if (last.type === "image") {
            const origH = last.height ?? 1;
            const curScaleY = last.scaleY ?? 1;
            const newScaleY = (origH * curScaleY + gap) / origH;
            last.set({ scaleY: newScaleY, top: (last.top ?? 0) + gap / 2 });
            // Grow the clip zone to match the stretched image height
            if (last.clipPath) last.clipPath.set("height", (last.clipPath.height ?? 0) + gap);
          } else {
            last.set("height", (last.height ?? 0) + gap);
            if (last.clipPath) last.clipPath.set("height", (last.clipPath.height ?? 0) + gap);
          }
          last.setCoords();
        }
      }
    }

    // Ensure helper overlays stay visible above bands/images/text.
    canvas
      .getObjects()
      .filter((o: any) => o.__designerBorder || o.__isLabel)
      .forEach((o: any) => canvas.bringObjectToFront(o));

    canvas.renderAll();
    updateLayers();
    saveUndoState();
  };

  // ── Canvas initialization ─────────────────────────────────────────────────

  useEffect(() => {
    if (!mounted || !canvasRef.current) return;
    if (fabricCanvasRef.current) return;

    let disposed = false;

    const initCanvas = async () => {
      try {
        const fabric = await import("fabric");
        if (disposed) return;

        fabricLibRef.current = fabric;
        const canvas = new fabric.Canvas(canvasRef.current!, {
          width: PIN_W,
          height: PIN_H,
          backgroundColor: "#1a1a2e",
          preserveObjectStacking: true,
          fireRightClick: true,
          stopContextMenu: true,
        });
        fabricCanvasRef.current = canvas;

        // ── Selection events ──────────────────────────────────────────────
        const getFirstSelected = (e: any): any => {
          let obj = e.selected?.[0];
          if (!obj && (e.selected as any)?._objects?.length) obj = (e.selected as any)._objects[0];
          if (!obj) obj = canvas.getActiveObject() as any;
          return obj;
        };

        canvas.on("selection:created", (e: any) => {
          if (isRestoringRef.current) return;
          const obj = getFirstSelected(e);
          if (obj) syncSelectionFromObject(obj);
        });

        canvas.on("selection:updated", (e: any) => {
          if (isRestoringRef.current) return;
          const obj = getFirstSelected(e);
          if (obj) syncSelectionFromObject(obj);
        });

        canvas.on("selection:cleared", () => {
          if (isRestoringRef.current) return;
          // Exit image edit mode: re-enable all imageFrame rects, lock all imageContent
          canvas.getObjects().forEach((o: any) => {
            if (o.__pinType === "imageFrame") {
              o.set({ selectable: true, evented: true, opacity: 1 });
            } else if (o.__pinType === "imageContent") {
              o.set({ selectable: false, evented: false, hasControls: false, hasBorders: false });
            }
          });
          setEditMode(null);
          selectedIdRef.current = null;
          activeObjRef.current = null;
          setSelectedId(null);
          setTextProps({ editText: "" });
          setToolbarPos(null);
          canvas.renderAll();
        });

        // ── Text events ───────────────────────────────────────────────────
        canvas.on("text:changed", (e: any) => {
          const t = e.target;
          if (t?.__pinType === "text") setTextProps({ editText: t.text ?? "" });
        });

        canvas.on("mouse:dblclick", (e: any) => {
          const target = e.target;
          if (!target) return;
          if (target.__pinType === "text") {
            target.enterEditing();
            target.selectAll();
          } else if (target.__pinType === "imageFrame") {
            // Enter image edit mode: pass-through the frame, activate the content image
            const img = target.__linkedImg as any;
            if (!img) return;
            target.set({ selectable: false, evented: false });
            img.set({
              selectable: true, evented: true,
              hasControls: true, hasBorders: true,
              cornerSize: 12, cornerColor: "#6366f1", borderColor: "#6366f1",
            });
            canvas.setActiveObject(img);
            setEditMode(target.__pinId ?? null);
            syncSelectionFromObject(img);
            canvas.renderAll();
          } else if (target.__pinType === "image") {
            canvas.setActiveObject(target);
            canvas.bringObjectToFront(target);
            target.set({ hasControls: true, hasBorders: true, cornerSize: 12, cornerColor: "#6366f1", borderColor: "#6366f1" });
            syncSelectionFromObject(target);
            canvas.renderAll();
          }
        });

        // ── mouse:down — delta tracking + exit image edit mode on outside click
        canvas.on("mouse:down", (e: any) => {
          const obj = e.target as any;
          if (obj?.__pinType === "imageFrame") {
            obj.__prevMoveLeft = obj.left;
            obj.__prevMoveTop  = obj.top;
          }
          // Store position for locked objects so we can snap back on drag attempt
          if (obj?.__pinLocked) {
            obj.__lockedLeft = obj.left;
            obj.__lockedTop  = obj.top;
          }
          // Exit image edit mode when clicking outside the active imageContent
          const editId = imageEditModeIdRef.current;
          if (editId && obj?.__pinId !== editId) {
            canvas.getObjects().forEach((o: any) => {
              if (o.__pinType === "imageFrame") o.set({ selectable: true, evented: true });
              else if (o.__pinType === "imageContent") o.set({ selectable: false, evented: false, hasControls: false, hasBorders: false });
            });
            canvas.discardActiveObject();
            canvas.renderAll();
            setEditMode(null);
          }
        });

        // ── Transform events (undo + toolbar) ────────────────────────────
        canvas.on("object:moving", (e: any) => {
          const obj = e.target as any;
          // Block mouse movement for locked objects
          if (obj?.__pinLocked) {
            obj.left = obj.__lockedLeft ?? obj.left;
            obj.top  = obj.__lockedTop  ?? obj.top;
            return;
          }
          if (!transformSaveDoneRef.current) {
            transformSaveDoneRef.current = true;
            saveUndoState();
          }

          if (obj.__pinType === "imageFrame") {
            // Move imageContent and its clipPath alongside the frame using delta tracking
            const img = obj.__linkedImg as any;
            if (img) {
              const dx = obj.left - (obj.__prevMoveLeft ?? obj.left);
              const dy = obj.top  - (obj.__prevMoveTop  ?? obj.top);
              img.set({ left: (img.left ?? 0) + dx, top: (img.top ?? 0) + dy });
              if (img.clipPath) {
                img.clipPath.set({
                  left: (img.clipPath.left ?? 0) + dx,
                  top:  (img.clipPath.top  ?? 0) + dy,
                });
              }
              img.setCoords();
            }
            obj.__prevMoveLeft = obj.left;
            obj.__prevMoveTop  = obj.top;
          } else if (obj?.clipPath && obj.clipPath.absolutePositioned) {
            // imageContent in edit mode: pan within its clip zone
            const clip = obj.clipPath;
            const imgW = (obj.width || 1) * (obj.scaleX || 1);
            const imgH = (obj.height || 1) * (obj.scaleY || 1);
            const clipLeft   = clip.left ?? 0;
            const clipTop    = clip.top  ?? 0;
            const clipRight  = clipLeft + (clip.width  || 0);
            const clipBottom = clipTop  + (clip.height || 0);
            const minLeft = clipRight  - imgW / 2;
            const maxLeft = clipLeft   + imgW / 2;
            const minTop  = clipBottom - imgH / 2;
            const maxTop  = clipTop    + imgH / 2;
            obj.left = Math.max(minLeft, Math.min(maxLeft, obj.left));
            obj.top  = Math.max(minTop,  Math.min(maxTop,  obj.top));
          }

          syncDesignerBorder(canvas, obj);
          recalcToolbarPos(obj);
        });
        canvas.on("object:scaling", (e: any) => {
          if (!transformSaveDoneRef.current) {
            transformSaveDoneRef.current = true;
            saveUndoState();
          }
          recalcToolbarPos(e.target);
        });
        canvas.on("object:rotating", (e: any) => {
          if (!transformSaveDoneRef.current) {
            transformSaveDoneRef.current = true;
            saveUndoState();
          }
          recalcToolbarPos(e.target);
        });
        canvas.on("object:resizing", () => {
          if (!transformSaveDoneRef.current) {
            transformSaveDoneRef.current = true;
            saveUndoState();
          }
        });

        canvas.on("object:modified", (e: any) => {
          transformSaveDoneRef.current = false;
          const obj = e.target as any;
          if (!obj) return;
          // After scaling, re-enforce frame constraints so image still covers its clip zone
          if (obj?.clipPath && obj.clipPath.absolutePositioned) {
            const clip = obj.clipPath;
            const imgW = (obj.width || 1) * (obj.scaleX || 1);
            const imgH = (obj.height || 1) * (obj.scaleY || 1);
            const clipLeft   = clip.left ?? 0;
            const clipTop    = clip.top  ?? 0;
            const clipRight  = clipLeft + (clip.width  || 0);
            const clipBottom = clipTop  + (clip.height || 0);
            const minLeft = clipRight  - imgW / 2;
            const maxLeft = clipLeft   + imgW / 2;
            const minTop  = clipBottom - imgH / 2;
            const maxTop  = clipTop    + imgH / 2;
            obj.left = Math.max(minLeft, Math.min(maxLeft, obj.left));
            obj.top  = Math.max(minTop,  Math.min(maxTop,  obj.top));
            obj.setCoords();
          }

          if (obj.__pinType === "text") {
            canvas.bringObjectToFront(obj);
          } else if (obj.__pinType === "imageFrame") {
            // After move/transform, sync clipPath rect to match new frame bounds
            const img = obj.__linkedImg as any;
            if (img?.clipPath) {
              img.clipPath.set({
                left:   obj.left   ?? 0,
                top:    obj.top    ?? 0,
                width:  (obj.width  ?? 0) * (obj.scaleX ?? 1),
                height: (obj.height ?? 0) * (obj.scaleY ?? 1),
              });
              img.clipPath.setCoords();
              // Re-enforce cover constraint after frame resize
              const clip = img.clipPath;
              const imgW = (img.width || 1) * (img.scaleX || 1);
              const imgH = (img.height || 1) * (img.scaleY || 1);
              const clipLeft   = clip.left ?? 0;
              const clipTop    = clip.top  ?? 0;
              const clipRight  = clipLeft + (clip.width  || 0);
              const clipBottom = clipTop  + (clip.height || 0);
              img.left = Math.max(clipRight - imgW / 2, Math.min(clipLeft + imgW / 2, img.left ?? 0));
              img.top  = Math.max(clipBottom - imgH / 2, Math.min(clipTop + imgH / 2, img.top  ?? 0));
              img.setCoords();
            }
            setImageProps({
              left: Math.round(obj.left ?? 0),
              top: Math.round(obj.top ?? 0),
              width: Math.round((obj.width ?? 0) * (obj.scaleX ?? 1)),
              height: Math.round((obj.height ?? 0) * (obj.scaleY ?? 1)),
              angle: Math.round(obj.angle ?? 0),
            });
          } else if (obj.__pinType === "image") {
            setImageProps({
              left: Math.round(obj.left ?? 0),
              top: Math.round(obj.top ?? 0),
              width: Math.round((obj.width ?? 0) * (obj.scaleX ?? 1)),
              height: Math.round((obj.height ?? 0) * (obj.scaleY ?? 1)),
              angle: Math.round(obj.angle ?? 0),
            });
          } else if (obj.__pinType === "frame") {
            for (;;) {
              const objs = canvas.getObjects();
              const idx = objs.indexOf(obj);
              if (idx <= 0) break;
              const below = objs[idx - 1] as any;
              if (below.__isLabel) break;
              if (below.__pinType === "image" || below.__pinType === "band") break;
              canvas.sendObjectBackwards(obj);
            }
          }

          syncDesignerBorder(canvas, obj);
          recalcToolbarPos(obj);
          canvas.renderAll();
          updateLayers();
        });

        setCanvasReady(true);
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
      fabricLibRef.current = null;
      undoHistoryRef.current = [];
      isRestoringRef.current = false;
      resetStore();
    };
  }, [mounted]);

  // Restore saved canvas JSON on mount (takes priority over template)
  useEffect(() => {
    if (!canvasReady || !initialJson) return;
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Wait for all fonts in the saved JSON before restoring the canvas
    ;(async () => {
      try {
        const jsonData = JSON.parse(initialJson);
        const fontFamilies: string[] = Array.from(new Set(
          (jsonData.objects || [])
            .filter((o: any) => o.fontFamily)
            .map((o: any) => o.fontFamily as string)
        ));
        if (fontFamilies.length > 0) {
          await Promise.all(fontFamilies.map(injectFontStylesheet));
        }
        await canvas.loadFromJSON(initialJson);
        normalizeCanvasObjectMetadata();
        canvas.renderAll();
        updateLayers();
      } catch { /* ignore */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasReady]);

  // Auto-apply initial template (only if no saved JSON)
  useEffect(() => {
    if (!canvasReady || initialJson || !initialTemplateId) return;
    const tmpl = allTemplates.find((t) => t.id === initialTemplateId);
    if (tmpl) setSelectedTemplate(tmpl);
  }, [canvasReady, initialJson, initialTemplateId, customTemplates]);

  // Expose API to parent once canvas ready
  useEffect(() => {
    if (!canvasReady || !onApiReady) return;
    onApiReady({
      getJson: () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return "{}";
        return JSON.stringify(canvas.toObject(["__pinId", "__pinLabel", "__pinType", "__isLabel", "__forId", "__strokeStyle", "__pinLocked", "__designerBorder", "__forPinId", "__flipX"]));
      },
      exportPng: getExportDataUrl,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasReady]);

  // Load template when ready (skip if initialJson already loaded)
  useEffect(() => {
    if (canvasReady && selectedTemplate && !initialJson) {
      if (skipTemplateAutoApplyRef.current) {
        skipTemplateAutoApplyRef.current = false;
        return;
      }
      loadTemplate(selectedTemplate);
      if (frames && frames.length > 1) generateAllFramePreviews(selectedTemplate);
    }
  }, [selectedTemplate, canvasReady, initialJson]);

  // ── Ctrl+wheel zoom ───────────────────────────────────────────────────────

  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? 5 : -5));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [zoom, setZoom]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  const MOVE_STEP = 5;

  const moveSelectedBy = (dx: number, dy: number) => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj) return;
    // Re-read lock state from the frame/primary object (not imageContent which shares __pinId)
    const canvasObj = (canvas.getObjects().find((o: any) => o.__pinId === obj.__pinId && o.__pinType !== "imageContent")
      ?? canvas.getObjects().find((o: any) => o.__pinId === obj.__pinId)) as any;
    if (canvasObj?.__pinLocked) return;
    saveUndoState();
    obj.set("left", (obj.left ?? 0) + dx);
    obj.set("top", (obj.top ?? 0) + dy);
    obj.setCoords();
    recalcToolbarPos(obj);
    canvas.renderAll();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isInput =
        active?.tagName === "INPUT" ||
        active?.tagName === "TEXTAREA" ||
        active?.getAttribute("contenteditable") === "true";

      if (e.key === "Escape") {
        const canvas = fabricCanvasRef.current;
        if (canvas) {
          canvas.getObjects().forEach((o: any) => {
            if (o.__pinType === "imageFrame") o.set({ selectable: true, evented: true });
            else if (o.__pinType === "imageContent") o.set({ selectable: false, evented: false, hasControls: false, hasBorders: false });
          });
          canvas.discardActiveObject();
          canvas.renderAll();
          setEditMode(null);
        }
        return;
      }
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !isInput) {
        e.preventDefault();
        performUndo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !isInput) {
        e.preventDefault();
        deleteSelectedElement();
        return;
      }
      if (!isInput && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? MOVE_STEP * 2 : MOVE_STEP;
        if (e.key === "ArrowUp") moveSelectedBy(0, -step);
        else if (e.key === "ArrowDown") moveSelectedBy(0, step);
        else if (e.key === "ArrowLeft") moveSelectedBy(-step, 0);
        else if (e.key === "ArrowRight") moveSelectedBy(step, 0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId]);

  // Exit image edit mode when clicking outside the canvas wrapper
  useEffect(() => {
    if (!imageEditModeId) return;
    const handleOutsideClick = (e: MouseEvent) => {
      // Don't exit when clicking the floating toolbar or properties panel
      if ((e.target as HTMLElement)?.closest?.('[data-pin-ui]')) return;
      const wrapper = canvasWrapperRef.current;
      if (wrapper && !wrapper.contains(e.target as Node)) {
        const canvas = fabricCanvasRef.current;
        if (canvas) {
          canvas.getObjects().forEach((o: any) => {
            if (o.__pinType === "imageFrame") o.set({ selectable: true, evented: true });
            else if (o.__pinType === "imageContent") o.set({ selectable: false, evented: false, hasControls: false, hasBorders: false });
          });
          canvas.discardActiveObject();
          canvas.renderAll();
        }
        setEditMode(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick, true);
    return () => document.removeEventListener("mousedown", handleOutsideClick, true);
  }, [imageEditModeId]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const deleteSelectedElement = () => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj) return;
    if (obj.__pinLocked) return;
    saveUndoState();
    const pid = obj.__pinId;
    canvas.remove(obj);
    const label = canvas.getObjects().find((o: any) => o.__forId === pid);
    if (label) canvas.remove(label);
    const border = canvas.getObjects().find((o: any) => o.__designerBorder && o.__forPinId === pid);
    if (border) canvas.remove(border);
    canvas.discardActiveObject();
    setSelectedId(null);
    setToolbarPos(null);
    canvas.renderAll();
    updateLayers();
  };

  const sendToBack = () => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj) return;
    saveUndoState();
    canvas.sendObjectToBack(obj);
    canvas.renderAll();
    updateLayers();
  };

  const bringToFront = () => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj) return;
    saveUndoState();
    canvas.bringObjectToFront(obj);
    canvas.renderAll();
    updateLayers();
  };

  const moveLayerUp = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !selectedId) return;
    const obj = canvas.getObjects().find((o: any) => o.__pinId === selectedId);
    if (!obj) return;
    canvas.bringObjectForward(obj);
    canvas.renderAll();
    updateLayers();
  };

  const moveLayerDown = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !selectedId) return;
    const obj = canvas.getObjects().find((o: any) => o.__pinId === selectedId);
    if (!obj) return;
    canvas.sendObjectBackwards(obj);
    canvas.renderAll();
    updateLayers();
  };

  const selectById = (id: string) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const obj = canvas.getObjects().find((o: any) => o.__pinId === id);
    if (obj) {
      canvas.setActiveObject(obj);
      canvas.renderAll();
      syncSelectionFromObject(obj);
    }
  };

  // ── Text ──────────────────────────────────────────────────────────────────

  const applyEditText = () => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "text") return;
    saveUndoState();
    const raw = textProps.editText;
    const tt = (obj.__textTransform as string) ?? "none";
    obj.__rawText = raw;
    obj.set("text", applyTextTransform(raw, tt));
    if (typeof obj.initDimensions === "function") obj.initDimensions();
    obj.setCoords();
    canvas.renderAll();
  };

  const updateTextProperty = (property: string, value: any, applyToAllPages = false) => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "text") return;
    saveUndoState();

    if (property === "textTransform") {
      // Apply transform: re-derive displayed text from stored raw text
      const raw = (obj.__rawText as string) ?? (obj.text as string) ?? "";
      obj.__rawText = raw;
      obj.__textTransform = value;
      obj.set("text", applyTextTransform(raw, value as string));
      if (typeof obj.initDimensions === "function") obj.initDimensions();
      obj.setCoords();
      setTextProps({ textTransform: value });
      canvas.renderAll();
      return;
    }

    const propName = property === "fill" ? "fill" : property;
    const propValue = property === "fontSize" ? parseInt(value) : value;
    if (applyToAllPages) {
      canvas.getObjects().filter((o: any) => o.__pinType === "text" || o.type === "textbox").forEach((o: any) => {
        o.set(propName, propValue);
        if (typeof o.initDimensions === "function") o.initDimensions();
        o.setCoords();
      });
      updateTextPropsInAllFrames({ [propName]: propValue });
    } else {
      obj.set(propName, propValue);
      if (typeof obj.initDimensions === "function") obj.initDimensions();
      obj.setCoords();
    }
    setTextProps({ [property === "fill" ? "textColor" : property]: propValue });
    canvas.renderAll();
  };

  const updateTextPropsInAllFrames = async (props: Record<string, any>) => {
    if (!frames || frames.length <= 1 || !selectedTemplate) return;
    const refs = frameJsonsRef.current;
    const fabricMod = await import("fabric");
    const proxyBase = getApiBaseUrl();
    const newPreviews: Record<number, string> = {};
    const tmplW = selectedTemplate.canvasWidth || PIN_W;
    const tmplH = selectedTemplate.canvasHeight || PIN_H;

    for (let i = 0; i < frames.length; i++) {
      if (i === activeFrameIdx) continue;
      const frame = frames[i];
      const canvasEl = document.createElement("canvas");
      canvasEl.width = tmplW;
      canvasEl.height = tmplH;
      canvasEl.style.display = "none";
      document.body.appendChild(canvasEl);

      try {
        const FC = (fabricMod as any).Canvas || (fabricMod as any).default?.Canvas;
        const fc = new FC(canvasEl, { width: tmplW, height: tmplH, enableRetinaScaling: false });

        const savedJson = refs[i];
        if (savedJson && savedJson !== "{}") {
          await fc.loadFromJSON(savedJson);
        } else {
          await buildTemplateOnCanvas(fabricMod, fc, selectedTemplate, frame.images, proxyBase, frame.title, website);
        }

        fc.getObjects().filter((o: any) => o.__pinType === "text" || o.type === "textbox").forEach((o: any) => {
          for (const [k, v] of Object.entries(props)) {
            o.set(k, v);
            if (typeof o.initDimensions === "function") o.initDimensions();
            o.setCoords();
          }
        });
        fc.renderAll();

        refs[i] = JSON.stringify(
          fc.toObject(["__pinId", "__pinLabel", "__pinType", "__isLabel", "__forId", "__strokeStyle", "__designerBorder", "__forPinId", "__flipX"])
        );

        fc.getObjects().filter((o: any) => o.__isLabel || o.__designerBorder).forEach((o: any) => o.set("visible", false));
        fc.renderAll();
        newPreviews[i] = fc.toDataURL({ format: "png", multiplier: 0.5 });
        fc.dispose();
      } catch { /* skip */ } finally {
        document.body.removeChild(canvasEl);
      }
    }

    setFramePreviews((prev) => ({ ...prev, ...newPreviews }));
  };

  const applyFontToAllText = (fontFamily: string) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    saveUndoState();
    canvas.getObjects().filter((o: any) => o.__pinType === "text" || o.type === "textbox").forEach((obj: any) => {
      obj.set("fontFamily", fontFamily);
      if (typeof obj.initDimensions === "function") obj.initDimensions();
      obj.setCoords();
    });
    setTextProps({ fontFamily });
    canvas.renderAll();
    updateTextPropsInAllFrames({ fontFamily });
  };

  const addTextElement = () => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;
    saveUndoState();
    const id = `text_${Date.now()}`;
    const text = new fabric.Textbox("New Text", {
      left: PIN_W / 2,
      top: PIN_H / 2,
      width: 800,
      fontSize: 36,
      fontFamily: "Arial",
      fontWeight: "normal",
      fill: "#333333",
      originX: "center",
      originY: "center",
      selectable: true,
      textAlign: "center",
      editable: true,
    });
    (text as any).__pinId = id;
    (text as any).__pinLabel = "Text";
    (text as any).__pinType = "text";
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    updateLayers();
    syncSelectionFromObject(text);
  };

  // ── Band ──────────────────────────────────────────────────────────────────

  const updateBandColor = (hex: string, opacity?: number) => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "band") return;
    saveUndoState();
    const alpha = opacity ?? bandProps.bandOpacity;
    const newHex = hex ?? bandProps.bandFill;
    obj.set("fill", hexToRgba(newHex, alpha));
    setBandProps({ bandFill: newHex, bandOpacity: alpha });
    canvas.renderAll();
  };

  const addBand = () => {
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
    syncSelectionFromObject(band);
  };

  // ── Frame ─────────────────────────────────────────────────────────────────

  const updateFrameProperty = (property: string, value: any) => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "frame") return;
    saveUndoState();
    if (property === "strokeWidth") {
      obj.set("strokeWidth", parseInt(value));
      setFrameProps({ strokeWidth: parseInt(value) });
    } else if (property === "stroke") {
      obj.set("stroke", value);
      setFrameProps({ strokeColor: value });
    } else if (property === "strokeStyle") {
      (obj as any).__strokeStyle = value;
      if (value === "solid") obj.set("strokeDashArray", undefined);
      else if (value === "dashed") obj.set("strokeDashArray", [15, 10]);
      else if (value === "dotted") obj.set("strokeDashArray", [4, 6]);
      setFrameProps({ strokeStyle: value });
    } else if (property === "rx") {
      const v = parseInt(value);
      obj.set("rx", v);
      obj.set("ry", v);
      setFrameProps({ rx: v });
    }
    canvas.renderAll();
  };

  const addFrame = () => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;
    saveUndoState();
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
    // Position frame above images, below text
    canvas.sendObjectToBack(frame);
    for (;;) {
      const objs = canvas.getObjects();
      const idx = objs.indexOf(frame);
      if (idx >= objs.length - 1) break;
      const above = objs[idx + 1] as any;
      if (above.__pinType === "text") break;
      canvas.bringObjectForward(frame);
    }
    canvas.getObjects().forEach((o: any) => { if (o.__isFill) canvas.sendObjectToBack(o); });
    canvas.setActiveObject(frame);
    canvas.renderAll();
    updateLayers();
    syncSelectionFromObject(frame);
  };

  // ── Shape ─────────────────────────────────────────────────────────────────

  const addShape = (shapeType: string) => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;
    saveUndoState();
    const id = `shape_${Date.now()}`;
    const cx = PIN_W / 2;
    const cy = PIN_H / 2;
    const fill = shapeProps.fill;
    let obj: any;

    if (shapeType === "rect") {
      obj = new fabric.Rect({ left: cx, top: cy, width: 400, height: 200, fill, strokeWidth: 0, originX: "center", originY: "center" });
    } else if (shapeType === "rect-rounded") {
      obj = new fabric.Rect({ left: cx, top: cy, width: 400, height: 200, rx: 40, ry: 40, fill, strokeWidth: 0, originX: "center", originY: "center" });
    } else if (shapeType === "circle") {
      obj = new fabric.Circle({ left: cx, top: cy, radius: 150, fill, strokeWidth: 0, originX: "center", originY: "center" });
    } else if (shapeType === "ellipse") {
      obj = new fabric.Ellipse({ left: cx, top: cy, rx: 220, ry: 130, fill, strokeWidth: 0, originX: "center", originY: "center" });
    } else if (shapeType === "triangle") {
      obj = new fabric.Triangle({ left: cx, top: cy, width: 300, height: 280, fill, strokeWidth: 0, originX: "center", originY: "center" });
    } else if (shapeType === "line") {
      obj = new fabric.Line([cx - 300, cy, cx + 300, cy], { stroke: fill, strokeWidth: 6, strokeLineCap: "round", selectable: true });
    } else if (shapeType === "star") {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? 160 : 70;
        pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      }
      obj = new fabric.Polygon(pts, { fill, strokeWidth: 0, originX: "center", originY: "center" });
    } else if (shapeType === "diamond") {
      obj = new fabric.Polygon(
        [{ x: cx, y: cy - 180 }, { x: cx + 200, y: cy }, { x: cx, y: cy + 180 }, { x: cx - 200, y: cy }],
        { fill, strokeWidth: 0, originX: "center", originY: "center" }
      );
    } else if (shapeType === "hexagon") {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 6;
        pts.push({ x: cx + 170 * Math.cos(angle), y: cy + 170 * Math.sin(angle) });
      }
      obj = new fabric.Polygon(pts, { fill, strokeWidth: 0, originX: "center", originY: "center" });
    } else if (shapeType === "heart") {
      // SVG heart path centered at 0,0 scaled to ~300px
      obj = new fabric.Path(
        "M 0,-80 C 0,-160 -160,-160 -160,-60 C -160,30 0,120 0,160 C 0,120 160,30 160,-60 C 160,-160 0,-160 0,-80 Z",
        { left: cx, top: cy, fill, strokeWidth: 0, originX: "center", originY: "center" }
      );
    } else {
      return;
    }

    obj.__pinId = id;
    obj.__pinLabel = shapeType.charAt(0).toUpperCase() + shapeType.slice(1);
    obj.__pinType = "shape";
    obj.__shapeType = shapeType;
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
    updateLayers();
    syncSelectionFromObject(obj);
  };

  const updateShapeProperty = (property: keyof ShapeProps, value: any) => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "shape") return;
    saveUndoState();
    if (property === "fill") {
      obj.set("fill", value);
      if (obj.type === "line") obj.set("stroke", value);
      setShapeProps({ fill: value });
    } else if (property === "strokeColor") {
      if (obj.type !== "line") obj.set("stroke", value);
      setShapeProps({ strokeColor: value });
    } else if (property === "strokeWidth") {
      if (obj.type !== "line") obj.set("strokeWidth", parseInt(value));
      setShapeProps({ strokeWidth: parseInt(value) });
    } else if (property === "opacity") {
      obj.set("opacity", parseInt(value) / 100);
      setShapeProps({ opacity: parseInt(value) });
    }
    obj.setCoords();
    canvas.renderAll();
  };

  // ── Image ─────────────────────────────────────────────────────────────────

  const applyImage = (imageUrl: string) => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    const target = getSelectedObject();
    if (!fabric || !canvas || !imageUrl.trim() || !target) return;
    const isFrame = target.__pinType === "imageFrame";
    const isOldPlaceholder = target.__pinType === "image";
    if (!isFrame && !isOldPlaceholder) return;
    saveUndoState();

    // Zone bounds
    const zoneLeft = target.left ?? 0;
    const zoneTop = target.top ?? 0;
    const zoneW = (target.width ?? 400) * (target.scaleX ?? 1);
    const zoneH = (target.height ?? 400) * (target.scaleY ?? 1);
    const pid = target.__pinId;

    fabric.FabricImage.fromURL(proxyUrl(imageUrl.trim()), { crossOrigin: "anonymous" })
      .then((img: any) => {
        if (!img || !img.width) throw new Error("Empty image");

        const panMarginPx = Math.max(24, Math.min(zoneW, zoneH) * 0.06);
        const scale = Math.max(
          zoneW / (img.width || 1),
          zoneH / (img.height || 1),
          (zoneW + panMarginPx) / (img.width || 1),
          (zoneH + panMarginPx) / (img.height || 1)
        );
        img.set({
          left: zoneLeft + zoneW / 2,
          top: zoneTop + zoneH / 2,
          originX: "center",
          originY: "center",
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
          hasControls: false,
          hasBorders: false,
        });
        img.__pinId = pid;
        img.__pinLabel = target.__pinLabel;
        img.__pinType = "imageContent";

        const clipRect = new fabric.Rect({
          left: zoneLeft,
          top: zoneTop,
          width: zoneW,
          height: zoneH,
          absolutePositioned: true,
          fill: "",
        });
        img.clipPath = clipRect;

        if (isFrame) {
          // Replace linked imageContent (if any), keep frame
          const oldContent = target.__linkedImg;
          if (oldContent) canvas.remove(oldContent);
          target.__linkedImg = img;
          img.__frameRect = target;
          // Insert img below the frame rect
          const frameIdx = canvas.getObjects().indexOf(target);
          canvas.add(img);
          canvas.bringObjectToFront(target); // keep frame on top
          canvas.setActiveObject(target);
          syncSelectionFromObject(target);
        } else {
          // Old-style placeholder: replace rect with frame+content
          const label = canvas.getObjects().find((o: any) => o.__forId === pid);
          if (label) canvas.remove(label);
          // Create frame rect to wrap the new image
          const frameRect = new fabric.Rect({
            left: zoneLeft, top: zoneTop, width: zoneW, height: zoneH,
            fill: "transparent", stroke: "#666", strokeWidth: 1, strokeDashArray: [8, 5],
            strokeUniform: true, originX: "left", originY: "top",
            selectable: !target.__pinLocked, evented: !target.__pinLocked,
            hasControls: false, hasBorders: true, borderColor: "#6366f1", objectCaching: false,
          });
          frameRect.__pinId = pid;
          frameRect.__pinLabel = target.__pinLabel;
          frameRect.__pinType = "imageFrame";
          frameRect.__pinLocked = target.__pinLocked;
          frameRect.__flipX = !!(target as any).__flipX;
          frameRect.__linkedImg = img;
          img.__frameRect = frameRect;
          canvas.remove(target);
          canvas.add(img);
          canvas.add(frameRect);
          canvas.setActiveObject(frameRect);
          syncSelectionFromObject(frameRect);
        }

        canvas.renderAll();
        updateLayers();
      })
      .catch(() => {
        toast.error("Could not load image — the URL may have expired. Try uploading the image directly.");
      });
  };

  const zoomImageInFrame = (direction: "in" | "out") => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !imageEditModeId) return;
    const img = canvas.getObjects().find((o: any) =>
      o.__pinType === "imageContent" && o.__pinId === imageEditModeId
    ) as any;
    if (!img?.clipPath) return;
    saveUndoState();
    const factor = direction === "in" ? 1.15 : 1 / 1.15;
    const clip = img.clipPath;
    const zoneW = clip.width ?? 1;
    const zoneH = clip.height ?? 1;
    const imgNatW = img.width || 1;
    const imgNatH = img.height || 1;
    const minScale = Math.max(zoneW / imgNatW, zoneH / imgNatH);
    const newScale = Math.max(img.scaleX * factor, minScale);
    img.set({ scaleX: newScale, scaleY: newScale });
    // Re-clamp position
    const finalImgW = imgNatW * newScale;
    const finalImgH = imgNatH * newScale;
    const clipLeft = clip.left ?? 0;
    const clipTop = clip.top ?? 0;
    img.left = Math.max(clipLeft + (clip.width ?? 0) - finalImgW / 2, Math.min(clipLeft + finalImgW / 2, img.left));
    img.top  = Math.max(clipTop  + (clip.height ?? 0) - finalImgH / 2, Math.min(clipTop  + finalImgH / 2, img.top));
    img.setCoords();
    canvas.renderAll();
  };

  const addFlipImageZone = () => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;
    saveUndoState();
    const id = `image_${Date.now()}`;

    const existingObjs = canvas.getObjects().filter(
      (o: any) => !o.__isFill && !o.__isLabel
    );
    const minTop = existingObjs.length > 0
      ? Math.min(...existingObjs.map((o: any) => (o.top ?? 0)))
      : canvas.height ?? 1500;
    const zoneW = canvas.width ?? 1000;
    const zoneH = Math.max(200, minTop);

    const rect = new fabric.Rect({
      left: 0,
      top: 0,
      width: zoneW,
      height: zoneH,
      fill: "#b3d9ff",
      rx: 0,
      ry: 0,
      selectable: true,
      strokeWidth: 2,
      stroke: "#4a90d9",
    });
    (rect as any).__pinId = id;
    (rect as any).__pinLabel = "Flip Image Zone";
    (rect as any).__pinType = "image";
    (rect as any).__flipX = true;
    canvas.add(rect);
    const label = new fabric.FabricText("⇄ Flip Image Zone", {
      left: zoneW / 2,
      top: zoneH / 2,
      fontSize: 24,
      fontFamily: "Arial",
      fill: "#4a90d9",
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
    syncSelectionFromObject(rect);
  };

  const addImageZone = () => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;
    saveUndoState();
    const id = `image_${Date.now()}`;

    // Size the zone to fill the empty space above any existing objects
    const existingObjs = canvas.getObjects().filter(
      (o: any) => !o.__isFill && !o.__isLabel
    );
    const minTop = existingObjs.length > 0
      ? Math.min(...existingObjs.map((o: any) => (o.top ?? 0)))
      : canvas.height ?? 1500;
    const zoneW = canvas.width ?? 1000;
    const zoneH = Math.max(200, minTop);

    const rect = new fabric.Rect({
      left: 0,
      top: 0,
      width: zoneW,
      height: zoneH,
      fill: "#e0e0e0",
      rx: 0,
      ry: 0,
      selectable: true,
      strokeWidth: 2,
      stroke: "#cccccc",
    });
    (rect as any).__pinId = id;
    (rect as any).__pinLabel = "Image Zone";
    (rect as any).__pinType = "image";
    canvas.add(rect);
    const label = new fabric.FabricText("Image Zone", {
      left: zoneW / 2,
      top: zoneH / 2,
      fontSize: 24,
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
    syncSelectionFromObject(rect);
  };

  const handleUploadImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const fabric = fabricLibRef.current;
        const canvas = fabricCanvasRef.current;
        if (!fabric || !canvas || !reader.result) return;
        saveUndoState();
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
            syncSelectionFromObject(img);
          });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleReplaceFrameImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { if (reader.result) applyImage(reader.result as string); };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const updateImageTransform = (prop: "left" | "top" | "width" | "height" | "angle", value: number) => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "image") return;
    saveUndoState();
    if (prop === "left") {
      obj.set("left", value);
    } else if (prop === "top") {
      obj.set("top", value);
    } else if (prop === "width") {
      const w = obj.width ?? 1;
      if (w > 0) obj.set("scaleX", value / w);
    } else if (prop === "height") {
      const h = obj.height ?? 1;
      if (h > 0) obj.set("scaleY", value / h);
    } else if (prop === "angle") {
      obj.set("angle", value);
    }
    obj.setCoords();
    setImageProps({ [prop]: value });
    canvas.renderAll();
  };

  const zoomImage = (direction: "in" | "out") => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "image") return;
    saveUndoState();
    const factor = direction === "in" ? 1.1 : 1 / 1.1;
    const newScaleX = (obj.scaleX ?? 1) * factor;
    const newScaleY = (obj.scaleY ?? 1) * factor;

    // If image has a clip zone, enforce minimum scale so it always covers the zone
    if (obj.clipPath && obj.clipPath.absolutePositioned) {
      const clip = obj.clipPath;
      const minScaleX = (clip.width  || 0) / (obj.width  || 1);
      const minScaleY = (clip.height || 0) / (obj.height || 1);
      const minScale  = Math.max(minScaleX, minScaleY);
      obj.set({ scaleX: Math.max(minScale, newScaleX), scaleY: Math.max(minScale, newScaleY) });
      // Re-clamp position so image still covers the frame
      const imgW = (obj.width || 1) * (obj.scaleX || 1);
      const imgH = (obj.height || 1) * (obj.scaleY || 1);
      const clipLeft   = clip.left ?? 0;
      const clipTop    = clip.top  ?? 0;
      const clipRight  = clipLeft + (clip.width  || 0);
      const clipBottom = clipTop  + (clip.height || 0);
      obj.left = Math.max(clipRight - imgW / 2, Math.min(clipLeft + imgW / 2, obj.left ?? 0));
      obj.top  = Math.max(clipBottom - imgH / 2, Math.min(clipTop  + imgH / 2, obj.top  ?? 0));
    } else {
      obj.set({ scaleX: newScaleX, scaleY: newScaleY });
    }

    obj.setCoords();
    canvas.renderAll();
    syncSelectionFromObject(obj);
  };

  const flipImageHorizontal = () => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "image") return;
    saveUndoState();
    obj.set({ flipX: !obj.flipX });
    canvas.renderAll();
  };

  const flipImageVertical = () => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "image") return;
    saveUndoState();
    obj.set({ flipY: !obj.flipY });
    canvas.renderAll();
  };

  const setZoomPct = (pct: number) => setZoom(Math.max(20, Math.min(200, pct)));

  const selectedElement = layers.find((l) => l.id === selectedId);
  const selectedType = selectedElement?.type ?? null;

  // ── Loading guard ─────────────────────────────────────────────────────────

  if (!mounted) {
    return (
      <div className={`${embedded ? "absolute inset-0" : "fixed inset-0 z-50"} flex items-center justify-center bg-gray-950 text-white`}>
        Loading designer...
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={`${embedded ? "absolute inset-0" : "fixed inset-0 z-50"} flex flex-col bg-gray-950 text-white`}>

      {/* ── Floating Toolbar ──────────────────────────────────────────────── */}
      {toolbarPos && selectedId && (
        <div
          style={{
            position: "fixed",
            left: toolbarPos.x,
            top: toolbarPos.y - 52,
            transform: "translateX(-50%)",
            zIndex: 200,
            pointerEvents: "auto",
          }}
          className="flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 shadow-2xl"
          data-pin-ui
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Layer order */}
          <button onClick={sendToBack} title="Send to back" className="p-1 rounded hover:bg-gray-700 text-gray-300">
            <ChevronsDown size={14} />
          </button>
          <button onClick={moveLayerDown} title="Move down" className="p-1 rounded hover:bg-gray-700 text-gray-300">
            <ChevronDown size={14} />
          </button>
          <button onClick={moveLayerUp} title="Move up" className="p-1 rounded hover:bg-gray-700 text-gray-300">
            <ChevronUp size={14} />
          </button>
          <button onClick={bringToFront} title="Bring to front" className="p-1 rounded hover:bg-gray-700 text-gray-300">
            <ChevronsUp size={14} />
          </button>

          <div className="w-px h-4 bg-gray-700 mx-0.5" />

          {/* Text-specific */}
          {selectedType === "text" && (
            <>
              <button
                onClick={() => updateTextProperty("fontWeight", textProps.fontWeight === "bold" ? "normal" : "bold")}
                title="Bold"
                className={`p-1 rounded text-gray-300 font-bold text-xs ${textProps.fontWeight === "bold" ? "bg-brand-500 text-white" : "hover:bg-gray-700"}`}
              >
                B
              </button>
              <button
                onClick={() => updateTextProperty("textAlign", "left")}
                title="Align left"
                className={`p-1 rounded ${textProps.textAlign === "left" ? "bg-brand-500 text-white" : "text-gray-300 hover:bg-gray-700"}`}
              >
                <AlignLeft size={13} />
              </button>
              <button
                onClick={() => updateTextProperty("textAlign", "center")}
                title="Align center"
                className={`p-1 rounded ${textProps.textAlign === "center" ? "bg-brand-500 text-white" : "text-gray-300 hover:bg-gray-700"}`}
              >
                <AlignCenter size={13} />
              </button>
              <button
                onClick={() => updateTextProperty("textAlign", "right")}
                title="Align right"
                className={`p-1 rounded ${textProps.textAlign === "right" ? "bg-brand-500 text-white" : "text-gray-300 hover:bg-gray-700"}`}
              >
                <AlignRight size={13} />
              </button>
              <button
                onClick={() => updateTextProperty("fontSize", Math.max(8, textProps.fontSize - 2))}
                className="p-1 rounded hover:bg-gray-700 text-gray-300 text-xs font-mono"
                title="Decrease font size"
              >A-</button>
              <span className="text-xs text-gray-400 px-1 tabular-nums">{textProps.fontSize}</span>
              <button
                onClick={() => updateTextProperty("fontSize", Math.min(200, textProps.fontSize + 2))}
                className="p-1 rounded hover:bg-gray-700 text-gray-300 text-xs font-mono"
                title="Increase font size"
              >A+</button>
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
              {/* Text case */}
              {(["uppercase", "capitalize", "lowercase", "none"] as const).map((tc) => (
                <button
                  key={tc}
                  onClick={() => updateTextProperty("textTransform", tc)}
                  title={{ uppercase: "UPPERCASE", capitalize: "Title Case", lowercase: "lowercase", none: "Normal" }[tc]}
                  className={`p-1 rounded text-[11px] font-mono transition ${textProps.textTransform === tc ? "bg-brand-500 text-white" : "text-gray-300 hover:bg-gray-700"}`}
                >
                  {{ uppercase: "AA", capitalize: "Aa", lowercase: "aa", none: "a" }[tc]}
                </button>
              ))}
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
            </>
          )}

          {/* Image-specific */}
          {selectedType === "image" && (
            <>
              <button onClick={() => zoomImage("in")} title="Zoom in image" className="p-1 rounded hover:bg-gray-700 text-gray-300">
                <ZoomIn size={14} />
              </button>
              <button onClick={() => zoomImage("out")} title="Zoom out image" className="p-1 rounded hover:bg-gray-700 text-gray-300">
                <ZoomOut size={14} />
              </button>
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
              <button onClick={flipImageHorizontal} title="Flip horizontal" className="p-1 rounded hover:bg-gray-700 text-gray-300">
                <FlipHorizontal2 size={14} />
              </button>
              <button onClick={flipImageVertical} title="Flip vertical" className="p-1 rounded hover:bg-gray-700 text-gray-300">
                <FlipVertical2 size={14} />
              </button>
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
              <button
                onClick={handleUploadImage}
                className="p-1 rounded hover:bg-gray-700 text-gray-300 text-[11px] font-medium px-2"
                title="Replace image"
              >
                Replace
              </button>
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
            </>
          )}

          {/* imageFrame — zone selected (single click) */}
          {selectedType === "imageFrame" && !imageEditModeId && (
            <>
              <button onClick={handleReplaceFrameImage} className="p-1 rounded hover:bg-gray-700 text-gray-300 text-[11px] font-medium px-2" title="Replace image">
                Replace
              </button>
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
              <span className="text-[10px] text-gray-400 italic px-1">Double-click to reposition</span>
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
            </>
          )}

          {/* imageFrame — image edit mode (double-click, imageContent is active) */}
          {imageEditModeId && (
            <>
              <button onClick={() => zoomImageInFrame("in")} title="Zoom in" className="p-1 rounded hover:bg-gray-700 text-gray-300">
                <ZoomIn size={14} />
              </button>
              <button onClick={() => zoomImageInFrame("out")} title="Zoom out" className="p-1 rounded hover:bg-gray-700 text-gray-300">
                <ZoomOut size={14} />
              </button>
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
            </>
          )}

          {/* Band-specific */}
          {selectedType === "band" && (
            <>
              <input
                type="color"
                value={bandProps.bandFill}
                onChange={(e) => updateBandColor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border border-gray-600 bg-transparent"
                title="Band color"
              />
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
            </>
          )}

          {/* Shape-specific */}
          {selectedType === "shape" && (
            <>
              <input
                type="color"
                value={shapeProps.fill}
                onChange={(e) => updateShapeProperty("fill", e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border border-gray-600 bg-transparent"
                title="Shape color"
              />
              <div className="w-px h-4 bg-gray-700 mx-0.5" />
            </>
          )}

          {/* Lock / Unlock */}
          {(() => {
            const isLocked = layers.find((l) => l.id === selectedId)?.locked ?? false;
            return (
              <>
                <div className="w-px h-4 bg-gray-700 mx-0.5" />
                <button
                  onClick={() => selectedId && toggleLock(selectedId)}
                  title={isLocked ? "Unlock layer" : "Lock layer"}
                  className={`p-1 rounded transition ${isLocked ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30" : "hover:bg-gray-700 text-gray-300"}`}
                >
                  {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
              </>
            );
          })()}

          <div className="w-px h-4 bg-gray-700 mx-0.5" />

          {/* Delete */}
          <button
            onClick={deleteSelectedElement}
            title="Delete (Del)"
            className="p-1 rounded hover:bg-red-900 text-red-400"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 border-b border-gray-800 px-3 py-2 flex-shrink-0">
        {/* Mobile panel toggles */}
        <button
          onClick={() => { setLeftPanelOpen((v) => !v); setRightPanelOpen(false); }}
          className="md:hidden p-1.5 text-gray-400 hover:text-white rounded"
          aria-label="Toggle left panel"
        >
          <PanelLeft size={18} />
        </button>

        <span className="font-semibold text-white whitespace-nowrap">Pin Designer</span>

        <input
          value={pinName}
          onChange={(e) => setPinName(e.target.value)}
          className="hidden sm:block bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm flex-1 min-w-0 max-w-xs"
          placeholder="Template name"
        />

        <div className="flex items-center gap-1.5 ml-auto">
          {/* Single-frame export */}
          {!frames && (
            <button onClick={handleExport} className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-sm">
              <Download size={15} /> <span className="hidden sm:inline">Export</span>
            </button>
          )}
          {/* Multi-frame: Save All */}
          {frames && frames.length >= 1 && (
            <button
              onClick={handleSaveAll}
              disabled={savingAll || !selectedTemplate}
              title={
                !selectedTemplate
                  ? "Select a template first"
                  : `Save pins to recipes, embed in article HTML, and download ${frames.length} PNG(s)`
              }
              className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-sm disabled:opacity-40"
            >
              <Download size={15} />
              <span className="hidden sm:inline">
                {savingAll ? `${saveAllProgress}%` : `Save All (${frames.length})`}
              </span>
            </button>
          )}
          {/* Single frame in multi mode — export current */}
          {frames && (
            <button onClick={handleExport} className="btn-secondary flex items-center gap-1.5 px-2.5 py-1.5 text-sm">
              <Download size={15} /> <span className="hidden sm:inline">Export</span>
            </button>
          )}
          {/* Apply template to all pages */}
          {/* {frames && frames.length > 1 && selectedTemplate && (
            <button
              onClick={() => {
                frameJsonsRef.current = {};
                setFramePreviews({});
                loadTemplate(selectedTemplate, effectiveImages, effectiveTitle);
                generateAllFramePreviews(selectedTemplate);
              }}
              className="btn-secondary flex items-center gap-1.5 px-2.5 py-1.5 text-sm border-brand-700 text-brand-400"
              title="Clear all edits and re-apply current template to all pages"
            >
              <span className="hidden sm:inline">Apply to all</span>
            </button>
          )} */}
          {recipeId && !frames && (
            <button
              onClick={handleSaveToRecipe}
              disabled={savingToRecipe || !selectedTemplate}
              className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
              title="Saves pin image and appends it to the generated article HTML (before recipe card). Optional hide: .recipe-generator-pin-embed[data-pin-display=optional]{display:none}"
            >
              <Save size={15} /> <span className="hidden sm:inline">{savingToRecipe ? "Saving..." : "Save"}</span>
            </button>
          )}
          {canPublishWpBatch && (
            <>
              <button
                type="button"
                onClick={() => setShowWpScheduleModal(true)}
                disabled={!!wpBatchBusy}
                className="btn-secondary flex items-center gap-1.5 px-2 py-1.5 text-xs border-brand-700/60 text-brand-300"
                title="Configure and push all generated recipes as WordPress Scheduled posts"
              >
                <CalendarClock size={14} />
                <span className="hidden lg:inline">
                  {wpBatchBusy === "wordpress_scheduled" ? "…" : "WP Schedule"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void runWordPressBatchFromDesigner("manual_backdate")}
                disabled={!!wpBatchBusy}
                className="btn-secondary flex items-center gap-1.5 px-2 py-1.5 text-xs border-orange-800/50 text-orange-200"
                title="Publish all generated recipes now with random dates in the past 6 months"
              >
                <History size={14} />
                <span className="hidden lg:inline">
                  {wpBatchBusy === "manual_backdate" ? "…" : "WP Backdate"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowCsvModal(true)}
                disabled={!wpBatchDone}
                className="btn-secondary flex items-center gap-1.5 px-2 py-1.5 text-xs border-pink-800/50 text-pink-300 disabled:opacity-40 disabled:cursor-not-allowed"
                title={wpBatchDone ? "Download Pinterest scheduling CSV for all published pins" : "Publish to WordPress first to enable CSV download"}
              >
                <Download size={14} />
                <span className="hidden lg:inline">Pinterest CSV</span>
              </button>
              <button
                type="button"
                onClick={() => void openPinterestWorksheet()}
                disabled={!wpBatchDone || worksheetPreparing}
                className="btn-secondary flex items-center gap-1.5 px-2 py-1.5 text-xs border-blue-800/50 text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
                title={wpBatchDone ? "Open Pinterest Worksheet for all published pins" : "Publish to WordPress first to enable Pinterest Sheet"}
              >
                {worksheetPreparing ? <Loader2 size={14} className="animate-spin" /> : <Sheet size={14} />}
                <span className="hidden lg:inline">{worksheetPreparing ? "Preparing..." : "Pinterest Sheet"}</span>
              </button>
            </>
          )}
          <button
            onClick={() => { setRightPanelOpen((v) => !v); setLeftPanelOpen(false); }}
            className="md:hidden p-1.5 text-gray-400 hover:text-white rounded"
            aria-label="Toggle properties panel"
          >
            <Settings size={18} />
          </button>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
      </header>

      {/* ── Save Template Modal ───────────────────────────────────────────── */}
      {showSaveTemplateModal && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center">
          <div className="bg-gray-900 rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-semibold text-white">Save as Template</h3>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Template name *</label>
              <input
                autoFocus
                className="input-field w-full"
                value={saveTemplateName}
                onChange={(e) => setSaveTemplateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleSaveCurrentAsTemplateSubmit(); if (e.key === "Escape") setShowSaveTemplateModal(false); }}
                placeholder="My template"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Description (optional)</label>
              <input
                className="input-field w-full"
                value={saveTemplateDesc}
                onChange={(e) => setSaveTemplateDesc(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setShowSaveTemplateModal(false)}>Cancel</button>
              <button className="btn-primary" disabled={!saveTemplateName.trim()} onClick={() => void handleSaveCurrentAsTemplateSubmit()}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── WP Schedule Modal ─────────────────────────────────────────────── */}
      {showWpScheduleModal && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center">
          <div className="bg-gray-900 rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-white mb-4">WordPress Schedule Settings</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">First post publish date &amp; time</label>
                <input
                  type="datetime-local"
                  value={wpScheduleFirstAt}
                  onChange={(e) => setWpScheduleFirstAt(e.target.value)}
                  className="input-field w-full"
                />
                <p className="text-xs text-gray-500 mt-1">Article 1 will publish at this time. Each next article adds the interval below.</p>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Interval between posts (minutes)</label>
                <input
                  type="number"
                  min={1}
                  max={10080}
                  value={wpScheduleInterval}
                  onChange={(e) => setWpScheduleInterval(Number(e.target.value) || 240)}
                  className="input-field w-full"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  className="btn-primary flex-1"
                  disabled={!!wpBatchBusy}
                  onClick={async () => {
                    setShowWpScheduleModal(false);
                    await runWordPressBatchFromDesigner("wordpress_scheduled", {
                      first_publish_at: new Date(wpScheduleFirstAt).toISOString(),
                      interval_minutes: wpScheduleInterval,
                    });
                  }}
                >
                  {wpBatchBusy === "wordpress_scheduled" ? "Scheduling…" : "Schedule Now"}
                </button>
                <button className="btn-secondary flex-1" onClick={() => setShowWpScheduleModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pinterest CSV Modal ───────────────────────────────────────────── */}
      {showCsvModal && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center">
          <div className="bg-gray-900 rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-white mb-1">Download Pinterest CSV</h3>
            <p className="text-xs text-gray-400 mb-4">Configure publish schedule for the CSV. Each pin is staggered by the interval.</p>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">First pin publish date &amp; time</label>
                <input
                  type="datetime-local"
                  value={csvStartDate}
                  onChange={(e) => setCsvStartDate(e.target.value)}
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Interval between pins (minutes)</label>
                <input
                  type="number"
                  min={1}
                  max={10080}
                  value={csvInterval}
                  onChange={(e) => setCsvInterval(Number(e.target.value) || 300)}
                  className="input-field w-full"
                />
              </div>
              {csvGenerating && (
                <p className="text-xs text-gray-400">Uploading pin images to WordPress media… this may take a moment.</p>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                  disabled={csvGenerating}
                  onClick={() => void downloadPinterestCsv()}
                >
                  <Download size={14} /> {csvGenerating ? "Uploading…" : "Download CSV"}
                </button>
                <button className="btn-secondary flex-1" disabled={csvGenerating} onClick={() => setShowCsvModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pinterest Publish Modal ────────────────────────────────────────── */}
      {showPublishModal && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center">
          <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">Publish to Pinterest</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Board</label>
                <select value={selectedBoard} onChange={(e) => setSelectedBoard(e.target.value)} className="input-field w-full">
                  {pinterestBoards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Pin Title</label>
                <input value={pinTitle} onChange={(e) => setPinTitle(e.target.value)} className="input-field w-full" maxLength={100} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Description</label>
                <textarea value={pinDescription} onChange={(e) => setPinDescription(e.target.value)} className="input-field w-full" rows={3} maxLength={500} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Link URL (optional)</label>
                <input value={pinLink} onChange={(e) => setPinLink(e.target.value)} className="input-field w-full" placeholder="https://..." />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowPublishModal(false)} className="flex-1 py-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600">Cancel</button>
              <button
                onClick={handlePublish}
                disabled={publishing || !selectedBoard}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {publishing ? "Publishing..." : "Publish Pin"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pinterest Publish Success Modal ───────────────────────────────── */}
      {pinSuccessUrl !== null && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center">
          <div className="bg-gray-900 rounded-xl p-6 w-full max-w-sm text-center">
            <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Pin Published!</h3>
            <p className="text-sm text-gray-400 mb-4">Your pin was successfully published to Pinterest.</p>
            {pinSuccessUrl && (
              <a
                href={pinSuccessUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium mb-2"
              >
                View on Pinterest
              </a>
            )}
            <button
              onClick={() => setPinSuccessUrl(null)}
              className="w-full py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Mobile backdrop for panels */}
        {(leftPanelOpen || rightPanelOpen) && (
          <div
            className="fixed inset-0 z-[55] bg-black/50 md:hidden"
            onClick={() => { setLeftPanelOpen(false); setRightPanelOpen(false); }}
          />
        )}

        {/* ── Left Panel ─────────────────────────────────────────────────── */}
        <aside className={[
          "w-64 border-r border-gray-800 flex flex-col flex-shrink-0 bg-gray-950",
          "md:relative md:translate-x-0 md:flex",
          leftPanelOpen
            ? "fixed inset-y-0 left-0 z-[60] flex"
            : "hidden md:flex",
        ].join(" ")}>
          <div className="flex items-center border-b border-gray-800">
            {(["elements", "layers", "templates", "fonts"] as const).map((tab) => {
              const Icon = tab === "elements" ? Grid3X3 : tab === "layers" ? Layers : tab === "fonts" ? ALargeSmall : LayoutTemplate;
              return (
                <button
                  key={tab}
                  onClick={() => setLeftTab(tab)}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs capitalize ${leftTab === tab ? "text-brand-400 border-b-2 border-brand-500" : "text-gray-500"}`}
                >
                  <Icon size={14} /> {tab}
                </button>
              );
            })}
            <button
              onClick={() => setLeftPanelOpen(false)}
              className="md:hidden p-2 text-gray-500 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-3 overflow-y-auto flex-1">

            {/* Elements Tab */}
            {leftTab === "elements" && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Add Elements</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={addTextElement} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition">
                      <Type size={28} className="text-gray-300" />
                      <span className="text-xs text-gray-400">Text</span>
                    </button>
                    <button onClick={addImageZone} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition">
                      <ImageIcon size={28} className="text-gray-300" />
                      <span className="text-xs text-gray-400">Image Zone</span>
                    </button>
                    <button onClick={addFlipImageZone} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-blue-900 hover:border-blue-400 hover:bg-gray-800 transition">
                      <div className="relative">
                        <ImageIcon size={28} className="text-blue-400" />
                        <FlipHorizontal2 size={13} className="absolute -bottom-1 -right-1 text-blue-400" />
                      </div>
                      <span className="text-xs text-blue-400">Flip Image</span>
                    </button>
                    <button onClick={addBand} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition">
                      <div className="w-7 h-5 bg-blue-500 rounded" />
                      <span className="text-xs text-gray-400">Color Band</span>
                    </button>
                    <button onClick={addFrame} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition">
                      <Square size={28} className="text-gray-300" />
                      <span className="text-xs text-gray-400">Frame</span>
                    </button>
                    <button onClick={handleUploadImage} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition col-span-2">
                      <Upload size={28} className="text-gray-300" />
                      <span className="text-xs text-gray-400">Upload Image</span>
                    </button>
                  </div>
                </div>

                {/* ── Shapes ───────────────────────────────────────────── */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Shapes</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { type: "rect", label: "Rect", svg: <rect x="3" y="7" width="18" height="10" rx="0" fill="currentColor"/> },
                      { type: "rect-rounded", label: "Round", svg: <rect x="3" y="7" width="18" height="10" rx="4" fill="currentColor"/> },
                      { type: "circle", label: "Circle", svg: <circle cx="12" cy="12" r="9" fill="currentColor"/> },
                      { type: "ellipse", label: "Ellipse", svg: <ellipse cx="12" cy="12" rx="10" ry="6" fill="currentColor"/> },
                      { type: "triangle", label: "Tri", svg: <polygon points="12,3 22,21 2,21" fill="currentColor"/> },
                      { type: "diamond", label: "Diamond", svg: <polygon points="12,2 22,12 12,22 2,12" fill="currentColor"/> },
                      { type: "star", label: "Star", svg: <polygon points="12,2 15,9 22,9 16,14 18,21 12,17 6,21 8,14 2,9 9,9" fill="currentColor"/> },
                      { type: "hexagon", label: "Hex", svg: <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="currentColor"/> },
                      { type: "heart", label: "Heart", svg: <path d="M12 21C12 21 3 14 3 8a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 6-9 13-9 13z" fill="currentColor"/> },
                      { type: "line", label: "Line", svg: <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none"/> },
                    ] as { type: string; label: string; svg: React.ReactNode }[]).map(({ type, label, svg }) => (
                      <button
                        key={type}
                        onClick={() => addShape(type)}
                        title={label}
                        className="flex flex-col items-center gap-1 p-2 rounded-lg border border-gray-700 hover:border-brand-500 hover:bg-gray-800 transition"
                      >
                        <svg viewBox="0 0 24 24" className="w-6 h-6 text-gray-300">{svg}</svg>
                        <span className="text-[9px] text-gray-500">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Canvas Size</p>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500">Width</label>
                      <div className="bg-gray-800 rounded px-2 py-1 text-sm text-gray-300">{canvasW}</div>
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500">Height</label>
                      <div className="bg-gray-800 rounded px-2 py-1 text-sm text-gray-300">{canvasH}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Templates Tab */}
            {leftTab === "templates" && (
              <div className="space-y-4">
                {/* ── My Templates ── */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-gray-400">My templates</p>
                    <button
                      onClick={handleSaveCurrentAsTemplate}
                      className="text-xs px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200"
                      title="Save current canvas layout as a reusable template"
                    >
                      Save
                    </button>
                  </div>

                  {myTemplates.length === 0 ? (
                    <p className="text-[11px] text-gray-500">No templates yet. Design a layout and click Save to create your first template.</p>
                  ) : (
                    myTemplates.map((t) => (
                      <div
                        key={t.id}
                        className={`rounded-lg border-2 p-3 cursor-pointer transition ${selectedTemplate?.id === t.id ? "border-brand-500 bg-brand-500/10" : "border-gray-700 hover:border-gray-500"}`}
                      >
                        <p className="text-sm font-medium text-white flex items-center justify-between gap-2">
                          <span className="truncate">{t.name}</span>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleDeleteTemplate(t.id);
                            }}
                            className="text-gray-400 hover:text-red-400 p-1 rounded hover:bg-red-950/20"
                            title="Delete template"
                          >
                            <Trash2 size={14} />
                          </button>
                        </p>
                        <button
                          onClick={() => {
                            setSelectedTemplate(t);
                            onTemplateSelected?.(t.id);
                            if (frames && frames.length > 1) {
                              frameJsonsRef.current = {};
                              setFramePreviews({});
                              generateAllFramePreviews(t);
                            }
                          }}
                          className={`text-xs px-3 py-1 rounded ${selectedTemplate?.id === t.id ? "bg-brand-500 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
                        >
                          {selectedTemplate?.id === t.id ? "✓ Selected" : "Use Template"}
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* ── Shared in Project ── */}
                {sharedTemplates.length > 0 && (
                  <div className="pt-3 border-t border-gray-800 space-y-2">
                    <p className="text-xs text-gray-400">Shared in project</p>
                    {sharedTemplates.map((t) => (
                      <div
                        key={t.id}
                        className={`rounded-lg border-2 p-3 cursor-pointer transition ${selectedTemplate?.id === t.id ? "border-brand-500 bg-brand-500/10" : "border-gray-700 hover:border-gray-500"}`}
                      >
                        <p className="text-sm font-medium text-white truncate">{t.name}</p>
                        <button
                          onClick={() => {
                            setSelectedTemplate(t);
                            onTemplateSelected?.(t.id);
                            if (frames && frames.length > 1) {
                              frameJsonsRef.current = {};
                              setFramePreviews({});
                              generateAllFramePreviews(t);
                            }
                          }}
                          className={`text-xs px-3 py-1 rounded mt-2 ${selectedTemplate?.id === t.id ? "bg-brand-500 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
                        >
                          {selectedTemplate?.id === t.id ? "✓ Selected" : "Use Template"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Layers Tab */}
            {leftTab === "layers" && (
              <div className="space-y-1">
                <p className="text-xs text-gray-400 mb-2">Click to select & edit:</p>
                {layers.length === 0 && <p className="text-xs text-gray-500">No layers</p>}
                {[...layers].reverse().map((l) => (
                  <div
                    key={l.id}
                    className={`w-full px-2 py-1.5 rounded text-sm flex items-center gap-2 group ${selectedId === l.id ? "bg-brand-500/20" : "hover:bg-gray-800"} ${l.locked ? "opacity-60" : ""}`}
                  >
                    <button
                      onClick={() => selectById(l.id)}
                      className={`flex items-center gap-2 flex-1 min-w-0 text-left ${selectedId === l.id ? "text-brand-400" : "text-gray-300"}`}
                    >
                      {l.type === "image" ? <ImageIcon size={14} className="flex-shrink-0" /> : l.type === "text" ? <Type size={14} className="flex-shrink-0" /> : l.type === "band" ? <Minus size={14} className="flex-shrink-0" /> : <Square size={14} className="flex-shrink-0" />}
                      <span className="truncate">{l.label}</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleLock(l.id); }}
                      title={l.locked ? "Unlock layer" : "Lock layer"}
                      className={`flex-shrink-0 p-1 rounded transition ${l.locked ? "text-amber-400 hover:text-amber-300" : "text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100"}`}
                    >
                      {l.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Fonts Tab */}
            {leftTab === "fonts" && (
              <div className="space-y-4">
                <p className="text-xs text-gray-400 mb-1">Select a font to apply to <strong>all</strong> text elements:</p>

                {/* Google Font loader */}
                <div>
                  <label className="text-[10px] text-gray-500 block mb-1">Add Google Font</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={fontInput}
                      onChange={(e) => setFontInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") loadGoogleFont(fontInput); }}
                      placeholder="e.g. Playfair Display"
                      className="input-field text-xs flex-1 py-1.5"
                    />
                    <button
                      onClick={() => loadGoogleFont(fontInput)}
                      disabled={fontLoading || !fontInput.trim()}
                      className="p-1.5 rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      title="Load font"
                    >
                      {fontLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    </button>
                  </div>
                </div>

                {/* Custom / loaded fonts */}
                {customFonts.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Your Fonts</p>
                    <div className="space-y-0.5">
                      {customFonts.map((f) => (
                        <button
                          key={f}
                          onClick={() => { applyFontToAllText(f); }}
                          className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between transition ${textProps.fontFamily === f ? "bg-brand-500/20 text-brand-400 border border-brand-500/40" : "text-gray-300 hover:bg-gray-800"}`}
                          style={{ fontFamily: `"${f}", sans-serif` }}
                        >
                          <span>{f}</span>
                          {textProps.fontFamily === f && <Check size={14} className="text-brand-400 flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Template fonts */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Template Fonts</p>
                  <div className="space-y-0.5">
                    {["Triumvirate Compressed", "Quintus Regular", "Penumbra Sans Std"].map((f) => (
                      <button
                        key={f}
                        onClick={() => { applyFontToAllText(f); }}
                        className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between transition ${textProps.fontFamily === f ? "bg-brand-500/20 text-brand-400 border border-brand-500/40" : "text-gray-300 hover:bg-gray-800"}`}
                        style={{ fontFamily: `"${f}", sans-serif` }}
                      >
                        <span>{f}</span>
                        {textProps.fontFamily === f && <Check size={14} className="text-brand-400 flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* System fonts */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">System Fonts</p>
                  <div className="space-y-0.5">
                    {["Arial", "Georgia", "Times New Roman", "Verdana", "Courier New", "Impact"].map((f) => (
                      <button
                        key={f}
                        onClick={() => { applyFontToAllText(f); }}
                        className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between transition ${textProps.fontFamily === f ? "bg-brand-500/20 text-brand-400 border border-brand-500/40" : "text-gray-300 hover:bg-gray-800"}`}
                        style={{ fontFamily: `"${f}", sans-serif` }}
                      >
                        <span>{f}</span>
                        {textProps.fontFamily === f && <Check size={14} className="text-brand-400 flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ── Canvas Area ─────────────────────────────────────────────────── */}
        <main ref={canvasAreaRef} className="flex-1 overflow-auto bg-gray-900">
          {/* Zoom bar */}
          <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-4 py-2 flex items-center justify-center gap-2">
            <button onClick={() => setZoomPct(zoom - 10)} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700">
              <ZoomOut size={18} />
            </button>
            <span className="text-sm text-gray-400 w-14 text-center">{zoom}%</span>
            <button onClick={() => setZoomPct(zoom + 10)} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700">
              <ZoomIn size={18} />
            </button>
            <span className="text-xs text-gray-600 ml-2">Ctrl+scroll to zoom</span>
            {frames && frames.length > 1 && (
              <span className="text-xs text-gray-500 ml-2">Pages {activeFrameIdx + 1} / {frames.length}</span>
            )}
          </div>

          {frames && frames.length > 1 ? (
            /* ── Multi-page vertical layout ─────────────────────────────────── */
            <div className="p-4 sm:p-6 flex flex-col items-center gap-4">
              {/* Preview pages BEFORE active */}
              {frames.slice(0, activeFrameIdx).map((f, i) => (
                <div key={f.recipeId} className="flex flex-col items-center">
                  <div className="flex items-center gap-2 mb-1 text-gray-500" style={{ width: `${canvasW * zoom / 100}px` }}>
                    <span className="text-xs font-semibold">Page {i + 1}</span>
                    <span className="text-xs truncate flex-1">{f.title}</span>
                    {frameJsonsRef.current[i] && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" title="Edited" />}
                  </div>
                  <div
                    onClick={() => switchToFrame(i)}
                    className="cursor-pointer group relative"
                    style={{ width: `${canvasW * zoom / 100}px`, height: `${canvasH * zoom / 100}px` }}
                  >
                    <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left", width: canvasW, height: canvasH, position: "absolute", top: 0, left: 0 }}
                         className="shadow-lg rounded-lg overflow-hidden border-2 border-gray-700 group-hover:border-gray-500 transition">
                      {framePreviews[i] ? (
                        <img src={framePreviews[i]} alt={f.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                          <p className="text-sm text-gray-600">Click to edit</p>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 transition text-white text-sm font-medium bg-black/60 px-3 py-1.5 rounded-lg">Click to edit</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* ── Active page: live canvas (stable DOM position) ────────── */}
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-2 mb-1 text-brand-400" style={{ width: `${canvasW * zoom / 100}px` }}>
                  <span className="text-xs font-semibold">Page {activeFrameIdx + 1}</span>
                  <span className="text-xs truncate flex-1">{effectiveTitle}</span>
                </div>
                <div className="relative" style={{ width: `${canvasW * zoom / 100}px`, height: `${canvasH * zoom / 100}px` }}>
                  <div
                    ref={canvasWrapperRef}
                    style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left", width: canvasW, height: canvasH, position: "absolute", top: 0, left: 0 }}
                    className="shadow-2xl rounded-lg overflow-hidden border-2 border-brand-500"
                  >
                    <canvas ref={canvasRef} />
                    {!selectedTemplate && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 rounded-lg">
                        <div className="text-center px-6 py-4">
                          <LayoutTemplate size={48} className="mx-auto text-gray-500 mb-3" />
                          <p className="text-gray-400 font-medium">Select a template to get started</p>
                          <p className="text-sm text-gray-500 mt-1">Choose from the Templates panel on the left</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Preview pages AFTER active */}
              {frames.slice(activeFrameIdx + 1).map((f, sliceI) => {
                const i = activeFrameIdx + 1 + sliceI;
                return (
                  <div key={f.recipeId} className="flex flex-col items-center">
                    <div className="flex items-center gap-2 mb-1 text-gray-500" style={{ width: `${canvasW * zoom / 100}px` }}>
                      <span className="text-xs font-semibold">Page {i + 1}</span>
                      <span className="text-xs truncate flex-1">{f.title}</span>
                      {frameJsonsRef.current[i] && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" title="Edited" />}
                    </div>
                    <div
                      onClick={() => switchToFrame(i)}
                      className="cursor-pointer group relative"
                      style={{ width: `${canvasW * zoom / 100}px`, height: `${canvasH * zoom / 100}px` }}
                    >
                      <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left", width: canvasW, height: canvasH, position: "absolute", top: 0, left: 0 }}
                           className="shadow-lg rounded-lg overflow-hidden border-2 border-gray-700 group-hover:border-gray-500 transition">
                        {framePreviews[i] ? (
                          <img src={framePreviews[i]} alt={f.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                            <p className="text-sm text-gray-600">Click to edit</p>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 transition text-white text-sm font-medium bg-black/60 px-3 py-1.5 rounded-lg">Click to edit</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Single canvas (no frames) ──────────────────────────────────── */
            <div className="p-4 sm:p-8 flex justify-center">
              <div className="relative" style={{ width: `${canvasW * zoom / 100}px`, height: `${canvasH * zoom / 100}px` }}>
                <div
                  ref={canvasWrapperRef}
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left", width: canvasW, height: canvasH, position: "absolute", top: 0, left: 0 }}
                  className="shadow-2xl rounded-lg overflow-hidden border-2 border-gray-600"
                >
                  <canvas ref={canvasRef} />
                  {!selectedTemplate && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 rounded-lg">
                      <div className="text-center px-6 py-4">
                        <LayoutTemplate size={48} className="mx-auto text-gray-500 mb-3" />
                        <p className="text-gray-400 font-medium">Select a template to get started</p>
                        <p className="text-sm text-gray-500 mt-1">Choose from the Templates panel on the left</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* ── Right Panel (Properties) ────────────────────────────────────── */}
        <aside data-pin-ui className={[
          "w-72 border-l border-gray-800 p-4 overflow-y-auto flex-shrink-0 bg-gray-950",
          rightPanelOpen
            ? "fixed inset-y-0 right-0 z-[60] flex flex-col"
            : "hidden md:block",
        ].join(" ")}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase">Properties</h4>
            <button
              onClick={() => setRightPanelOpen(false)}
              className="md:hidden p-1 text-gray-500 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          {selectedElement ? (
            <div className="space-y-4">
              {/* Object header */}
              <div className="p-3 bg-gray-800 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{selectedElement.label}</p>
                  <p className="text-xs text-gray-500">
                    {selectedType === "image" ? "Image slot" : selectedType === "imageFrame" ? "Image zone" : selectedType === "band" ? "Color band" : selectedType === "frame" ? "Border frame" : selectedType === "shape" ? "Shape" : "Text element"}
                  </p>
                </div>
                <button onClick={deleteSelectedElement} className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg transition" title="Delete (Del)">
                  <Trash2 size={18} />
                </button>
              </div>

              {/* Layer order */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Layer Order</label>
                <div className="flex gap-1">
                  <button onClick={sendToBack} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 text-xs" title="Send to Back">
                    <ChevronsDown size={14} />
                  </button>
                  <button onClick={moveLayerDown} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 text-xs" title="Move Down">
                    <ChevronDown size={14} />
                  </button>
                  <button onClick={moveLayerUp} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 text-xs" title="Move Up">
                    <ChevronUp size={14} />
                  </button>
                  <button onClick={bringToFront} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 text-xs" title="Bring to Front">
                    <ChevronsUp size={14} />
                  </button>
                </div>
              </div>

              {/* Pinterest publish shortcut */}
              {projectId && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Publish Design</label>
                  <button
                    onClick={() => setShowPublishModal(true)}
                    disabled={!pinterestConnected}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    title={pinterestConnected ? "Publish to Pinterest" : "Connect Pinterest first"}
                  >
                    <Send size={14} /> Pinterest
                  </button>
                </div>
              )}

              {/* ── Text Properties ──────────────────────────────────────── */}
              {selectedType === "text" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Text Content</label>
                    <textarea
                      value={textProps.editText}
                      onChange={(e) => setTextProps({ editText: e.target.value })}
                      onBlur={applyEditText}
                      rows={2}
                      className="input-field text-sm w-full"
                      placeholder="Enter text..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Text Properties</label>
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] text-gray-500">Font Family</label>
                        <select value={textProps.fontFamily} onChange={(e) => updateTextProperty("fontFamily", e.target.value, true)} className="input-field text-sm w-full">
                          {customFonts.length > 0 && (
                            <optgroup label="Your fonts">
                              {customFonts.map((f) => <option key={f} value={f}>{f}</option>)}
                            </optgroup>
                          )}
                          <optgroup label="Template fonts">
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
                        <div className="flex gap-1 mt-1.5">
                          <input
                            type="text"
                            value={fontInput}
                            onChange={(e) => setFontInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") loadGoogleFont(fontInput); }}
                            placeholder="Add Google Font..."
                            className="input-field text-xs flex-1 py-1"
                          />
                          <button
                            onClick={() => loadGoogleFont(fontInput)}
                            disabled={fontLoading || !fontInput.trim()}
                            className="p-1.5 rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
                            title="Load font"
                          >
                            {fontLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500">Font Size</label>
                          <input type="number" value={textProps.fontSize} onChange={(e) => updateTextProperty("fontSize", e.target.value, true)} className="input-field text-sm w-full" min="8" max="200" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500">Font Weight</label>
                          <select value={textProps.fontWeight} onChange={(e) => updateTextProperty("fontWeight", e.target.value, true)} className="input-field text-sm w-full">
                            <option value="normal">Normal</option>
                            <option value="bold">Bold</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Text Align</label>
                    <div className="flex gap-1">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button
                          key={a}
                          onClick={() => updateTextProperty("textAlign", a)}
                          className={`flex-1 py-1.5 rounded text-xs font-medium transition ${textProps.textAlign === a ? "bg-brand-500 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
                        >
                          {a.charAt(0).toUpperCase() + a.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Text Case</label>
                    <div className="flex gap-1">
                      {([["uppercase", "AA", "UPPERCASE"], ["capitalize", "Aa", "Title Case"], ["lowercase", "aa", "lowercase"], ["none", "a", "Normal"]] as const).map(([val, label, title]) => (
                        <button
                          key={val}
                          onClick={() => updateTextProperty("textTransform", val)}
                          title={title}
                          className={`flex-1 py-1.5 rounded text-xs font-mono transition ${textProps.textTransform === val ? "bg-brand-500 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Text Color</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={textProps.textColor} onChange={(e) => updateTextProperty("fill", e.target.value)} className="w-10 h-8 rounded border border-gray-600 cursor-pointer" />
                      <input type="text" value={textProps.textColor} onChange={(e) => updateTextProperty("fill", e.target.value)} className="input-field text-sm flex-1" placeholder="#000000" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Quick Colors</label>
                    <div className="flex gap-1 flex-wrap">
                      {["#000000", "#ffffff", "#e63946", "#2d5016", "#1d3557", "#f4a261", "#2a9d8f", "#9b59b6"].map((c) => (
                        <button key={c} onClick={() => updateTextProperty("fill", c)} className={`w-6 h-6 rounded border-2 ${textProps.textColor === c ? "border-brand-500" : "border-gray-600"}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                  <button onClick={applyEditText} className="btn-primary text-xs px-3 py-1.5 w-full">Apply Text</button>
                </div>
              )}

              {/* ── Image Properties ─────────────────────────────────────── */}
              {selectedType === "image" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Position & Size</label>
                    <p className="text-[10px] text-gray-500 mb-2">Drag on canvas to reposition. Use inputs for precision:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([["X", "left", imageProps.left], ["Y", "top", imageProps.top], ["W", "width", imageProps.width], ["H", "height", imageProps.height]] as const).map(([label, prop, val]) => (
                        <div key={prop}>
                          <label className="text-[10px] text-gray-500">{label}</label>
                          <input type="number" value={val} onChange={(e) => updateImageTransform(prop, Math.max(1, parseInt(e.target.value) || 0))} className="input-field text-sm w-full" />
                        </div>
                      ))}
                      <div className="col-span-2">
                        <label className="text-[10px] text-gray-500">Rotation (°)</label>
                        <input type="number" value={imageProps.angle} onChange={(e) => updateImageTransform("angle", parseInt(e.target.value) || 0)} className="input-field text-sm w-full" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-2">Choose Image</label>
                    {effectiveImages.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {effectiveImages.map((url, i) => (
                          <button
                            key={i}
                            onClick={() => applyImage(url)}
                            className="rounded-lg overflow-hidden border-2 border-gray-700 hover:border-brand-500 transition relative group"
                          >
                            <img
                              src={proxyUrl(url)}
                              alt={`Image ${i + 1}`}
                              className="w-full h-20 object-cover"
                              crossOrigin="anonymous"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                img.style.display = "none";
                                const ph = img.nextElementSibling as HTMLElement | null;
                                if (ph) ph.style.display = "flex";
                              }}
                            />
                            <div style={{ display: "none" }} className="w-full h-20 bg-gray-700 items-center justify-center text-gray-400 text-[10px]">
                              {i === 0 ? "Original" : `Variant ${i}`}
                            </div>
                            <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center bg-black/50 text-white py-0.5 opacity-0 group-hover:opacity-100 transition">
                              {i === 0 ? "Original" : `Variant ${i}`}
                            </span>
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
                        onKeyDown={(e) => { if (e.key === "Enter") applyImage((e.target as HTMLInputElement).value); }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Image Frame Properties ───────────────────────────────── */}
              {selectedType === "imageFrame" && (
                <div className="space-y-4">
                  {!imageEditModeId ? (
                    <>
                      <div>
                        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Image Zone</label>
                        <p className="text-[10px] text-gray-500">Single-click to move the zone. Double-click to reposition the image inside.</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-2">Choose Image</label>
                        {effectiveImages.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2">
                            {effectiveImages.map((url, i) => (
                              <button
                                key={i}
                                onClick={() => applyImage(url)}
                                className="rounded-lg overflow-hidden border-2 border-gray-700 hover:border-brand-500 transition relative group"
                              >
                                <img src={proxyUrl(url)} alt={`Image ${i + 1}`} className="w-full h-20 object-cover" crossOrigin="anonymous"
                                  onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = "none"; const ph = img.nextElementSibling as HTMLElement | null; if (ph) ph.style.display = "flex"; }}
                                />
                                <div style={{ display: "none" }} className="w-full h-20 bg-gray-700 items-center justify-center text-gray-400 text-[10px]">
                                  {i === 0 ? "Original" : `Variant ${i}`}
                                </div>
                                <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center bg-black/50 text-white py-0.5 opacity-0 group-hover:opacity-100 transition">
                                  {i === 0 ? "Original" : `Variant ${i}`}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500 mb-2">No recipe images available</p>
                        )}
                        <div className="mt-3">
                          <label className="text-xs text-gray-400 block mb-1">Or paste URL:</label>
                          <input className="input-field text-sm w-full" placeholder="https://..." onKeyDown={(e) => { if (e.key === "Enter") applyImage((e.target as HTMLInputElement).value); }} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Edit Image</label>
                      <p className="text-[10px] text-gray-500 mb-3">Drag to reposition. Use zoom to scale. Click outside to exit.</p>
                      <div className="flex gap-2">
                        <button onClick={() => zoomImageInFrame("in")} className="flex-1 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 flex items-center justify-center gap-1">
                          <ZoomIn size={12} /> Zoom In
                        </button>
                        <button onClick={() => zoomImageInFrame("out")} className="flex-1 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 flex items-center justify-center gap-1">
                          <ZoomOut size={12} /> Zoom Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Band Properties ──────────────────────────────────────── */}
              {selectedType === "band" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Band Color</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={bandProps.bandFill} onChange={(e) => updateBandColor(e.target.value)} className="w-10 h-8 rounded border border-gray-600 cursor-pointer bg-transparent" />
                      <span className="text-xs text-gray-400">Click to change color</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Transparency</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="range" min="0" max="100"
                        value={Math.round(bandProps.bandOpacity * 100)}
                        onChange={(e) => updateBandColor(bandProps.bandFill, parseInt(e.target.value) / 100)}
                        className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-700 accent-brand-500"
                      />
                      <span className="text-xs text-gray-400 w-10">{Math.round(bandProps.bandOpacity * 100)}%</span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">0% = transparent, 100% = opaque</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Quick Colors</label>
                    <div className="flex gap-1 flex-wrap">
                      {["#ffffff", "#ffecd2", "#ffd4d4", "#1565c0", "#2d3436", "#e63946", "#2a9d8f", "#f4a261", "#000000"].map((c) => (
                        <button key={c} onClick={() => updateBandColor(c)} className="w-6 h-6 rounded border-2 border-gray-600 hover:border-brand-500" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Frame Properties ─────────────────────────────────────── */}
              {selectedType === "frame" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Border Style</label>
                    <div className="flex gap-1">
                      {(["solid", "dashed", "dotted"] as const).map((style) => (
                        <button
                          key={style}
                          onClick={() => updateFrameProperty("strokeStyle", style)}
                          className={`flex-1 py-2 rounded text-xs font-medium transition flex flex-col items-center gap-1 ${frameProps.strokeStyle === style ? "bg-brand-500 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
                        >
                          <div className="w-8 h-0 border-t-2" style={{ borderStyle: style, borderColor: frameProps.strokeStyle === style ? "white" : "#9ca3af" }} />
                          <span className="capitalize">{style}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Border Width</label>
                    <div className="flex gap-2 items-center">
                      <input type="range" min="1" max="20" value={frameProps.strokeWidth} onChange={(e) => updateFrameProperty("strokeWidth", e.target.value)} className="flex-1" />
                      <span className="text-sm text-gray-300 w-8">{frameProps.strokeWidth}px</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Corner Radius</label>
                    <div className="flex gap-2 items-center">
                      <input type="range" min="0" max="50" value={frameProps.rx} onChange={(e) => updateFrameProperty("rx", e.target.value)} className="flex-1" />
                      <span className="text-sm text-gray-300 w-8">{frameProps.rx}px</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Border Color</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={frameProps.strokeColor} onChange={(e) => updateFrameProperty("stroke", e.target.value)} className="w-10 h-8 rounded border border-gray-600 cursor-pointer" />
                      <input type="text" value={frameProps.strokeColor} onChange={(e) => updateFrameProperty("stroke", e.target.value)} className="input-field text-sm flex-1" placeholder="#000000" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Quick Colors</label>
                    <div className="flex gap-1 flex-wrap">
                      {["#000000", "#333333", "#666666", "#ffffff", "#e63946", "#1565c0", "#2a9d8f", "#f4a261", "#9b59b6"].map((c) => (
                        <button key={c} onClick={() => updateFrameProperty("stroke", c)} className={`w-6 h-6 rounded border-2 ${frameProps.strokeColor === c ? "border-brand-500" : "border-gray-600"}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Shape Properties ─────────────────────────────────────── */}
              {selectedType === "shape" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-400 uppercase block mb-2">Fill Color</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={shapeProps.fill} onChange={(e) => updateShapeProperty("fill", e.target.value)} className="w-10 h-8 rounded border border-gray-600 cursor-pointer bg-transparent" />
                      <input type="text" value={shapeProps.fill} onChange={(e) => updateShapeProperty("fill", e.target.value)} className="input-field text-sm flex-1" placeholder="#6366f1" />
                    </div>
                    <div className="flex gap-1 flex-wrap mt-2">
                      {["#ffffff", "#000000", "#6366f1", "#e63946", "#f4a261", "#2a9d8f", "#1565c0", "#f1c40f", "#9b59b6", "#2d3436", "#ffecd2", "#ffd4d4"].map((c) => (
                        <button key={c} onClick={() => updateShapeProperty("fill", c)} className={`w-6 h-6 rounded border-2 ${shapeProps.fill === c ? "border-brand-500" : "border-gray-600"}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Opacity</label>
                    <div className="flex gap-2 items-center">
                      <input type="range" min="10" max="100" step="5" value={shapeProps.opacity} onChange={(e) => updateShapeProperty("opacity", e.target.value)} className="flex-1" />
                      <span className="text-sm text-gray-300 w-10">{shapeProps.opacity}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Border Width</label>
                    <div className="flex gap-2 items-center">
                      <input type="range" min="0" max="20" value={shapeProps.strokeWidth} onChange={(e) => updateShapeProperty("strokeWidth", e.target.value)} className="flex-1" />
                      <span className="text-sm text-gray-300 w-8">{shapeProps.strokeWidth}px</span>
                    </div>
                  </div>
                  {shapeProps.strokeWidth > 0 && (
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Border Color</label>
                      <div className="flex gap-2 items-center">
                        <input type="color" value={shapeProps.strokeColor} onChange={(e) => updateShapeProperty("strokeColor", e.target.value)} className="w-10 h-8 rounded border border-gray-600 cursor-pointer bg-transparent" />
                        <input type="text" value={shapeProps.strokeColor} onChange={(e) => updateShapeProperty("strokeColor", e.target.value)} className="input-field text-sm flex-1" placeholder="#333333" />
                      </div>
                    </div>
                  )}
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

      {/* ── Save All progress overlay ─────────────────────────────────────── */}
      {savingAll && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 text-center min-w-[200px]">
            <p className="text-white font-semibold mb-3">Generating {frames?.length} pins…</p>
            <div className="w-48 bg-gray-700 rounded-full h-2 mx-auto">
              <div className="bg-brand-500 h-2 rounded-full transition-all" style={{ width: `${saveAllProgress}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-2">{saveAllProgress}%</p>
          </div>
        </div>
      )}
    </div>
  );
}
