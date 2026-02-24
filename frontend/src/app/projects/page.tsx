"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FolderKanban, Globe, ChefHat } from "lucide-react";
import { api, ProjectOut } from "@/lib/api";
import { getUserRole } from "@/lib/auth";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectOut[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const role = getUserRole();

  const load = () => api.getProjects().then(setProjects).catch(() => {});
  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.createProject(name, desc);
      setName(""); setDesc(""); setShowCreate(false);
      load();
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
          <Link key={p.id} href={`/projects/${p.id}`} className="card hover:border-gray-700 transition group">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-lg bg-brand-600/20 flex items-center justify-center text-brand-400">
                <FolderKanban size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-white group-hover:text-brand-400 transition">{p.name}</h3>
                {p.description && <p className="text-xs text-gray-500 truncate max-w-[200px]">{p.description}</p>}
              </div>
            </div>
            <div className="flex gap-4 text-sm text-gray-400">
              <span className="flex items-center gap-1"><Globe size={14} /> {p.site_count} sites</span>
              <span className="flex items-center gap-1"><ChefHat size={14} /> {p.recipe_count} recipes</span>
            </div>
          </Link>
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
