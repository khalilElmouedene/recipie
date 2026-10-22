"use client";

import { useEffect, useState } from "react";
import { FlipHorizontal2, ImageIcon, Loader2, ZoomIn } from "lucide-react";
import { api, ProjectOut } from "@/lib/api";
import AllSitesGenerator from "@/components/AllSitesGenerator";

export default function SourceArticlesPage() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<ProjectOut[]>([]);
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await api.me();
        if (me.email.trim().toLowerCase() !== "khalil@gmail.com") {
          throw new Error("This page is only available to khalil@gmail.com.");
        }
        const available = await api.getProjects();
        if (cancelled) return;
        setAuthorized(true);
        setProjects(available);
        setProjectId(available[0]?.id || "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load your projects.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="flex items-center gap-2 text-gray-400 p-8"><Loader2 className="animate-spin" size={18} /> Loading article workspace…</div>;
  if (!authorized) return <div role="alert" className="card text-red-300">{error || "Access denied."}</div>;

  return (
    <div className="space-y-7">
      <section className="rounded-2xl border border-amber-400/25 bg-gray-900 p-5 sm:p-7 space-y-5">
        <div>
          <p className="text-xs uppercase tracking-widest text-amber-300 mb-2">Private workspace · Khalil</p>
          <h1 className="text-2xl font-bold text-white">Your image, ready for your article.</h1>
          <p className="text-sm text-gray-400 mt-2 max-w-3xl">Upload an image or paste its URL. We make a separate copy with a subtle center zoom and horizontal flip, then use that image in your article.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-4 flex items-center gap-3"><ImageIcon size={22} className="text-amber-300 shrink-0" /><div><p className="text-sm font-semibold text-white">1. Your input image</p><p className="text-xs text-gray-400 mt-1">Original file kept untouched</p></div></div>
          <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-4 flex items-center gap-3"><ZoomIn size={22} className="text-amber-300 shrink-0" /><div><p className="text-sm font-semibold text-white">2. Zoom in 10%</p><p className="text-xs text-gray-400 mt-1">Center crop, same dimensions</p></div></div>
          <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-4 flex items-center gap-3"><FlipHorizontal2 size={22} className="text-amber-300 shrink-0" /><div><p className="text-sm font-semibold text-white">3. Flip horizontally</p><p className="text-xs text-gray-400 mt-1">One edited image for all sites</p></div></div>
        </div>
        <p className="text-sm text-gray-400">Image editing runs locally on the server. No image AI account, token or image-generation credits are needed. Article text uses your existing OpenAI key and project prompts.</p>
      </section>
      <section className="space-y-5">
        <label className="block text-sm font-semibold text-gray-200">Choose your existing project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input-field sm:max-w-md mt-2">
            {!projects.length && <option value="">No projects available</option>}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        {projectId ? <AllSitesGenerator key={projectId} projectId={projectId} imageProvider="source_image" /> : <div className="card text-gray-400">Create a project with at least one site to start.</div>}
      </section>
    </div>
  );
}
