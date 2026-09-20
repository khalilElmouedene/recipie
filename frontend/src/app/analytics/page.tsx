"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Check,
  Copy,
  FileText,
  FolderKanban,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { api, AnalyticsProject, AnalyticsPrompt, AnalyticsPromptBrowser } from "@/lib/api";
import { getUserEmail } from "@/lib/auth";

const KHALIL_EMAIL = "khalil@gmail.com";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sourceStyles(source: string) {
  if (source === "project") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (source === "owner") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  return "border-gray-700 bg-gray-900 text-gray-400";
}

function ProjectButton({
  project,
  selected,
  onSelect,
}: {
  project: AnalyticsProject;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-4 text-left transition ${
        selected
          ? "border-brand-400/50 bg-brand-500/10 shadow-[0_0_0_1px_rgba(59,130,246,0.12)]"
          : "border-gray-800 bg-gray-950/50 hover:border-gray-700 hover:bg-gray-900/70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{project.name}</p>
          <p className="mt-1 truncate text-xs text-gray-500">{project.owner_email}</p>
        </div>
        <span className="shrink-0 rounded-md border border-gray-800 px-2 py-1 text-[11px] font-medium text-gray-400">
          {project.prompts.length}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] text-gray-500">
        <div className="rounded-md bg-gray-900/80 px-2 py-2">
          <p className="text-sm font-semibold text-gray-200">{project.site_count}</p>
          sites
        </div>
        <div className="rounded-md bg-gray-900/80 px-2 py-2">
          <p className="text-sm font-semibold text-gray-200">{project.recipe_count}</p>
          recipes
        </div>
        <div className="rounded-md bg-gray-900/80 px-2 py-2">
          <p className="text-sm font-semibold text-gray-200">{project.custom_prompt_count}</p>
          custom
        </div>
      </div>
    </button>
  );
}

