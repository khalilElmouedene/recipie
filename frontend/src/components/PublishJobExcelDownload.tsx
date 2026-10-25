"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api, type JobOut } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";

export default function PublishJobExcelDownload({ job }: { job: JobOut }) {
  const toast = useToast();
  const [allowed, setAllowed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    let active = true;
    api.me().then((user) => {
      if (active) setAllowed(user.email.trim().toLowerCase() === "khalil@gmail.com");
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  if (!allowed || job.job_type !== "publisher") return null;
  const completed = job.status === "completed";
  const download = async () => {
    if (!completed || exporting) return;
    setExporting(true);
    try {
      const rows = await api.getJobPinterestSheet(job.id);
      const XLSX = await import("xlsx");
      const values: string[][] = [];
      setProgress({ done: 0, total: rows.length });
      for (const row of rows) {
        const metadata = await api.prepareJobPinterestSheetRecipe(job.id, row.recipe_id);
        let imageUrl = row.image_url;
        // A failed upload in the designer can leave a data URI. Host that saved
        // render before exporting so Excel always contains usable image links.
        if (imageUrl.startsWith("data:image/")) {
          imageUrl = await api.uploadPinImageToServer(row.site_id, imageUrl);
          await api.updateRecipe(row.recipe_id, { pin_design_image: imageUrl });
        }
        const image = new URL(imageUrl);
        if (!["http:", "https:"].includes(image.protocol)) {
          throw new Error("Save the rendered pin image before exporting Excel.");
        }
        const description = [metadata.description.trim(), metadata.tags.trim()].filter(Boolean).join("\n");
        values.push([row.title, imageUrl, description, row.article_link, row.status, row.board]);
        setProgress({ done: values.length, total: rows.length });
      }
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Title", "Image URL", "Description", "Article link", "Status", "Board"],
        ...values,
      ]);
      sheet["!cols"] = [32, 60, 80, 60, 16, 28].map((wch) => ({ wch }));
      sheet["!autofilter"] = { ref: sheet["!ref"]! };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Pinterest");
      XLSX.writeFile(workbook, `pinterest-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Exported ${rows.length} published recipes`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Excel export failed. Please try again.");
    } finally {
      setExporting(false);
      setProgress(null);
    }
  };

  return (
    <button type="button" onClick={() => void download()} disabled={!completed || exporting}
      title={completed ? "Export successfully published recipes with rendered pin images" : "Available when publishing completes"}
      className="btn-secondary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40">
      {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      {exporting ? (progress ? `Generating ${progress.done}/${progress.total}…` : "Exporting…") : "Export Excel"}
    </button>
  );
}
