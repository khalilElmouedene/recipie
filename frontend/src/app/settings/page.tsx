"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { api, PinDesignerTemplateOut } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();

  const [templates, setTemplates] = useState<PinDesignerTemplateOut[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setTemplatesLoading(true);
    api
      .getPinDesignerTemplates()
      .then(setTemplates)
      .catch(() => {})
      .finally(() => setTemplatesLoading(false));
  }, []);

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await api.deletePinDesignerTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // ignore
    }
    setDeletingId(null);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your templates for the Pin Designer.</p>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-semibold text-white">My Pin Templates</h2>
          <p className="text-xs text-gray-400 mt-0.5">Create reusable layouts and use them in the Pin Designer.</p>
        </div>

        <button onClick={() => router.push("/template-designer")} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Create Template
        </button>
      </div>

      {templatesLoading && (
        <div className="text-center py-16 text-gray-400 text-sm">Loading templates…</div>
      )}

      {!templatesLoading && templates.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
            <LayoutTemplate size={30} className="text-gray-500" />
          </div>
          <p className="font-semibold text-gray-300 mb-1">No templates yet</p>
          <p className="text-sm text-gray-500 mb-6 max-w-sm">
            Design your first Pin template and reuse it across all your sites directly from the Pin Designer.
          </p>
          <button
            onClick={() => router.push("/template-designer")}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={15} /> Create your first template
          </button>
        </div>
      )}

      {!templatesLoading && templates.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <button
            onClick={() => router.push("/template-designer")}
            className="aspect-[2/3] rounded-xl border-2 border-dashed border-gray-700 hover:border-brand-500 hover:bg-gray-900/40 transition-all flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-white group"
          >
            <div className="w-10 h-10 rounded-xl border-2 border-dashed border-current flex items-center justify-center group-hover:border-brand-400">
              <Plus size={22} />
            </div>
            <span className="text-xs font-medium">New Template</span>
          </button>

          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="aspect-[2/3] rounded-xl border border-gray-700 overflow-hidden relative group hover:border-gray-500 transition cursor-default"
            >
              <div
                className="w-full h-full relative overflow-hidden"
                style={{ backgroundColor: tmpl.bgColor || "#ffffff" }}
              >
                {tmpl.elements.slice(0, 8).map((el) => {
                  // Scale 1000x1500 canvas down to the card.
                  const SW = 0.16;
                  const SH = 0.16;
                  const style: React.CSSProperties = {
                    position: "absolute",
                    left: el.x * SW,
                    top: el.y * SH,
                    width: el.width * SW,
                    height: (el.height ?? 40) * SH,
                    borderRadius: 2,
                    backgroundColor:
                      el.type === "text" ? (el.fill || "#333333") : (el.bgColor || "#e8e8e8"),
                    opacity: el.type === "text" ? 0.65 : 0.85,
                  };
                  return <div key={el.id} style={style} />;
                })}
              </div>

              <div className="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-3">
                <p className="text-white text-xs font-semibold text-center line-clamp-2 leading-snug">{tmpl.name}</p>
                <p className="text-gray-400 text-[10px]">
                  {tmpl.elements.length} element{tmpl.elements.length !== 1 ? "s" : ""}
                </p>
                <button
                  onClick={() => handleDeleteTemplate(tmpl.id)}
                  disabled={deletingId === tmpl.id}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-900/70 text-red-300 text-[11px] hover:bg-red-900 transition disabled:opacity-50 mt-1"
                >
                  <Trash2 size={11} />
                  {deletingId === tmpl.id ? "Deleting…" : "Delete"}
                </button>
              </div>

              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pt-4 pb-2">
                <p className="text-white text-[10px] font-medium truncate">{tmpl.name}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
