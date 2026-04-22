"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, FolderKanban, Globe, ChefHat, Copy, Trash2, Pencil, Check, X } from "lucide-react";
import { api, ProjectOut } from "@/lib/api";
import { getUserRole } from "@/lib/auth";
import { useToast } from "@/contexts/ToastContext";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectOut[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const role = getUserRole();
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const toast = useToast();
  const syncedOnceRef = useRef(false);
  const previousProjectsRef = useRef<Map<string, string>>(new Map());

  const load = useCallback(async (opts?: { announceMembershipChanges?: boolean }) => {
    try {
      const rows = await api.getProjects();
      setProjects(rows);

      const nextMap = new Map(rows.map((p) => [p.id, p.name]));
      const prevMap = previousProjectsRef.current;

      if (syncedOnceRef.current && opts?.announceMembershipChanges && role !== "owner") {
        for (const [id, name] of nextMap.entries()) {
          if (!prevMap.has(id)) {
            toast.success(`You were added to project "${name}".`);
          }
        }
        for (const [id, name] of prevMap.entries()) {
          if (!nextMap.has(id)) {
            toast.warning(`You were removed from project "${name}".`);
          }
        }
      }

      previousProjectsRef.current = nextMap;
      syncedOnceRef.current = true;
    } catch {
      // Keep current UI state on transient API errors.
    }
  }, [role, toast]);

  useEffect(() => {
    load({ announceMembershipChanges: false });
  }, [load]);

  useEffect(() => {
    const syncMembership = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      load({ announceMembershipChanges: true });
    };

    const t = setInterval(syncMembership, 5000);
    const onFocus = () => syncMembership();
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncMembership();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const handleDuplicate = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setDuplicating(id);
    try {
      await api.duplicateProject(id);
      load({ announceMembershipChanges: false });
    } catch { }
    setDuplicating(null);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setDeleting(id);
    try {
      await api.deleteProject(id);
      setDeleteConfirmId(null);
      load({ announceMembershipChanges: false });
    } catch { }
    setDeleting(null);
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    setSavingName(true);
    try {
      const updated = await api.updateProject(id, { name: editName.trim() });
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: updated.name } : p)));
      setEditingId(null);
    } catch {
      toast.error("Failed to rename project");
    }
    setSavingName(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.createProject(name, desc);
      setName(""); setDesc(""); setShowCreate(false);
      load({ announceMembershipChanges: false });
    } catch { }
    setLoading(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-sm text-gray-400 mt-1">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
        </div>
        {role === "owner" && (
          <button onClick={() => setShowCreate(!showCreate)} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> New Project
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card mb-6 flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="input-field" placeholder="My Recipe Project" />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} className="input-field" placeholder="Optional description" />
          </div>
          <button type="submit" disabled={loading} className="btn-primary">{loading ? "Creating..." : "Create"}</button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <div key={p.id} className="card hover:border-gray-700 transition group relative">
            <Link href={`/projects/${p.id}`} className="block">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-lg bg-brand-600/20 flex items-center justify-center text-brand-400">
                  <FolderKanban size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  {editingId === p.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(p.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="bg-gray-800 border border-gray-600 text-white text-sm rounded px-2 py-0.5 w-full focus:outline-none focus:border-brand-500"
                      />
                      <button
                        onClick={() => handleRename(p.id)}
                        disabled={savingName}
                        className="p-1 text-green-400 hover:text-green-300 transition"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-1 text-gray-500 hover:text-gray-300 transition"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <h3 className="font-semibold text-white group-hover:text-brand-400 transition truncate">{p.name}</h3>
                  )}
                  {p.description && <p className="text-xs text-gray-500 truncate max-w-[200px]">{p.description}</p>}
                </div>
              </div>
              <div className="flex gap-4 text-sm text-gray-400">
                <span className="flex items-center gap-1"><Globe size={14} /> {p.site_count} sites</span>
                <span className="flex items-center gap-1"><ChefHat size={14} /> {p.recipe_count} recipes</span>
              </div>
            </Link>
            {role === "owner" && (
              <div className="absolute top-3 right-3 flex items-center gap-1">
                {deleteConfirmId === p.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
                    <button
                      onClick={(e) => handleDelete(p.id, e)}
                      disabled={deleting === p.id}
                      className="text-xs bg-red-600 hover:bg-red-500 text-white rounded px-2 py-1 transition disabled:opacity-50"
                    >
                      {deleting === p.id ? "..." : "Delete"}
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); setDeleteConfirmId(null); }}
                      className="text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 rounded px-2 py-1 transition"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={(e) => { e.preventDefault(); setEditName(p.name); setEditingId(p.id); }}
                      title="Rename project"
                      className="p-1.5 rounded text-gray-500 hover:text-yellow-400 hover:bg-gray-800 transition"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={(e) => handleDuplicate(p.id, e)}
                      disabled={duplicating === p.id}
                      title="Duplicate project"
                      className="p-1.5 rounded text-gray-500 hover:text-brand-400 hover:bg-gray-800 transition disabled:opacity-40"
                    >
                      <Copy size={15} className={duplicating === p.id ? "animate-pulse" : ""} />
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); setDeleteConfirmId(p.id); }}
                      title="Delete project"
                      className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800 transition"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {projects.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-500">
            No projects yet. {role === "owner" ? "Create one to get started." : "Ask the owner to assign you to a project."}
          </div>
        )}
      </div>
    </div>
  );
}
