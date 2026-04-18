"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Plus, Trash2, Pencil, Copy, FolderOpen, X, Check } from "lucide-react";
import { api, PinDesignerTemplateOut, ProjectOut } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";

const CANVAS_SIZE_PRESETS = [
  { label: "Pinterest Pin",    w: 1000, h: 1500 },
  { label: "Pinterest Square", w: 1000, h: 1000 },
  { label: "Instagram Post",   w: 1080, h: 1080 },
  { label: "Instagram Story",  w: 1080, h: 1920 },
  { label: "Facebook Post",    w: 1200, h: 630  },
  { label: "Custom",           w: 0,    h: 0    },
];

function SizePickerModal({ onConfirm, onClose }: { onConfirm: (w: number, h: number) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const [customW, setCustomW] = useState("1000");
  const [customH, setCustomH] = useState("1500");
  const [sizeError, setSizeError] = useState("");
  const isCustom = CANVAS_SIZE_PRESETS[selected].label === "Custom";

  function handleConfirm() {
    const w = isCustom ? parseInt(customW, 10) : CANVAS_SIZE_PRESETS[selected].w;
    const h = isCustom ? parseInt(customH, 10) : CANVAS_SIZE_PRESETS[selected].h;
    if (!w || !h || w < 100 || h < 100) { setSizeError("Please enter valid dimensions (min 100px)."); return; }
    onConfirm(w, h);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-white font-semibold text-base mb-1">Choose Template Size</h3>
        <p className="text-xs text-gray-400 mb-4">Select the canvas dimensions for your new design.</p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {CANVAS_SIZE_PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setSelected(i)}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${
                selected === i
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
              }`}
            >
              <p className="text-xs font-medium">{p.label}</p>
              {p.label !== "Custom" && (
                <p className="text-[10px] text-gray-500 mt-0.5">{p.w} × {p.h}</p>
              )}
            </button>
          ))}
        </div>

        {isCustom && (
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1">
              <label className="text-[10px] text-gray-500 block mb-1">Width (px)</label>
              <input
                type="number" min={100} max={8000}
                value={customW} onChange={(e) => setCustomW(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
              />
            </div>
            <span className="text-gray-600 mt-4">×</span>
            <div className="flex-1">
              <label className="text-[10px] text-gray-500 block mb-1">Height (px)</label>
              <input
                type="number" min={100} max={8000}
                value={customH} onChange={(e) => setCustomH(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>
        )}

        {sizeError && <p className="text-red-400 text-xs mb-2">{sizeError}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white text-sm transition">Cancel</button>
          <button onClick={handleConfirm} className="flex-1 btn-primary text-sm">Create Design</button>
        </div>
      </div>
    </div>
  );
}

export default function PinDesignerTemplatesPage() {
  const router = useRouter();
  const toast = useToast();

  const openConfirm = useConfirm();

  const [templates, setTemplates] = useState<PinDesignerTemplateOut[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [cloneTarget, setCloneTarget] = useState<PinDesignerTemplateOut | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [showSizePicker, setShowSizePicker] = useState(false);

  // Assign to projects state
  const [projects, setProjects] = useState<ProjectOut[]>([]);
  const [assigningTemplate, setAssigningTemplate] = useState<PinDesignerTemplateOut | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [isGlobal, setIsGlobal] = useState(true);
  const [assignSaving, setAssignSaving] = useState(false);

  useEffect(() => {
    setTemplatesLoading(true);
    Promise.all([
      api.getPinDesignerTemplates(),
      api.getProjects(),
    ])
      .then(([tmpls, projs]) => {
        setTemplates(tmpls);
        setProjects(projs);
      })
      .catch(() => {})
      .finally(() => setTemplatesLoading(false));
  }, []);

  const openAssignModal = (tmpl: PinDesignerTemplateOut) => {
    setAssigningTemplate(tmpl);
    if (tmpl.project_ids === null || tmpl.project_ids === undefined) {
      setIsGlobal(true);
      setSelectedProjectIds([]);
    } else {
      setIsGlobal(false);
      setSelectedProjectIds(tmpl.project_ids);
    }
  };

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]
    );
  };

  const handleSaveAssign = async () => {
    if (!assigningTemplate) return;
    setAssignSaving(true);
    try {
      const projectIds = isGlobal ? null : selectedProjectIds;
      const updated = await api.assignTemplateToProjects(assigningTemplate.id, projectIds);
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setAssigningTemplate(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save assignment.");
    } finally {
      setAssignSaving(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!await openConfirm({ message: "Delete this template? This cannot be undone.", danger: true, confirmLabel: "Delete" })) return;
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

  const openCloneModal = (tmpl: PinDesignerTemplateOut) => {
    const existingNames = new Set(templates.map((t) => t.name.trim().toLowerCase()));
    let suggestedName = `${tmpl.name} Copy`;
    let copyIndex = 2;
    while (existingNames.has(suggestedName.trim().toLowerCase())) {
      suggestedName = `${tmpl.name} Copy ${copyIndex}`;
      copyIndex += 1;
    }
    setCloneTarget(tmpl);
    setCloneName(suggestedName);
  };

  const handleCloneTemplate = async () => {
    if (!cloneTarget) return;
    const cleanName = cloneName.trim();
    if (!cleanName) { toast.error("Template name cannot be empty."); return; }
    setCloningId(cloneTarget.id);
    setCloneTarget(null);
    try {
      const created = await api.createPinDesignerTemplate({
        name: cleanName,
        description: cloneTarget.description,
        bgColor: cloneTarget.bgColor,
        canvasWidth: cloneTarget.canvasWidth,
        canvasHeight: cloneTarget.canvasHeight,
        elements: cloneTarget.elements,
      });
      setTemplates((prev) => [created, ...prev]);
      toast.success("Template cloned.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clone template.");
    } finally {
      setCloningId(null);
    }
  };

  return (
    <div>
      {showSizePicker && (
        <SizePickerModal
          onConfirm={(w, h) => { setShowSizePicker(false); router.push(`/template-designer?w=${w}&h=${h}`); }}
          onClose={() => setShowSizePicker(false)}
        />
      )}

      {cloneTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-white font-semibold text-base mb-3">Clone Template</h3>
            <label className="text-xs text-gray-400 block mb-1">New name</label>
            <input
              autoFocus
              className="input-field w-full mb-4 text-sm"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCloneTemplate(); if (e.key === "Escape") setCloneTarget(null); }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCloneTarget(null)} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition">Cancel</button>
              <button onClick={handleCloneTemplate} className="btn-primary px-4 py-2 text-sm">Clone</button>
            </div>
          </div>
        </div>
      )}

      {assigningTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-white font-semibold text-base">Assign to Projects</h3>
              <button onClick={() => setAssigningTemplate(null)} className="text-gray-500 hover:text-white transition">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Choose which projects can use <span className="text-white font-medium">{assigningTemplate.name}</span>.
            </p>

            <button
              onClick={() => { setIsGlobal(true); setSelectedProjectIds([]); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border mb-2 text-sm transition ${
                isGlobal
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isGlobal ? "border-brand-500 bg-brand-500" : "border-gray-600"}`}>
                {isGlobal && <Check size={10} className="text-white" />}
              </div>
              All projects (global)
            </button>

            <button
              onClick={() => setIsGlobal(false)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border mb-3 text-sm transition ${
                !isGlobal
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${!isGlobal ? "border-brand-500 bg-brand-500" : "border-gray-600"}`}>
                {!isGlobal && <Check size={10} className="text-white" />}
              </div>
              Specific projects only
            </button>

            {!isGlobal && (
              <div className="max-h-48 overflow-y-auto space-y-1 mb-4 pr-1">
                {projects.length === 0 && (
                  <p className="text-xs text-gray-500 text-center py-4">No projects found.</p>
                )}
                {projects.map((proj) => {
                  const checked = selectedProjectIds.includes(proj.id);
                  return (
                    <button
                      key={proj.id}
                      onClick={() => toggleProject(proj.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm transition ${
                        checked
                          ? "border-brand-500/50 bg-brand-500/10 text-white"
                          : "border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${checked ? "border-brand-500 bg-brand-500" : "border-gray-600"}`}>
                        {checked && <Check size={10} className="text-white" />}
                      </div>
                      <span className="truncate text-left">{proj.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {isGlobal && <div className="mb-4" />}

            <div className="flex gap-2">
              <button onClick={() => setAssigningTemplate(null)} className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white text-sm transition">
                Cancel
              </button>
              <button
                onClick={handleSaveAssign}
                disabled={assignSaving || (!isGlobal && selectedProjectIds.length === 0)}
                className="flex-1 btn-primary text-sm disabled:opacity-50"
              >
                {assignSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

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

        <button onClick={() => setShowSizePicker(true)} className="btn-primary flex items-center gap-2">
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
          <button onClick={() => setShowSizePicker(true)} className="btn-primary flex items-center gap-2">
            <Plus size={15} /> Create your first template
          </button>
        </div>
      )}

      {!templatesLoading && templates.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <button
            onClick={() => setShowSizePicker(true)}
            className="h-20 rounded-xl border-2 border-dashed border-gray-700 hover:border-brand-500 hover:bg-gray-900/40 transition-all flex flex-col items-center justify-center gap-1.5 text-gray-500 hover:text-white group"
          >
            <div className="w-10 h-10 rounded-xl border-2 border-dashed border-current flex items-center justify-center group-hover:border-brand-400">
              <Plus size={22} />
            </div>
            <span className="text-xs font-medium">New Template</span>
          </button>

          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="h-20 rounded-xl border border-gray-700 bg-gray-900/70 hover:border-gray-500 transition p-3 flex flex-col justify-between"
            >
              <p className="text-sm font-medium text-white truncate leading-tight">{tmpl.name}</p>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-500">{tmpl.canvasWidth} × {tmpl.canvasHeight}</p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => router.push(`/template-designer?templateId=${tmpl.id}&w=${tmpl.canvasWidth}&h=${tmpl.canvasHeight}`)}
                    title="Edit"
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white transition"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => openAssignModal(tmpl)}
                    title={tmpl.project_ids === null ? "Global (all projects)" : `Assigned to ${tmpl.project_ids?.length ?? 0} project(s)`}
                    className={`p-1.5 rounded-lg transition ${
                      tmpl.project_ids === null
                        ? "text-gray-400 hover:bg-gray-700 hover:text-white"
                        : "text-brand-400 hover:bg-brand-900/60"
                    }`}
                  >
                    <FolderOpen size={13} />
                  </button>
                  <button
                    onClick={() => openCloneModal(tmpl)}
                    disabled={cloningId === tmpl.id}
                    title="Clone"
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white transition disabled:opacity-50"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    onClick={() => handleDeleteTemplate(tmpl.id)}
                    disabled={deletingId === tmpl.id}
                    title="Delete"
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-red-900/60 hover:text-red-400 transition disabled:opacity-50"
                  >
                    <Trash2 size={13} />
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