function PromptCard({ prompt }: { prompt: AnalyticsPrompt }) {
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt.value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <article className="rounded-lg border border-gray-800 bg-gray-950/60">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-all text-sm font-semibold text-white">{prompt.key}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${sourceStyles(prompt.source)}`}>
              {prompt.source}
            </span>
          </div>
          {prompt.description && <p className="mt-1 text-xs leading-5 text-gray-500">{prompt.description}</p>}
        </div>
        <button
          type="button"
          onClick={copyPrompt}
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:bg-gray-900 hover:text-white"
        >
          {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words px-4 py-4 text-sm leading-6 text-gray-300">
        {prompt.value || "No prompt text saved."}
      </pre>
    </article>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsPromptBrowser | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [projectSearch, setProjectSearch] = useState("");
  const [promptSearch, setPromptSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const email = (getUserEmail() || "").trim().toLowerCase();
    if (email && email !== KHALIL_EMAIL) {
      router.replace("/");
      return;
    }

    api.getAnalytics()
      .then((result) => {
        setData(result);
        setSelectedProjectId(result.projects[0]?.id ?? "");
      })
      .catch((err) => {
        if (err instanceof Error && err.message.toLowerCase().includes("analytics")) {
          router.replace("/");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load analytics");
      })
      .finally(() => setLoading(false));
  }, [router]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!data) return [];
    if (!q) return data.projects;
    return data.projects.filter((project) =>
      [project.name, project.owner_email, project.description]
        .some((value) => value.toLowerCase().includes(q)),
    );
  }, [data, projectSearch]);

  const selectedProject = useMemo(
    () => data?.projects.find((project) => project.id === selectedProjectId) ?? data?.projects[0] ?? null,
    [data, selectedProjectId],
  );

  const filteredPrompts = useMemo(() => {
    if (!selectedProject) return [];
    const q = promptSearch.trim().toLowerCase();
    if (!q) return selectedProject.prompts;
    return selectedProject.prompts.filter((prompt) =>
      [prompt.key, prompt.description, prompt.value, prompt.source]
        .some((value) => value.toLowerCase().includes(q)),
    );
  }, [selectedProject, promptSearch]);

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <Loader2 size={32} className="animate-spin text-brand-400" />
        <p className="text-sm text-gray-400">Loading projects and prompts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-4 py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300">
          <LockKeyhole size={22} />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-white">Analytics unavailable</h1>
        <p className="mt-2 text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  if (!data || data.projects.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-4 py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-800 bg-gray-900 text-gray-400">
          <FolderKanban size={22} />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-white">No projects found</h1>
        <p className="mt-2 text-sm text-gray-500">The database does not have any projects yet.</p>
      </div>
    );
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="rounded-lg border border-gray-800 bg-gray-950/60 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-300">
              <ShieldCheck size={14} />
              Khalil only
            </div>
            <h1 className="mt-2 text-2xl font-bold text-white">Projects & Prompts</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-400">
              Every project in the database with the effective prompts used by generation.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 px-4 py-3">
              <p className="text-xs text-gray-500">Projects</p>
              <p className="mt-1 text-xl font-semibold text-white">{data.total_projects}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 px-4 py-3">
              <p className="text-xs text-gray-500">Prompts</p>
              <p className="mt-1 text-xl font-semibold text-white">{data.total_prompts}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 px-4 py-3">
              <p className="text-xs text-gray-500">Selected</p>
              <p className="mt-1 text-xl font-semibold text-white">{selectedProject?.prompts.length ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 px-4 py-3">
              <p className="text-xs text-gray-500">Custom</p>
              <p className="mt-1 text-xl font-semibold text-white">{selectedProject?.custom_prompt_count ?? 0}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
            <label className="relative block">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                className="w-full rounded-md border border-gray-800 bg-gray-900 py-2 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-brand-500"
                placeholder="Search projects"
              />
            </label>
          </div>

          <div className="max-h-[calc(100vh-15rem)] space-y-3 overflow-auto pr-1">
            {filteredProjects.map((project) => (
              <ProjectButton
                key={project.id}
                project={project}
                selected={project.id === selectedProject?.id}
                onSelect={() => setSelectedProjectId(project.id)}
              />
            ))}
            {filteredProjects.length === 0 && (
              <p className="rounded-lg border border-dashed border-gray-800 px-4 py-8 text-center text-sm text-gray-500">
                No matching projects.
              </p>
            )}
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          {selectedProject && (
            <>
              <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Briefcase size={18} className="text-brand-300" />
                      <h2 className="break-words text-xl font-semibold text-white">{selectedProject.name}</h2>
                    </div>
                    {selectedProject.description && (
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">{selectedProject.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound size={13} /> {selectedProject.owner_email}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Sparkles size={13} /> created {formatDate(selectedProject.created_at)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[26rem]">
                    {[
                      { label: "Sites", value: selectedProject.site_count, icon: FolderKanban },
                      { label: "Recipes", value: selectedProject.recipe_count, icon: FileText },
                      { label: "Jobs", value: selectedProject.job_count, icon: Briefcase },
                      { label: "Members", value: selectedProject.member_count, icon: UserRound },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-3">
                        <div className="flex items-center justify-between gap-2 text-gray-500">
                          <span className="text-xs">{item.label}</span>
                          <item.icon size={13} />
                        </div>
                        <p className="mt-1 text-lg font-semibold text-white">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                <label className="relative block">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={promptSearch}
                    onChange={(event) => setPromptSearch(event.target.value)}
                    className="w-full rounded-md border border-gray-800 bg-gray-900 py-2 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-brand-500"
                    placeholder="Search prompts"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-gray-300">
                    <MessageSquareText size={16} className="text-brand-300" />
                    {filteredPrompts.length} prompt{filteredPrompts.length === 1 ? "" : "s"}
                  </p>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className={`rounded-full border px-2 py-1 font-semibold uppercase tracking-wide ${sourceStyles("project")}`}>project</span>
                    <span className={`rounded-full border px-2 py-1 font-semibold uppercase tracking-wide ${sourceStyles("owner")}`}>owner</span>
                    <span className={`rounded-full border px-2 py-1 font-semibold uppercase tracking-wide ${sourceStyles("default")}`}>default</span>
                  </div>
                </div>

                {filteredPrompts.map((prompt) => (
                  <PromptCard key={prompt.key} prompt={prompt} />
                ))}
                {filteredPrompts.length === 0 && (
                  <p className="rounded-lg border border-dashed border-gray-800 px-4 py-10 text-center text-sm text-gray-500">
                    No matching prompts.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
