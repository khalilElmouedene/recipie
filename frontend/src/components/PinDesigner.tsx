"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  X, Download, ZoomIn, ZoomOut, Layers, LayoutTemplate, Grid3X3,
  Type, Upload, Image as ImageIcon, Minus, Trash2, Square,
  Send, Save, AlignLeft, AlignCenter,
  AlignRight, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown,
  PanelLeft, PanelRight, Settings,
} from "lucide-react";
import { api, getApiBaseUrl } from "@/lib/api";
import { useDesignerStore } from "@/store/useDesignerStore";
import type { StrokeStyle, ShapeProps } from "@/store/useDesignerStore";

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
  type: "image" | "text" | "band" | "frame" | "circle";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defaultText?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  fill?: string;
  bgColor?: string;
  textAlign?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  radius?: number;
}

export interface PinTemplate {
  id: string;
  name: string;
  description: string;
  previewLayout:
    | "simple" | "grid4" | "grid6" | "hero" | "sandwich" | "card-overlap"
    | "band-white" | "band-blue" | "band-peach" | "band-brown";
  bgColor: string;
  elements: TemplateElement[];
  exampleImage?: string;
}

// ─── Templates ───────────────────────────────────────────────────────────────

export const TEMPLATES: PinTemplate[] = [
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

// ─── Standalone template renderer (used for batch Save All) ──────────────────

export async function buildTemplateOnCanvas(
  fabric: any,
  canvas: any,
  template: PinTemplate,
  images: string[],
  proxyBase: string,
  title: string = "Recipe Title",
): Promise<void> {
  canvas.clear();
  canvas.backgroundColor = template.bgColor;
  let imageIndex = 0;

  const proxyUrl = (url: string) => {
    if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/")) return url;
    return `${proxyBase}/api/image-proxy?url=${encodeURIComponent(url)}`;
  };

  for (const el of template.elements) {
    if (el.type === "image") {
      const imageUrl = images.length > 0 ? (images[imageIndex % images.length]?.trim() || "") : "";
      imageIndex++;
      if (imageUrl) {
        try {
          const img = await fabric.FabricImage.fromURL(proxyUrl(imageUrl), { crossOrigin: "anonymous" });
          const scale = Math.max(el.width / (img.width || 1), el.height / (img.height || 1));
          img.set({ left: el.x + el.width / 2, top: el.y + el.height / 2, originX: "center", originY: "center", scaleX: scale, scaleY: scale });
          (img as any).__pinId = el.id; (img as any).__pinType = "image";
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
      const shape = el.type === "circle"
        ? new fabric.Circle({ left: el.x, top: el.y, radius: el.radius || 60, fill: el.bgColor || "#8b0000", originX: "center", originY: "center" })
        : new fabric.Rect({ left: el.x, top: el.y, width: el.width, height: el.height, fill: el.bgColor || "#ffffff", strokeWidth: 0 });
      canvas.add(shape);
    } else if (el.type === "text") {
      const text = el.id === "title" ? title : (el.defaultText || "");
      const tb = new fabric.Textbox(text, {
        left: el.x, top: el.y, width: el.width || 940, originX: "center", originY: "center",
        fontSize: el.fontSize || 32, fontFamily: "Arial", fontWeight: el.fontWeight || "normal",
        fontStyle: (el.fontStyle as any) || "normal", fill: el.fill || "#333333", textAlign: el.textAlign || "center",
      });
      canvas.add(tb);
    }
  }

  // Stretch last element to fill canvas height
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
}: PinDesignerProps) {
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

  // ── Zustand store ───────────────────────────────────────────────────────
  const {
    selectedId, setSelectedId,
    layers, setLayers,
    leftTab, setLeftTab,
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
  const [mounted, setMounted] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PinTemplate | null>(null);
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
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

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
        alert(`Failed: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  // ── Canvas helpers ────────────────────────────────────────────────────────

  const getExportDataUrl = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return null;
    canvas.getObjects().filter((o: any) => o.__isLabel).forEach((o: any) => o.set("visible", false));
    canvas.renderAll();
    const data = canvas.toDataURL({ format: "png", multiplier: 1 });
    canvas.getObjects().filter((o: any) => o.__isLabel).forEach((o: any) => o.set("visible", true));
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

  const handleSaveToRecipe = async () => {
    if (!recipeId) return;
    const data = getExportDataUrl();
    if (!data) return;
    setSavingToRecipe(true);
    try {
      await api.updateRecipe(recipeId, {
        pin_design_image: data,
        pin_title: recipePinTitle || initialTitle,
        pin_description: recipePinDescription || initialTitle,
      });
      alert("Design saved to recipe.");
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
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
        editText: obj.text ?? "",
        fontFamily: obj.fontFamily ?? "Arial",
        fontSize: obj.fontSize ?? 32,
        fontWeight: obj.fontWeight ?? "normal",
        textAlign: obj.textAlign ?? "center",
        textColor: obj.fill ?? "#333333",
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
    } else if (obj.__pinType === "image") {
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
  const UNDO_CUSTOM_KEYS = ["__pinId", "__pinLabel", "__pinType", "__isLabel", "__forId", "__strokeStyle"];

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

      const objs = canvas.getObjects().filter((o: any) => o.__pinId && !o.__isLabel);
      setLayers(objs.map((o: any) => ({ id: o.__pinId, label: o.__pinLabel || o.__pinId, type: o.__pinType })));
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
          editText: restoredObj.text ?? "",
          fontFamily: restoredObj.fontFamily ?? "Arial",
          fontSize: restoredObj.fontSize ?? 32,
          fontWeight: restoredObj.fontWeight ?? "normal",
          textAlign: restoredObj.textAlign ?? "center",
          textColor: restoredObj.fill ?? "#333333",
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
    const objs = canvas.getObjects().filter((o: any) => o.__pinId && !o.__isLabel);
    setLayers(objs.map((o: any) => ({ id: o.__pinId, label: o.__pinLabel || o.__pinId, type: o.__pinType })));
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

  // ── Template loading ──────────────────────────────────────────────────────

  const loadTemplate = async (template: PinTemplate) => {
    const fabric = fabricLibRef.current;
    const canvas = fabricCanvasRef.current;
    if (!fabric || !canvas) return;

    undoHistoryRef.current = [];
    canvas.clear();
    canvas.backgroundColor = template.bgColor;

    const { Rect, FabricText } = fabric;
    let imageIndex = 0;

    for (const el of template.elements) {
      if (el.type === "image") {
        const imageUrl = recipeImages.length > 0 ? (recipeImages[imageIndex % recipeImages.length]?.trim() || "") : "";
        imageIndex++;
        let imageLoaded = false;

        if (imageUrl) {
          try {
            const img = await fabric.FabricImage.fromURL(proxyUrl(imageUrl), { crossOrigin: "anonymous" });
            const zoneW = el.width;
            const zoneH = el.height;
            const imgW = img.width || 1;
            const imgH = img.height || 1;

            // Cover fit: fill zone completely, crop overflow
            const scale = Math.max(zoneW / imgW, zoneH / imgH);
            img.set({
              left: el.x + zoneW / 2,
              top: el.y + zoneH / 2,
              originX: "center",
              originY: "center",
              scaleX: scale,
              scaleY: scale,
              selectable: true,
              hasControls: true,
              hasBorders: true,
              cornerSize: 12,
              cornerColor: "#6366f1",
              borderColor: "#6366f1",
            });

            (img as any).__pinId = el.id;
            (img as any).__pinLabel = el.label;
            (img as any).__pinType = "image";

            // Clip the image to its zone so it never visually overlaps adjacent elements
            const clipRect = new fabric.Rect({
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              absolutePositioned: true,
              fill: "",
            });
            (img as any).clipPath = clipRect;

            canvas.add(img);
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
        canvas.add(band);
      } else if (el.type === "text") {
        const textContent = el.id === "title" && initialTitle ? initialTitle : (el.defaultText || "Text");
        const textbox = new fabric.Textbox(
          textContent,
          {
            left: el.x,
            top: el.y,
            width: el.width || 940,
            fontSize: el.fontSize || 32,
            fontFamily: "Arial",
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
        canvas.add(textbox);
      }
    }


    // ── Stretch the last image/band element to fill the full canvas height ──
    // This eliminates the empty background gap at the bottom of the pin.
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
          selectedIdRef.current = null;
          activeObjRef.current = null;
          setSelectedId(null);
          setTextProps({ editText: "" });
          setToolbarPos(null);
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
          } else if (target.__pinType === "image") {
            canvas.setActiveObject(target);
            canvas.bringObjectToFront(target);
            target.set({ hasControls: true, hasBorders: true, cornerSize: 12, cornerColor: "#6366f1", borderColor: "#6366f1" });
            syncSelectionFromObject(target);
            canvas.renderAll();
          }
        });

        // ── Transform events (undo + toolbar) ────────────────────────────
        canvas.on("object:moving", (e: any) => {
          if (!transformSaveDoneRef.current) {
            transformSaveDoneRef.current = true;
            saveUndoState();
          }
          const obj = e.target as any;
          // Canva-like frame behavior: image is locked inside its clip zone.
          // The clip zone (frame) stays fixed; the image pans within it.
          // Constrain image so it always fully covers the frame (no empty corners).
          if (obj?.clipPath && obj.clipPath.absolutePositioned) {
            const clip = obj.clipPath;
            const imgW = (obj.width || 1) * (obj.scaleX || 1);
            const imgH = (obj.height || 1) * (obj.scaleY || 1);
            const clipLeft   = clip.left ?? 0;
            const clipTop    = clip.top  ?? 0;
            const clipRight  = clipLeft + (clip.width  || 0);
            const clipBottom = clipTop  + (clip.height || 0);
            // With originX/Y "center": image center must stay in range that keeps image covering clip
            const minLeft = clipRight  - imgW / 2;
            const maxLeft = clipLeft   + imgW / 2;
            const minTop  = clipBottom - imgH / 2;
            const maxTop  = clipTop    + imgH / 2;
            obj.left = Math.max(minLeft, Math.min(maxLeft, obj.left));
            obj.top  = Math.max(minTop,  Math.min(maxTop,  obj.top));
          }
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
    canvas.loadFromJSON(initialJson)
      .then(() => { canvas.renderAll(); updateLayers(); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasReady]);

  // Auto-apply initial template (only if no saved JSON)
  useEffect(() => {
    if (!canvasReady || initialJson || !initialTemplateId) return;
    const tmpl = TEMPLATES.find((t) => t.id === initialTemplateId);
    if (tmpl) setSelectedTemplate(tmpl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasReady]);

  // Expose API to parent once canvas ready
  useEffect(() => {
    if (!canvasReady || !onApiReady) return;
    onApiReady({
      getJson: () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return "{}";
        return JSON.stringify(canvas.toObject(["__pinId", "__pinLabel", "__pinType", "__isLabel", "__forId", "__strokeStyle"]));
      },
      exportPng: getExportDataUrl,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasReady]);

  // Load template when ready (skip if initialJson already loaded)
  useEffect(() => {
    if (canvasReady && selectedTemplate && !initialJson) loadTemplate(selectedTemplate);
  }, [selectedTemplate, canvasReady]);

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

  // ── Actions ───────────────────────────────────────────────────────────────

  const deleteSelectedElement = () => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj) return;
    saveUndoState();
    const pid = obj.__pinId;
    canvas.remove(obj);
    const label = canvas.getObjects().find((o: any) => o.__forId === pid);
    if (label) canvas.remove(label);
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
    obj.set("text", textProps.editText);
    if (typeof obj.initDimensions === "function") obj.initDimensions();
    obj.setCoords();
    canvas.renderAll();
  };

  const updateTextProperty = (property: string, value: any) => {
    const canvas = fabricCanvasRef.current;
    const obj = getSelectedObject();
    if (!canvas || !obj || obj.__pinType !== "text") return;
    saveUndoState();
    const propName = property === "fill" ? "fill" : property;
    const propValue = property === "fontSize" ? parseInt(value) : value;
    obj.set(propName, propValue);
    if (typeof obj.initDimensions === "function") obj.initDimensions();
    obj.setCoords();
    setTextProps({ [property === "fill" ? "textColor" : property]: propValue });
    canvas.renderAll();
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
    if (target.__pinType !== "image") return;
    saveUndoState();

    // Get zone bounds from existing object
    const br = target.getBoundingRect?.();
    const zoneLeft = br ? br.left : (target.left ?? 0);
    const zoneTop = br ? br.top : (target.top ?? 0);
    const zoneW = br ? br.width : (target.width ?? 400) * (target.scaleX ?? 1);
    const zoneH = br ? br.height : (target.height ?? 400) * (target.scaleY ?? 1);

    fabric.FabricImage.fromURL(proxyUrl(imageUrl.trim()), { crossOrigin: "anonymous" })
      .then((img: any) => {
        if (!img || !img.width) throw new Error("Empty image");

        const imgW = img.width || 1;
        const imgH = img.height || 1;
        // Cover fit
        const scale = Math.max(zoneW / imgW, zoneH / imgH);
        img.set({
          left: zoneLeft + zoneW / 2,
          top: zoneTop + zoneH / 2,
          originX: "center",
          originY: "center",
          scaleX: scale,
          scaleY: scale,
          hasControls: true,
          hasBorders: true,
          cornerSize: 12,
          cornerColor: "#6366f1",
          borderColor: "#6366f1",
        });

        const pid = target.__pinId;
        img.__pinId = pid;
        img.__pinLabel = target.__pinLabel;
        img.__pinType = "image";

        // Inherit the clip zone from the replaced object, or build a new one from its bounds
        const existingClip = target.clipPath;
        if (existingClip && (existingClip as any).absolutePositioned) {
          img.clipPath = existingClip;
        } else {
          img.clipPath = new fabric.Rect({
            left: zoneLeft,
            top: zoneTop,
            width: zoneW,
            height: zoneH,
            absolutePositioned: true,
            fill: "",
          });
        }

        canvas.remove(target);
        const label = canvas.getObjects().find((o: any) => o.__forId === pid);
        if (label) canvas.remove(label);
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
        updateLayers();
        syncSelectionFromObject(img);
      })
      .catch(() => {
        console.warn("Could not load image:", imageUrl);
        alert("Could not load image — the URL may have expired. Try uploading the image directly.");
      });
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
            </>
          )}

          {/* Image-specific */}
          {selectedType === "image" && (
            <>
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
          <button onClick={handleExport} className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-sm">
            <Download size={15} /> <span className="hidden sm:inline">Export</span>
          </button>
          {recipeId && (
            <button
              onClick={handleSaveToRecipe}
              disabled={savingToRecipe || !selectedTemplate}
              className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
            >
              <Save size={15} /> <span className="hidden sm:inline">{savingToRecipe ? "Saving..." : "Save"}</span>
            </button>
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
            {(["elements", "layers", "templates"] as const).map((tab) => {
              const Icon = tab === "elements" ? Grid3X3 : tab === "layers" ? Layers : LayoutTemplate;
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

            {/* Templates Tab */}
            {leftTab === "templates" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 mb-2">Choose a template:</p>
                {TEMPLATES.map((t) => (
                  <div
                    key={t.id}
                    className={`rounded-lg border-2 p-3 cursor-pointer transition ${selectedTemplate?.id === t.id ? "border-brand-500 bg-brand-500/10" : "border-gray-700 hover:border-gray-500"}`}
                  >
                    <div className="h-28 rounded bg-gray-800 mb-2 overflow-hidden flex items-center justify-center">
                      {t.exampleImage ? (
                        <img src={t.exampleImage} alt={t.name} className="h-full w-full object-contain object-top" />
                      ) : (
                        <TemplatePreview layout={t.previewLayout} />
                      )}
                    </div>
                    <p className="text-sm font-medium text-white">{t.name}</p>
                    <p className="text-[11px] text-gray-500 mb-2">{t.description}</p>
                    <button
                      onClick={() => { setSelectedTemplate(t); onTemplateSelected?.(t.id); }}
                      className={`text-xs px-3 py-1 rounded ${selectedTemplate?.id === t.id ? "bg-brand-500 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
                    >
                      {selectedTemplate?.id === t.id ? "✓ Selected" : "Use Template"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Layers Tab */}
            {leftTab === "layers" && (
              <div className="space-y-1">
                <p className="text-xs text-gray-400 mb-2">Click to select & edit:</p>
                {layers.length === 0 && <p className="text-xs text-gray-500">No layers</p>}
                {[...layers].reverse().map((l) => (
                  <button
                    key={l.id}
                    onClick={() => selectById(l.id)}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${selectedId === l.id ? "bg-brand-500/20 text-brand-400" : "text-gray-300 hover:bg-gray-800"}`}
                  >
                    {l.type === "image" ? <ImageIcon size={14} /> : l.type === "text" ? <Type size={14} /> : l.type === "band" ? <Minus size={14} /> : <Square size={14} />}
                    {l.label}
                  </button>
                ))}
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
          </div>

          <div className="p-2 sm:p-8 flex justify-center" style={{ minHeight: `${(PIN_H * zoom) / 100 + 64}px` }}>
            {/* Scaled canvas wrapper — ref used for floating toolbar positioning */}
            <div
              ref={canvasWrapperRef}
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
                width: PIN_W,
                height: PIN_H,
              }}
              className="shadow-2xl rounded-lg overflow-hidden border-2 border-gray-600 flex-shrink-0 relative"
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
        </main>

        {/* ── Right Panel (Properties) ────────────────────────────────────── */}
        <aside className={[
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
                    {selectedType === "image" ? "Image slot" : selectedType === "band" ? "Color band" : selectedType === "frame" ? "Border frame" : selectedType === "shape" ? "Shape" : "Text element"}
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
                        <select value={textProps.fontFamily} onChange={(e) => updateTextProperty("fontFamily", e.target.value)} className="input-field text-sm w-full">
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
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500">Font Size</label>
                          <input type="number" value={textProps.fontSize} onChange={(e) => updateTextProperty("fontSize", e.target.value)} className="input-field text-sm w-full" min="8" max="200" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500">Font Weight</label>
                          <select value={textProps.fontWeight} onChange={(e) => updateTextProperty("fontWeight", e.target.value)} className="input-field text-sm w-full">
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
                    {recipeImages.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {recipeImages.map((url, i) => (
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
    </div>
  );
}
