"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, FileImage, FileVideo2, Plus, Trash2, X } from "lucide-react";
import { api, FacebookProjectOut } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";

function FacebookMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden>
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.414c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971h-1.513c-1.49 0-1.956.931-1.956 1.887v2.262h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

export default function FacebookProjectsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [projects, setProjects] = useState<FacebookProjectOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [postType, setPostType] = useState<"video" | "image">("video");
  const [canUseImagePosts, setCanUseImagePosts] = useState(false);

  const load = async () => {
    try {
      const [loadedProjects, currentUser] = await Promise.all([
        api.getFacebookProjects(),
        api.me(),
      ]);
      setProjects(loadedProjects);
      setCanUseImagePosts(currentUser.email.trim().toLowerCase() === "khalil@gmail.com");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Facebook projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const created = await api.createFacebookProject({
        name: name.trim(),
        description: description.trim(),
        post_type: postType,
      });
      setProjects((current) => [created, ...current]);
      setName("");
      setDescription("");
      setPostType("video");
      setShowCreate(false);
      toast.success("Facebook project created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create project");
    } finally {
      setSaving(false);
    }
  };

  const closeCreate = () => {
    setShowCreate(false);
    setName("");
    setDescription("");
    setPostType("video");
  };

  const deleteProject = async (project: FacebookProjectOut) => {
    const accepted = await confirm({
      message: `Delete “${project.name}” and all of its generated Facebook content?`,
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!accepted) return;
    await api.deleteFacebookProject(project.id);
    setProjects((current) => current.filter((item) => item.id !== project.id));
    toast.success("Facebook project deleted");
  };

  return (
    <div className="relative mx-auto max-w-7xl">
      <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[#1877f2]/10 blur-3xl" />

      <section className="relative overflow-hidden rounded-[28px] border border-[#1877f2]/20 bg-[#0d1422] px-6 py-7 md:px-9 md:py-9">
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#1877f2]/30 bg-[#1877f2]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#68a8ff]">
              <FacebookMark className="h-4 w-4" />
              Social publishing
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-white md:text-5xl">
              Turn source ideas into a{" "}
              <span className="text-[#68a8ff]">publishing system.</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 md:text-base">
              Generate polished video or image recipe posts, then publish or schedule them
              across every connected Facebook Page.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#1877f2] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_35px_rgba(24,119,242,.28)] transition hover:bg-[#2f86f6]"
          >
            <Plus size={18} />
            Create a New Project
          </button>
        </div>
      </section>

      <div className="mt-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Workspaces</p>
          <p className="mt-1 text-sm text-slate-400">
            {loading ? "Loading…" : `${projects.length} active project${projects.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {!loading && projects.length === 0 ? (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-5 flex min-h-72 w-full flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-700 bg-slate-900/30 px-6 text-center transition hover:border-[#1877f2]/60 hover:bg-[#1877f2]/5"
        >
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#1877f2]/15 text-[#68a8ff]">
            <FileVideo2 size={26} />
          </span>
          <span className="mt-4 text-lg font-semibold text-white">Build your first Facebook pipeline</span>
          <span className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            Choose video or image posts, connect your Pages, then feed the dedicated Spy Sheet.
          </span>
        </button>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project, index) => (
            <article
              key={project.id}
              className="group relative overflow-hidden rounded-[22px] border border-slate-800 bg-[#101827] p-5 transition duration-300 hover:-translate-y-0.5 hover:border-[#1877f2]/45 hover:shadow-[0_18px_45px_rgba(0,0,0,.28)]"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <div className="absolute right-0 top-0 h-28 w-28 translate-x-10 -translate-y-10 rounded-full bg-[#1877f2]/10 blur-2xl transition group-hover:bg-[#1877f2]/20" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#1877f2] text-white shadow-lg shadow-[#1877f2]/20">
                  <FacebookMark className="h-5 w-5" />
                </div>
                <button
                  onClick={() => deleteProject(project)}
                  className="rounded-lg p-2 text-slate-600 transition hover:bg-red-500/10 hover:text-red-400"
                  title="Delete project"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <Link href={`/facebook/${project.id}`} className="relative mt-5 block">
                <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#1877f2]/25 bg-[#1877f2]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8bbcff]">
                  {project.post_type === "image" ? <FileImage size={12} /> : <FileVideo2 size={12} />}
                  {project.post_type === "image" ? "Image Posts" : "Video Posts"}
                </span>
                <h2 className="text-lg font-semibold text-white transition group-hover:text-[#8bbcff]">
                  {project.name}
                </h2>
                <p className="mt-2 min-h-10 line-clamp-2 text-sm leading-5 text-slate-500">
                  {project.description || "A dedicated Facebook content and publishing workspace."}
                </p>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                    <p className="text-lg font-semibold text-white">{project.page_count}</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Pages</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                    <p className="text-lg font-semibold text-white">{project.content_count}</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Posts</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                    <p className={`text-lg font-semibold ${project.has_website || project.post_type === "image" ? "text-emerald-400" : "text-amber-400"}`}>
                      {project.has_website ? "Ready" : project.post_type === "image" ? "Optional" : "Setup"}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Website</p>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4 text-sm">
                  <span className="flex items-center gap-2 text-slate-500">
                    <CalendarDays size={15} />
                    Open calendar
                  </span>
                  <ArrowRight size={17} className="text-[#68a8ff] transition group-hover:translate-x-1" />
                </div>
              </Link>
            </article>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <form
            onSubmit={createProject}
            className="w-full max-w-lg overflow-hidden rounded-[24px] border border-slate-700 bg-[#101827] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#68a8ff]">New workspace</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Create Facebook project</h2>
              </div>
              <button type="button" onClick={closeCreate} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-5 px-6 py-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Post type</label>
                <div className={`grid gap-3 ${canUseImagePosts ? "sm:grid-cols-2" : ""}`}>
                  <button
                    type="button"
                    onClick={() => setPostType("video")}
                    className={`rounded-xl border p-4 text-left transition ${postType === "video" ? "border-[#1877f2] bg-[#1877f2]/10" : "border-slate-700 bg-slate-950/25 hover:border-slate-600"}`}
                  >
                    <FileVideo2 className="mb-3 text-[#68a8ff]" size={21} />
                    <span className="block text-sm font-semibold text-white">Video Posts</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Process source videos and publish Reels.</span>
                  </button>
                  {canUseImagePosts && (
                    <button
                      type="button"
                      onClick={() => setPostType("image")}
                      className={`rounded-xl border p-4 text-left transition ${postType === "image" ? "border-[#1877f2] bg-[#1877f2]/10" : "border-slate-700 bg-slate-950/25 hover:border-slate-600"}`}
                    >
                      <FileImage className="mb-3 text-[#68a8ff]" size={21} />
                      <span className="block text-sm font-semibold text-white">Image Posts</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">Template + source image, generated per Page.</span>
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Project Name <span className="text-[#68a8ff]">*</span>
                </label>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={255}
                  className="input-field"
                  placeholder="Weekend recipe channel"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Description <span className="text-slate-600">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  className="input-field resize-none"
                  placeholder="What this publishing pipeline is for…"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-800 bg-slate-950/30 px-6 py-4">
              <button type="button" onClick={closeCreate} className="btn-secondary">Cancel</button>
              <button disabled={saving || !name.trim()} className="rounded-lg bg-[#1877f2] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2f86f6] disabled:opacity-50">
                {saving ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
