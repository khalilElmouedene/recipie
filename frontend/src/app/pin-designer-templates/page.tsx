"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Plus, Trash2, Pencil, Copy } from "lucide-react";
import { api, PinDesignerTemplateOut } from "@/lib/api";

export default function PinDesignerTemplatesPage() {
  const router = useRouter();

  const [templates, setTemplates] = useState<PinDesignerTemplateOut[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);

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
    } finally {
      setDeletingId(null);
    }
  };

  const handleCloneTemplate = async (tmpl: PinDesignerTemplateOut) => {
    const existingNames = new Set(templates.map((t) => t.name.trim().toLowerCase()));
    let suggestedName = `${tmpl.name} Copy`;
    let copyIndex = 2;
    while (existingNames.has(suggestedName.trim().toLowerCase())) {
      suggestedName = `${tmpl.name} Copy ${copyIndex}`;
      copyIndex += 1;
    }

    const nextName = prompt("Enter new name for cloned template:", suggestedName);
    if (!nextName) return;
    const cleanName = nextName.trim();
    if (!cleanName) {
      alert("Template name cannot be empty.");
      return;
    }

    setCloningId(tmpl.id);
    try {
      const created = await api.createPinDesignerTemplate({
        name: cleanName,
        description: tmpl.description,
        bgColor: tmpl.bgColor,
        elements: tmpl.elements,
      });
      setTemplates((prev) => [created, ...prev]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to clone template.");
    } finally {
      setCloningId(null);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Pin Designer Templates</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your own templates and edit them anytime.</p>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-semibold text-white">My Templates</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Create reusable layouts and use them directly in the Pin Designer.
          </p>
        </div>

        <button onClick={() => router.push("/template-designer")} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Create Template
        </button>
      </div>

      {templatesLoading && <div className="text-center py-16 text-gray-400 text-sm">Loading templates...</div>}

      {!templatesLoading && templates.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
            <LayoutTemplate size={30} className="text-gray-500" />
          </div>
          <p className="font-semibold text-gray-300 mb-1">No templates yet</p>
          <p className="text-sm text-gray-500 mb-6 max-w-sm">
            Design your first Pin template and reuse it across all your sites.
          </p>
          <button onClick={() => router.push("/template-designer")} className="btn-primary flex items-center gap-2">
            <Plus size={15} /> Create your first template
          </button>
        </div>
      )}

      {!templatesLoading && templates.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <button
            onClick={() => router.push("/template-designer")}
            className="h-24 rounded-xl border-2 border-dashed border-gray-700 hover:border-brand-500 hover:bg-gray-900/40 transition-all flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-white group"
          >
            <div className="w-10 h-10 rounded-xl border-2 border-dashed border-current flex items-center justify-center group-hover:border-brand-400">
              <Plus size={22} />
            </div>
            <span className="text-xs font-medium">New Template</span>
          </button>

          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="h-24 rounded-xl border border-gray-700 bg-gray-900/70 hover:border-gray-500 transition p-3 flex flex-col justify-between"
            >
              <p className="text-sm font-medium text-white truncate">{tmpl.name}</p>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-500">
                  {tmpl.elements.length} element{tmpl.elements.length !== 1 ? "s" : ""}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => router.push(`/template-designer?templateId=${tmpl.id}`)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 text-[11px] hover:bg-gray-700 transition"
                  >
                    <Pencil size={11} />
                    Edit
                  </button>
                  <button
                    onClick={() => handleCloneTemplate(tmpl)}
                    disabled={cloningId === tmpl.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-900/60 text-sky-200 text-[11px] hover:bg-sky-900 transition disabled:opacity-50"
                  >
                    <Copy size={11} />
                    {cloningId === tmpl.id ? "Cloning..." : "Clone"}
                  </button>
                  <button
                    onClick={() => handleDeleteTemplate(tmpl.id)}
                    disabled={deletingId === tmpl.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-900/60 text-red-300 text-[11px] hover:bg-red-900 transition disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                    {deletingId === tmpl.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
