"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api, type PinterestRecipeOut, type PinterestSheetRow } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";

function descriptionWithHashtags(description: string, tags: string): string {
  const hashtags = [...new Set(
    tags.replace(/^\s*(?:tags|keywords|hashtags)\s*:\s*/i, "")
      .split(/[,;\n]+|(?=#)/u)
      .map((tag) => tag.trim().replace(/[^\p{L}\p{M}\p{N}_]/gu, ""))
      .filter(Boolean)
      .map((tag) => `#${tag}`),
  )].join(" ");
  return [description.trim(), hashtags].filter(Boolean).join("\n\n");
}

function hasGeneratedImages(recipe: PinterestRecipeOut): boolean {
  try {
    const images: unknown = JSON.parse(recipe.generated_images || "[]");
    return Array.isArray(images) && images.some((value) => {
      if (typeof value !== "string") return false;
      try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
    });
  } catch { return false; }
}

export default function PinterestSheetDownload({ recipes, loading }: { recipes: PinterestRecipeOut[]; loading: boolean }) {
  const toast = useToast();
  const [allowed, setAllowed] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    let active = true;
    api.me().then((user) => {
      if (active) setAllowed(user.email.trim().toLowerCase() === "khalil@gmail.com");
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!allowed) return null;

  const eligible = recipes.filter(hasGeneratedImages);
  const download = async () => {
    if (progress || loading || eligible.length === 0) return;
    setProgress({ done: 0, total: eligible.length });
    try {
      const XLSX = await import("xlsx");
      const rows: PinterestSheetRow[] = [];
      for (let i = 0; i < eligible.length; i++) {
        rows.push(...await api.preparePinterestSheetRecipe(eligible[i].id));
        setProgress({ done: i + 1, total: eligible.length });
      }
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Title", "Image URL", "Description", "Article link", "Status", "Board"],
        ...rows.map((row) => [row.title, row.image_url, descriptionWithHashtags(row.description, row.tags), row.article_link, row.status, row.board]),
      ]);
      sheet["!cols"] = [32, 60, 80, 60, 16, 28].map((wch) => ({ wch }));
      sheet["!autofilter"] = { ref: sheet["!ref"]! };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Pinterest");
      XLSX.writeFile(workbook, `pinterest-midjourney-${new Date().toISOString().slice(0, 10)}.xlsx`);
      const missingLinks = rows.filter((row) => !row.article_link.trim()).length;
      if (missingLinks) {
        toast.warning(`Downloaded ${rows.length} recipes. ${missingLinks} have no saved article link or WordPress post ID; publish the articles or add their links, then export again.`);
      } else {
        toast.success(`Downloaded ${rows.length} recipes`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sheet download failed. Please try again.");
    } finally {
      setProgress(null);
    }
  };

  return <button type="button" onClick={() => void download()}
    disabled={loading || eligible.length === 0 || progress !== null}
    title="Download one row per filtered recipe using its first Midjourney image. Missing descriptions and tags are generated with OpenAI. Status reflects recipe generation/article publishing."
    className="flex items-center gap-2 rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-40">
    {progress ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
    {progress ? `Creating sheet ${progress.done}/${progress.total}…` : "Create & download sheet"}
  </button>;
}
