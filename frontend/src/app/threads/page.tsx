"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, MessageCircle, Trash2, X } from "lucide-react";
import { api, ThreadsProjectOut } from "@/lib/api";

export default function ThreadsProjectsPage() {
  const [projects, setProjects] = useState<ThreadsProjectOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.getThreadsProjects()
      .then(setProjects)
      .catch(() => setError("Failed to load Threads projects"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.createThreadsProject({ name, description: desc });
      setName("");
      setDesc("");
      setShowCreate(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    setError(null);
    try {
      await api.deleteThreadsProject(id);
      setDeleteConfirm(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    }
    setDeleting(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Threads Projects</h1>
          <p className="text-sm text-gray-400 mt-1">
            {loading ? "Loading..." : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} /> New Project
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-700 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-200">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="card mb-6 flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="input-field"
              placeholder="My Threads Project"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="input-field"
              placeholder="Optional description"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setName(""); setDesc(""); }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-10 w-10 rounded-lg bg-gray-700 mb-4" />
              <div className="h-4 bg-gray-700 rounded w-2/3 mb-2" />
              <div className="h-3 bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="card hover:border-gray-600 transition group relative">
              <Link href={`/threads/${p.id}`} className="block">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-lg bg-brand-600/20 flex items-center justify-center text-brand-400 shrink-0">
                    <MessageCircle size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white group-hover:text-brand-400 transition truncate">
                      {p.name}
                    </h3>
                    {p.description && (
                      <p className="text-xs text-gray-500 truncate">{p.description}</p>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  Created {new Date(p.created_at).toLocaleDateString()}
                </div>
              </Link>

              {/* Delete button */}
              {deleteConfirm === p.id ? (
                <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-gray-900/90 backdrop-blur-sm">
                  <span className="text-sm text-gray-300 mr-1">Delete?</span>
                  <button
                    onClick={() => handleDelete(p.id)}
                    disabled={deleting === p.id}
                    className="rounded px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition"
                  >
                    {deleting === p.id ? "Deleting..." : "Yes, delete"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="rounded px-3 py-1.5 text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.preventDefault(); setDeleteConfirm(p.id); }}
                  title="Delete project"
                  className="absolute top-3 right-3 p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-800 transition"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}

          {projects.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-500">
              No Threads projects yet. Create one to get started.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
