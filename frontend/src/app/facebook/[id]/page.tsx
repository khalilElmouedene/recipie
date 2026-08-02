"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  FileText,
  Globe2,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  MessageSquare,
  MessageSquareText,
  MonitorPlay,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Send,
  Settings2,
  Sheet,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from "lucide-react";
import {
  api,
  CredentialOut,
  FacebookCommentMode,
  FacebookContentOut,
  FacebookDeliveryOut,
  FacebookPageOut,
  FacebookProjectOut,
  PromptOut,
} from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";
import FacebookWebsiteSettings from "@/components/facebook/FacebookWebsiteSettings";
import FacebookAiPromptSettings from "@/components/facebook/FacebookAiPromptSettings";

type MainTab = "calendar" | "settings";
type SettingsTab = "website" | "pages" | "keys" | "ai_prompts" | "video_prompts";

const STATUS_STYLE: Record<string, string> = {
  processing: "border-sky-800/50 bg-sky-950/30 text-sky-300",
  ready: "border-emerald-800/50 bg-emerald-950/30 text-emerald-300",
  draft: "border-slate-700 bg-slate-800/60 text-slate-300",
  scheduled: "border-amber-800/50 bg-amber-950/30 text-amber-300",
  publishing: "border-blue-800/50 bg-blue-950/30 text-blue-300",
  published: "border-emerald-800/50 bg-emerald-950/30 text-emerald-300",
  failed: "border-red-800/50 bg-red-950/30 text-red-300",
};

function formatDate(value: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, options || {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateTimeInput(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function FacebookMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden>
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.414c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971h-1.513c-1.49 0-1.956.931-1.956 1.887v2.262h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

export default function FacebookProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [project, setProject] = useState<FacebookProjectOut | null>(null);
  const [pages, setPages] = useState<FacebookPageOut[]>([]);
  const [contents, setContents] = useState<FacebookContentOut[]>([]);
  const [tab, setTab] = useState<MainTab>("calendar");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("website");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (quiet = false) => {
    try {
      const [projectData, pageData, contentData] = await Promise.all([
        api.getFacebookProject(id),
        api.getFacebookPages(id),
        api.getFacebookContents(id),
      ]);
      setProject(projectData);
      setPages(pageData);
      setContents(contentData);
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "Could not load project");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const active = contents.some(
      (content) =>
        content.status === "processing" ||
        content.deliveries.some((delivery) => delivery.status === "publishing"),
    );
    if (!active) return;
    const timer = window.setInterval(() => load(true), 6000);
    return () => window.clearInterval(timer);
  }, [contents, load]);

  const removeProject = async () => {
    if (!project) return;
    const accepted = await confirm({
      message: `Delete “${project.name}” and all Facebook content?`,
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!accepted) return;
    await api.deleteFacebookProject(project.id);
    router.push("/facebook");
  };

  if (loading || !project) {
    return (
      <div className="grid h-80 place-items-center">
        <Loader2 className="animate-spin text-[#68a8ff]" />
      </div>
    );
  }

  const setupSteps = [
    { label: "Website", done: project.has_website, tab: "website" as SettingsTab },
    { label: "Facebook Pages", done: pages.length > 0, tab: "pages" as SettingsTab },
    { label: "Content queue", done: contents.length > 0, tab: null },
  ];

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <button onClick={() => router.push("/facebook")} className="flex items-center gap-2 text-sm text-slate-500 transition hover:text-white">
          <ArrowLeft size={16} />
          Back to Facebook
        </button>
        <button onClick={removeProject} className="rounded-lg p-2 text-slate-600 transition hover:bg-red-500/10 hover:text-red-400" title="Delete project">
          <Trash2 size={16} />
        </button>
      </div>

      <header className="relative overflow-hidden rounded-[26px] border border-slate-800 bg-[#0d1422] px-6 py-6 md:px-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[#1877f2]/15 blur-3xl" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#68a8ff]">
              <FacebookMark className="h-4 w-4" />
              Facebook workspace
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white">{project.name}</h1>
            {project.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{project.description}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {setupSteps.map((step) => (
                <button
                  key={step.label}
                  onClick={() => {
                    if (step.tab) {
                      setTab("settings");
                      setSettingsTab(step.tab);
                    }
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                    step.done ? "border-emerald-900/60 bg-emerald-950/20 text-emerald-300" : "border-amber-900/60 bg-amber-950/20 text-amber-300"
                  }`}
                >
                  {step.done ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {step.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/facebook/${project.id}/logs`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-white"
            >
              <ScrollText size={17} />
              Generation Logs
            </Link>
            <Link
              href={`/facebook/${project.id}/spy-sheet`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#1877f2]/45 bg-[#1877f2]/10 px-5 py-3 text-sm font-semibold text-[#8bbcff] transition hover:bg-[#1877f2]/20"
            >
              <Sheet size={17} />
              Spy Sheet
            </Link>
          </div>
        </div>
      </header>

      <div className="mt-5 flex gap-1 border-b border-slate-800">
        {[
          { key: "calendar" as MainTab, label: "Calendar", icon: CalendarDays },
          { key: "settings" as MainTab, label: "Settings", icon: Settings2 },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition ${
              tab === item.key ? "border-[#1877f2] text-[#68a8ff]" : "border-transparent text-slate-500 hover:text-white"
            }`}
          >
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "calendar" ? (
          <FacebookCalendar
            contents={contents}
            pages={pages}
            project={project}
            onRefresh={() => load(true)}
            onOpenSettings={(next) => {
              setTab("settings");
              setSettingsTab(next);
            }}
          />
        ) : (
          <FacebookSettings
            project={project}
            pages={pages}
            activeTab={settingsTab}
            onTab={setSettingsTab}
            onRefresh={() => load(true)}
            onProject={setProject}
          />
        )}
      </div>
    </div>
  );
}

function FacebookCalendar({
  contents,
  pages,
  project,
  onRefresh,
  onOpenSettings,
}: {
  contents: FacebookContentOut[];
  pages: FacebookPageOut[];
  project: FacebookProjectOut;
  onRefresh: () => void;
  onOpenSettings: (tab: SettingsTab) => void;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedContent, setSelectedContent] = useState<FacebookContentOut | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [scheduleDelivery, setScheduleDelivery] = useState<FacebookDeliveryOut | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const toast = useToast();

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
  const byDay = useMemo(() => {
    const map: Record<
      string,
      { key: string; content: FacebookContentOut; delivery: FacebookDeliveryOut | null }[]
    > = {};
    for (const content of contents) {
      const datedDeliveries = content.deliveries.filter(
        (delivery) => delivery.scheduled_at || delivery.published_at,
      );
      if (datedDeliveries.length === 0) {
        const key = dateKey(new Date(content.created_at));
        (map[key] ||= []).push({ key: content.id, content, delivery: null });
        continue;
      }
      for (const delivery of datedDeliveries) {
        const value = delivery.scheduled_at || delivery.published_at;
        if (!value) continue;
        const key = dateKey(new Date(value));
        (map[key] ||= []).push({ key: delivery.id, content, delivery });
      }
    }
    for (const events of Object.values(map)) {
      events.sort((left, right) => {
        const leftDate = left.delivery?.scheduled_at || left.delivery?.published_at || left.content.created_at;
        const rightDate = right.delivery?.scheduled_at || right.delivery?.published_at || right.content.created_at;
        return leftDate.localeCompare(rightDate);
      });
    }
    return map;
  }, [contents]);

  const publish = async (delivery: FacebookDeliveryOut) => {
    setPublishingId(delivery.id);
    try {
      await api.publishFacebookDelivery(delivery.id);
      toast.success(`Published to ${delivery.page_name}`);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Facebook publication failed");
      onRefresh();
    } finally {
      setPublishingId(null);
    }
  };

  const retryGeneration = async (content: FacebookContentOut) => {
    setRetryingId(content.id);
    try {
      await api.retryFacebookGeneration(content.id);
      setSelectedContent(null);
      toast.success(`Generation restarted for ${content.title}`);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not retry generation");
      onRefresh();
    } finally {
      setRetryingId(null);
    }
  };

  const replaceVideoAndRetry = async (content: FacebookContentOut, file: File) => {
    setReplacingId(content.id);
    try {
      await api.replaceFacebookVideoAndRetry(content.id, file);
      setSelectedContent(null);
      toast.success(`Video replaced and generation restarted for ${content.title}`);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not replace the source video");
      onRefresh();
    } finally {
      setReplacingId(null);
    }
  };

  const saveSchedule = async () => {
    if (!scheduleDelivery || !scheduleAt) return;
    setSavingSchedule(true);
    try {
      await api.scheduleFacebookDelivery(scheduleDelivery.id, new Date(scheduleAt).toISOString());
      setScheduleDelivery(null);
      setScheduleAt("");
      toast.success("Publication scheduled");
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not schedule publication");
    } finally {
      setSavingSchedule(false);
    }
  };

  if (!project.has_website || pages.length === 0) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <button
          onClick={() => onOpenSettings("website")}
          className="group rounded-[22px] border border-dashed border-slate-700 bg-[#101827] p-7 text-left transition hover:border-[#1877f2]/50"
        >
          <Globe2 size={24} className="text-[#68a8ff]" />
          <h2 className="mt-5 text-lg font-semibold text-white">Connect the publishing website</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">The article must be published to WordPress before its Facebook post and first comment.</p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[#68a8ff]">Configure website <ChevronRight size={15} /></span>
        </button>
        <button
          onClick={() => onOpenSettings("pages")}
          className="group rounded-[22px] border border-dashed border-slate-700 bg-[#101827] p-7 text-left transition hover:border-[#1877f2]/50"
        >
          <FacebookMark className="h-6 w-6 text-[#68a8ff]" />
          <h2 className="mt-5 text-lg font-semibold text-white">Connect Facebook Pages</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Each Page gets its own comment behavior and publication schedule.</p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[#68a8ff]">Manage Pages <ChevronRight size={15} /></span>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-[20px] border border-slate-800 bg-[#101827]">
        <div className="flex flex-col gap-4 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">Publication calendar</p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setMonth(new Date())} className="btn-secondary text-xs">Today</button>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-slate-800 bg-slate-950/30">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            const dayEvents = byDay[dateKey(day)] || [];
            const inMonth = day.getMonth() === month.getMonth();
            const today = dateKey(day) === dateKey(new Date());
            return (
              <div
                key={day.toISOString()}
                className={`min-h-28 border-slate-800 p-1.5 md:min-h-36 md:p-2 ${
                  index % 7 !== 6 ? "border-r" : ""
                } ${index < 35 ? "border-b" : ""} ${inMonth ? "bg-[#101827]" : "bg-slate-950/25"}`}
              >
                <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] ${
                  today ? "bg-[#1877f2] font-semibold text-white" : inMonth ? "text-slate-400" : "text-slate-700"
                }`}>
                  {day.getDate()}
                </span>
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 3).map((event) => (
                    <button
                      key={event.key}
                      onClick={() => setSelectedContent(event.content)}
                      title={event.delivery ? `${event.delivery.page_name}: ${event.content.title}` : event.content.title}
                      className="block w-full truncate rounded-md border border-[#1877f2]/20 bg-[#1877f2]/10 px-1.5 py-1 text-left text-[10px] font-medium text-[#8bbcff] transition hover:bg-[#1877f2]/20 md:text-xs"
                    >
                      {event.delivery ? `${event.delivery.page_name}: ` : ""}{event.content.title}
                    </button>
                  ))}
                  {dayEvents.length > 3 && <p className="px-1 text-[10px] text-slate-600">+{dayEvents.length - 3} more</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-7 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">Generated content</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Facebook post queue</h2>
        </div>
        <button onClick={onRefresh} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {contents.length === 0 ? (
        <Link
          href={`/facebook/${project.id}/spy-sheet`}
          className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-[20px] border border-dashed border-slate-700 bg-[#101827] p-6 text-center transition hover:border-[#1877f2]/50"
        >
          <Sheet size={24} className="text-[#68a8ff]" />
          <p className="mt-4 font-semibold text-white">The calendar is ready for its first post</p>
          <p className="mt-2 text-sm text-slate-500">Add source videos to Spy Sheet and start generation.</p>
        </Link>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {contents.map((content) => (
            <FacebookPostCard
              key={content.id}
              content={content}
              publishingId={publishingId}
              retryingId={retryingId}
              replacingId={replacingId}
              onPublish={publish}
              onRetry={retryGeneration}
              onReplace={replaceVideoAndRetry}
              onSchedule={(delivery) => {
                setScheduleDelivery(delivery);
                setScheduleAt(delivery.scheduled_at ? localDateTimeInput(delivery.scheduled_at) : "");
              }}
              onOpen={() => setSelectedContent(content)}
            />
          ))}
        </div>
      )}

      {selectedContent && (
        <ContentDetail
          content={selectedContent}
          retrying={retryingId === selectedContent.id}
          replacing={replacingId === selectedContent.id}
          onRetry={() => void retryGeneration(selectedContent)}
          onReplace={(file) => void replaceVideoAndRetry(selectedContent, file)}
          onClose={() => setSelectedContent(null)}
        />
      )}

      {scheduleDelivery && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[22px] border border-slate-700 bg-[#101827] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#68a8ff]">Schedule publication</p>
                <h3 className="mt-1 text-lg font-semibold text-white">{scheduleDelivery.page_name}</h3>
              </div>
              <button onClick={() => setScheduleDelivery(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={17} /></button>
            </div>
            <input
              type="datetime-local"
              value={scheduleAt}
              min={localDateTimeInput(new Date())}
              onChange={(event) => setScheduleAt(event.target.value)}
              className="input-field mt-5"
            />
            <button onClick={saveSchedule} disabled={!scheduleAt || savingSchedule} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {savingSchedule ? <Loader2 size={16} className="animate-spin" /> : <CalendarDays size={16} />} Save schedule
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function FacebookPostCard({
  content,
  publishingId,
  retryingId,
  replacingId,
  onPublish,
  onRetry,
  onReplace,
  onSchedule,
  onOpen,
}: {
  content: FacebookContentOut;
  publishingId: string | null;
  retryingId: string | null;
  replacingId: string | null;
  onPublish: (delivery: FacebookDeliveryOut) => void;
  onRetry: (content: FacebookContentOut) => void;
  onReplace: (content: FacebookContentOut, file: File) => void;
  onSchedule: (delivery: FacebookDeliveryOut) => void;
  onOpen: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-[20px] border border-slate-800 bg-[#101827]">
      <div className="grid md:grid-cols-[210px_1fr]">
        <div className="relative min-h-52 bg-slate-950">
          {content.processed_video_url ? (
            <video src={content.processed_video_url} controls preload="metadata" className="h-full max-h-80 w-full object-cover" />
          ) : content.screenshot_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.screenshot_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full min-h-52 place-items-center">
              {content.status === "processing" ? <Loader2 className="animate-spin text-[#68a8ff]" /> : <Video className="text-slate-700" />}
            </div>
          )}
          <span className={`absolute left-3 top-3 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLE[content.status]}`}>
            {content.status}
          </span>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <FacebookMark className="h-3.5 w-3.5 text-[#68a8ff]" />
                Shared creative
              </div>
              <h3 className="mt-2 text-lg font-semibold leading-6 text-white">{content.title}</h3>
            </div>
            <button onClick={onOpen} className="rounded-lg p-2 text-slate-600 hover:bg-slate-800 hover:text-white"><MoreHorizontal size={17} /></button>
          </div>

          {content.generated_images.length > 0 && (
            <div className="mt-4 flex gap-2">
              {content.generated_images.slice(0, 4).map((image) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={image} src={image} alt="" className="h-12 w-12 rounded-lg border border-slate-700 object-cover" />
              ))}
            </div>
          )}

          {content.error_message && (
            <div className="mt-4 rounded-xl border border-red-900/40 bg-red-950/20 p-3">
              <p className="text-xs leading-5 text-red-300">{content.error_message}</p>
              {content.status === "failed" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className={`inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-red-500 ${replacingId === content.id ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
                    {replacingId === content.id ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    Upload video & retry
                    <input
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm"
                      className="hidden"
                      disabled={replacingId === content.id || retryingId === content.id}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onReplace(content, file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => onRetry(content)}
                    disabled={retryingId === content.id || replacingId === content.id}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-[11px] font-semibold text-red-200 transition hover:bg-red-900/40 disabled:opacity-50"
                  >
                    {retryingId === content.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    Retry same link
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 space-y-2 border-t border-slate-800 pt-4">
            {content.deliveries.map((delivery) => (
              <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-950/35 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-slate-300">{delivery.page_name}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase ${STATUS_STYLE[delivery.status]}`}>{delivery.status}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-600">{formatDate(delivery.scheduled_at || delivery.published_at)}</p>
                </div>
                {content.status === "ready" && ["draft", "failed", "scheduled"].includes(delivery.status) && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => onSchedule(delivery)} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-800 hover:text-amber-300" title="Schedule">
                      <Clock3 size={14} />
                    </button>
                    <button
                      onClick={() => onPublish(delivery)}
                      disabled={publishingId === delivery.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1877f2] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      {publishingId === delivery.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      Publish
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function ContentDetail({
  content,
  retrying,
  replacing,
  onRetry,
  onReplace,
  onClose,
}: {
  content: FacebookContentOut;
  retrying: boolean;
  replacing: boolean;
  onRetry: () => void;
  onReplace: (file: File) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
      <div className="mx-auto my-8 max-w-4xl overflow-hidden rounded-[24px] border border-slate-700 bg-[#101827] shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-800 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#68a8ff]">Generated Facebook post</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{content.title}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>
        <div className="grid gap-6 p-6 md:grid-cols-[300px_1fr]">
          <div>
            {content.processed_video_url ? (
              <video src={content.processed_video_url} controls className="max-h-[520px] w-full rounded-2xl bg-black object-contain" />
            ) : content.status === "failed" ? (
              <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-red-900/40 bg-red-950/15 px-6 text-center">
                <AlertCircle className="text-red-400" />
                <p className="mt-3 text-sm font-medium text-red-200">Video generation failed</p>
                {content.error_message && <p className="mt-2 text-xs leading-5 text-red-300/80">{content.error_message}</p>}
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <label className={`inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-red-500 ${replacing ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
                    {replacing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Upload video & retry
                    <input
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm"
                      className="hidden"
                      disabled={replacing || retrying}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onReplace(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={onRetry}
                    disabled={retrying || replacing}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-2.5 text-xs font-semibold text-red-200 transition hover:bg-red-900/40 disabled:opacity-50"
                  >
                    {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                    Retry same link
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid min-h-80 place-items-center rounded-2xl bg-slate-950"><Loader2 className="animate-spin text-[#68a8ff]" /></div>
            )}
          </div>
          <div className="space-y-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Generated images</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {content.generated_images.map((image) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={image} src={image} alt="" className="aspect-square w-full rounded-xl border border-slate-700 object-cover" />
                ))}
                {content.generated_images.length === 0 && <p className="col-span-2 text-sm text-slate-600">Images are not ready yet.</p>}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Article</p>
              <p className="mt-2 text-sm text-slate-400">
                {content.generated_article
                  ? "Generated and ready for WordPress"
                  : content.status === "failed"
                    ? "Article generation failed"
                    : "Generation in progress"}
              </p>
              {content.article_url && (
                <a href={content.article_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm text-[#68a8ff] hover:text-white">
                  Open published article <ExternalLink size={14} />
                </a>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Page deliveries</p>
              <div className="mt-3 space-y-2">
                {content.deliveries.map((delivery) => (
                  <div key={delivery.id} className="rounded-xl border border-slate-800 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">{delivery.page_name}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase ${STATUS_STYLE[delivery.status]}`}>{delivery.status}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">{formatDate(delivery.scheduled_at || delivery.published_at)}</p>
                    {delivery.error_message && <p className="mt-2 text-xs text-red-300">{delivery.error_message}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FacebookSettings({
  project,
  pages,
  activeTab,
  onTab,
  onRefresh,
  onProject,
}: {
  project: FacebookProjectOut;
  pages: FacebookPageOut[];
  activeTab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onRefresh: () => void;
  onProject: (project: FacebookProjectOut) => void;
}) {
  const tabs = [
    { key: "website" as SettingsTab, label: "Website", icon: Globe2 },
    { key: "pages" as SettingsTab, label: "Facebook Pages", icon: Users },
    { key: "keys" as SettingsTab, label: "API Keys", icon: KeyRound },
    { key: "ai_prompts" as SettingsTab, label: "AI Prompts", icon: MessageSquare },
    { key: "video_prompts" as SettingsTab, label: "Video Prompts", icon: MessageSquareText },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav className="h-fit rounded-[18px] border border-slate-800 bg-[#101827] p-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            onClick={() => onTab(item.key)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
              activeTab === item.key ? "bg-[#1877f2]/12 font-medium text-[#8bbcff]" : "text-slate-500 hover:bg-slate-800/60 hover:text-white"
            }`}
          >
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {activeTab === "website" && (
          <SettingsSection title="Publishing website" description="This is the existing Projects website configuration, reused directly by the Facebook pipeline.">
            <FacebookWebsiteSettings contentProjectId={project.content_project_id} onChanged={onRefresh} />
          </SettingsSection>
        )}
        {activeTab === "pages" && (
          <FacebookPagesSettings project={project} pages={pages} onRefresh={onRefresh} onProject={onProject} />
        )}
        {activeTab === "keys" && <FacebookKeysSettings contentProjectId={project.content_project_id} />}
        {activeTab === "ai_prompts" && <FacebookAiPromptSettings contentProjectId={project.content_project_id} />}
        {activeTab === "video_prompts" && <FacebookVideoPromptSettings contentProjectId={project.content_project_id} />}
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function FacebookPagesSettings({
  project,
  pages,
  onRefresh,
  onProject,
}: {
  project: FacebookProjectOut;
  pages: FacebookPageOut[];
  onRefresh: () => void;
  onProject: (project: FacebookProjectOut) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [showConnect, setShowConnect] = useState(false);
  const [commentMode, setCommentMode] = useState<FacebookCommentMode>("full_recipe");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [editingPage, setEditingPage] = useState<FacebookPageOut | null>(null);
  const [appId, setAppId] = useState(project.app_id || "");
  const [appSecret, setAppSecret] = useState("");
  const [savingApp, setSavingApp] = useState(false);
  const oauthPopupRef = useRef<Window | null>(null);
  const oauthPopupPollRef = useRef<number | null>(null);
  const oauthTimeoutRef = useRef<number | null>(null);

  const clearOAuthWindow = useCallback((closePopup = false) => {
    if (oauthPopupPollRef.current !== null) {
      window.clearInterval(oauthPopupPollRef.current);
      oauthPopupPollRef.current = null;
    }
    if (oauthTimeoutRef.current !== null) {
      window.clearTimeout(oauthTimeoutRef.current);
      oauthTimeoutRef.current = null;
    }

    const popup = oauthPopupRef.current;
    if (closePopup && popup && !popup.closed) popup.close();
    oauthPopupRef.current = null;
  }, []);

  const stopOAuth = useCallback((closePopup = false) => {
    clearOAuthWindow(closePopup);
    setConnecting(false);
  }, [clearOAuthWindow]);

  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== "facebook-oauth") return;
      if (oauthPopupRef.current && event.source !== oauthPopupRef.current) return;

      // The callback was reached, so popup polling is no longer needed. Keep the
      // loading state active while the backend exchanges the authorization code.
      clearOAuthWindow(false);
      if (event.data.error) {
        toast.error(event.data.error);
        setConnecting(false);
        return;
      }
      try {
        const connected = await api.connectFacebookPages({ code: event.data.code, state: event.data.state });
        toast.success(`${connected.length} Facebook Page${connected.length === 1 ? "" : "s"} connected`);
        setShowConnect(false);
        onRefresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not connect Facebook Pages");
      } finally {
        setConnecting(false);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [clearOAuthWindow, onRefresh, toast]);

  useEffect(() => () => clearOAuthWindow(true), [clearOAuthWindow]);

  const connectOAuth = async () => {
    stopOAuth(true);
    setConnecting(true);
    try {
      const { url } = await api.getFacebookOAuthUrl(project.id, commentMode);
      const popup = window.open(url, "facebook-oauth", "width=720,height=760,resizable=yes,scrollbars=yes");
      if (!popup) throw new Error("Allow popups to connect Facebook Pages.");
      oauthPopupRef.current = popup;

      oauthPopupPollRef.current = window.setInterval(() => {
        if (!popup.closed) return;
        stopOAuth(false);
        toast.warning("Facebook login was closed before it completed. You can try again.");
      }, 500);

      oauthTimeoutRef.current = window.setTimeout(() => {
        stopOAuth(true);
        toast.error("Facebook login timed out. Please try again.");
      }, 120_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start Facebook login");
      stopOAuth(true);
    }
  };

  const cancelOAuth = () => {
    stopOAuth(true);
    toast.warning("Facebook connection cancelled.");
  };

  const closeConnectModal = () => {
    stopOAuth(true);
    setShowConnect(false);
  };

  const connectToken = async () => {
    if (!token.trim()) return;
    setConnecting(true);
    try {
      await api.addFacebookPageByToken(project.id, token.trim(), commentMode);
      setToken("");
      setShowConnect(false);
      toast.success("Facebook Page connected");
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not connect Page");
    } finally {
      setConnecting(false);
    }
  };

  const saveApp = async () => {
    setSavingApp(true);
    try {
      const updated = await api.updateFacebookProject(project.id, {
        app_id: appId.trim(),
        ...(appSecret.trim() ? { app_secret: appSecret.trim() } : {}),
      });
      onProject(updated);
      setAppSecret("");
      toast.success("Facebook app credentials saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save app credentials");
    } finally {
      setSavingApp(false);
    }
  };

  const removePage = async (page: FacebookPageOut) => {
    const accepted = await confirm({
      message: `Disconnect ${page.name} from this project?`,
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!accepted) return;
    await api.deleteFacebookPage(page.id);
    onRefresh();
  };

  return (
    <SettingsSection title="Facebook Pages" description="Connect one or more managed Pages. Content is generated once, then delivered according to each Page’s own schedule and first-comment rule.">
      <div className="mb-5 overflow-hidden rounded-[20px] border border-slate-800 bg-[#101827]">
        <div className="border-b border-slate-800 px-5 py-4">
          <h3 className="font-semibold text-white">Facebook App</h3>
          <p className="mt-1 text-xs text-slate-500">Use a project-specific App ID and Secret, or leave these to the server environment.</p>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">App ID</label>
            <input value={appId} onChange={(event) => setAppId(event.target.value)} className="input-field font-mono text-sm" placeholder="Facebook App ID" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">App Secret</label>
            <input type="password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} className="input-field font-mono text-sm" placeholder={project.has_app_secret ? "•••••••• leave blank to keep" : "Facebook App Secret"} />
          </div>
        </div>
        <div className="flex justify-end border-t border-slate-800 px-5 py-4">
          <button onClick={saveApp} disabled={savingApp || !appId.trim()} className="btn-secondary inline-flex items-center gap-2">
            {savingApp ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save App
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">{pages.length} connected Page{pages.length === 1 ? "" : "s"}</p>
        <button onClick={() => setShowConnect(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2f86f6]">
          <Plus size={16} /> Connect Facebook Pages
        </button>
      </div>

      <div className="space-y-3">
        {pages.map((page) => (
          <div key={page.id} className="overflow-hidden rounded-[18px] border border-slate-800 bg-[#101827]">
            <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                {page.picture_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={page.picture_url} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-[#1877f2]/25" />
                ) : (
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-[#1877f2] text-white"><FacebookMark className="h-5 w-5" /></span>
                )}
                <div>
                  <h3 className="font-semibold text-white">{page.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    First comment: {page.comment_mode === "full_recipe_url" ? "Full Recipe + article URL" : "Full Recipe"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditingPage(page)} className="btn-secondary inline-flex items-center gap-2"><Pencil size={14} /> Schedule</button>
                <button onClick={() => removePage(page)} className="rounded-lg border border-red-900/40 p-2.5 text-red-400 hover:bg-red-500/10"><Trash2 size={15} /></button>
              </div>
            </div>
            <div className="grid gap-px bg-slate-800 sm:grid-cols-4">
              {[
                ["Window", `${page.publish_start_time}–${page.publish_end_time}`],
                ["Maximum", `${page.max_posts_per_day}/day`],
                ["Interval", `${page.interval_minutes} min`],
                ["Timezone", page.timezone],
              ].map(([label, value]) => (
                <div key={label} className="bg-[#101827] px-4 py-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600">{label}</p>
                  <p className="mt-1 text-xs font-medium text-slate-300">{value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        {pages.length === 0 && (
          <div className="rounded-[18px] border border-dashed border-slate-700 bg-[#101827] px-6 py-10 text-center text-sm text-slate-600">
            No Facebook Pages connected yet.
          </div>
        )}
      </div>

      {showConnect && (
        <ConnectPageModal
          commentMode={commentMode}
          onCommentMode={setCommentMode}
          token={token}
          onToken={setToken}
          connecting={connecting}
          onOAuth={connectOAuth}
          onCancelOAuth={cancelOAuth}
          onTokenConnect={connectToken}
          onClose={closeConnectModal}
        />
      )}
      {editingPage && (
        <PageScheduleModal page={editingPage} onClose={() => setEditingPage(null)} onSaved={() => { setEditingPage(null); onRefresh(); }} />
      )}
    </SettingsSection>
  );
}

function ConnectPageModal({
  commentMode,
  onCommentMode,
  token,
  onToken,
  connecting,
  onOAuth,
  onCancelOAuth,
  onTokenConnect,
  onClose,
}: {
  commentMode: FacebookCommentMode;
  onCommentMode: (mode: FacebookCommentMode) => void;
  token: string;
  onToken: (value: string) => void;
  connecting: boolean;
  onOAuth: () => void;
  onCancelOAuth: () => void;
  onTokenConnect: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-[24px] border border-slate-700 bg-[#101827] shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-800 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#68a8ff]">Connect a Page</p>
            <h2 className="mt-1 text-xl font-semibold text-white">How should the first comment work?</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>
        <div className="space-y-5 p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { mode: "full_recipe" as FacebookCommentMode, title: "Full Recipe", sample: "Full Recipe" },
              { mode: "full_recipe_url" as FacebookCommentMode, title: "Full Recipe + URL", sample: "Full Recipe\nhttps://your-site.com/article" },
            ].map((option) => (
              <button
                key={option.mode}
                onClick={() => onCommentMode(option.mode)}
                className={`rounded-2xl border p-4 text-left transition ${
                  commentMode === option.mode ? "border-[#1877f2] bg-[#1877f2]/10" : "border-slate-700 hover:border-slate-600"
                }`}
              >
                <MessageSquareText size={18} className={commentMode === option.mode ? "text-[#68a8ff]" : "text-slate-600"} />
                <p className="mt-3 text-sm font-semibold text-white">{option.title}</p>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-950/50 p-2 text-[10px] leading-4 text-slate-500">{option.sample}</pre>
              </button>
            ))}
          </div>
          <button onClick={onOAuth} disabled={connecting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1877f2] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#2f86f6] disabled:opacity-50">
            {connecting ? <Loader2 size={17} className="animate-spin" /> : <FacebookMark className="h-4 w-4" />}
            {connecting ? "Waiting for Facebook..." : "Continue with Facebook"}
          </button>
          {connecting && (
            <button onClick={onCancelOAuth} className="w-full text-center text-xs font-medium text-slate-400 transition hover:text-white">
              Cancel Facebook connection
            </button>
          )}
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-slate-700"><span className="h-px flex-1 bg-slate-800" /> or paste a Page token <span className="h-px flex-1 bg-slate-800" /></div>
          <div className="flex gap-2">
            <input value={token} onChange={(event) => onToken(event.target.value)} type="password" className="input-field font-mono text-xs" placeholder="Page access token" />
            <button onClick={onTokenConnect} disabled={connecting || !token.trim()} className="btn-secondary shrink-0">Connect</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PageScheduleModal({
  page,
  onClose,
  onSaved,
}: {
  page: FacebookPageOut;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    publish_start_time: page.publish_start_time,
    publish_end_time: page.publish_end_time,
    max_posts_per_day: page.max_posts_per_day,
    interval_minutes: page.interval_minutes,
    timezone: page.timezone,
    comment_mode: page.comment_mode,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateFacebookPage(page.id, form);
      toast.success(`${page.name} schedule saved`);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save schedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-[24px] border border-slate-700 bg-[#101827] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#68a8ff]">Page publishing rules</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{page.name}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-500">Publishing start</label>
            <input type="time" value={form.publish_start_time} onChange={(event) => setForm({ ...form, publish_start_time: event.target.value })} className="input-field" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-500">Publishing end</label>
            <input type="time" value={form.publish_end_time} onChange={(event) => setForm({ ...form, publish_end_time: event.target.value })} className="input-field" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-500">Maximum posts / day</label>
            <input type="number" min={1} max={100} value={form.max_posts_per_day} onChange={(event) => setForm({ ...form, max_posts_per_day: Number(event.target.value) })} className="input-field" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-500">Interval (minutes)</label>
            <input type="number" min={1} max={1440} value={form.interval_minutes} onChange={(event) => setForm({ ...form, interval_minutes: Number(event.target.value) })} className="input-field" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-2 block text-xs font-medium text-slate-500">Timezone</label>
            <input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} className="input-field" placeholder="Africa/Casablanca" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-2 block text-xs font-medium text-slate-500">First comment</label>
            <select value={form.comment_mode} onChange={(event) => setForm({ ...form, comment_mode: event.target.value as FacebookCommentMode })} className="input-field">
              <option value="full_recipe">Full Recipe</option>
              <option value="full_recipe_url">Full Recipe + WordPress article URL</option>
            </select>
          </div>
          <div className="sm:col-span-2 rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-xs leading-5 text-slate-500">
            Example: 12:00–19:00 with a 180-minute interval produces 12:00, 15:00, and 18:00. Remaining posts continue the next day.
          </div>
        </div>
        <div className="flex justify-end border-t border-slate-800 px-6 py-4">
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save rules
          </button>
        </div>
      </div>
    </div>
  );
}

const KEY_GROUPS = [
  {
    title: "ChatGPT / OpenAI",
    description: "Used for voice-over, recipe card, title, and article generation.",
    icon: Sparkles,
    fields: [{ key: "openai", label: "OpenAI API Key", placeholder: "sk-…", type: "password" }],
  },
  {
    title: "Midjourney (Discord)",
    description: "Existing Midjourney management is reused for generated article images.",
    icon: ImageIcon,
    fields: [
      { key: "discord_auth", label: "Discord Authorization", placeholder: "Authorization token", type: "password" },
      { key: "discord_channel", label: "Discord Channel ID", placeholder: "Channel ID", type: "text" },
      { key: "discord_app_id", label: "Discord Application ID", placeholder: "Application ID", type: "text" },
    ],
  },
];

function FacebookKeysSettings({ contentProjectId }: { contentProjectId: string }) {
  const toast = useToast();
  const [credentials, setCredentials] = useState<CredentialOut[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getCredentials(contentProjectId).then(setCredentials).catch(() => {});
  }, [contentProjectId]);

  const save = async () => {
    const changed = Object.entries(values).filter(([, value]) => value.trim());
    if (!changed.length) return;
    setSaving(true);
    try {
      const updated = await api.setCredentials(
        contentProjectId,
        changed.map(([key_type, value]) => ({ key_type, value })),
      );
      setCredentials(updated);
      setValues({});
      toast.success("Facebook project API keys saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save API keys");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title="API Keys" description="These credentials are stored on the linked content project and use the same encrypted implementation as the existing Projects page.">
      <div className="mb-4 rounded-xl border border-blue-900/50 bg-blue-950/20 px-4 py-3 text-sm text-blue-200">
        These API keys are specific to this project and do not affect other projects.
      </div>
      <div className="space-y-4">
        {KEY_GROUPS.map((group) => (
          <div key={group.title} className="overflow-hidden rounded-[18px] border border-slate-800 bg-[#101827]">
            <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-800 text-slate-400"><group.icon size={17} /></span>
              <div>
                <h3 className="font-semibold text-white">{group.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{group.description}</p>
              </div>
            </div>
            <div className="space-y-3 p-5">
              {group.fields.map((field) => {
                const masked = credentials.find((credential) => credential.key_type === field.key)?.masked_value || "Not configured";
                return (
                  <div key={field.key} className="rounded-xl border border-slate-800 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="text-sm font-medium text-slate-300">{field.label}</label>
                      <span className="font-mono text-[10px] text-slate-600">{masked}</span>
                    </div>
                    <input type={field.type} value={values[field.key] || ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} className="input-field font-mono text-xs" placeholder={field.placeholder} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={save} disabled={saving || !Object.values(values).some((value) => value.trim())} className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save API keys
        </button>
      </div>
    </SettingsSection>
  );
}

const FACEBOOK_PROMPT_KEYS = ["facebook_video_script", "facebook_recipe_card"];

function FacebookVideoPromptSettings({ contentProjectId }: { contentProjectId: string }) {
  const toast = useToast();
  const [prompts, setPrompts] = useState<PromptOut[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettingsPrompts(contentProjectId)
      .then((all) => {
        const selected = all.filter((prompt) => FACEBOOK_PROMPT_KEYS.includes(prompt.key));
        setPrompts(selected);
        setValues(Object.fromEntries(selected.map((prompt) => [prompt.key, prompt.value])));
      })
      .catch(() => {});
  }, [contentProjectId]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.setSettingsPrompts(contentProjectId, values);
      setPrompts(updated.filter((prompt) => FACEBOOK_PROMPT_KEYS.includes(prompt.key)));
      toast.success("Facebook video prompts saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save prompts");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title="Video Prompts" description="Edit every AI prompt introduced by the converted video-generation service. Use {recipe_title} where the source title should be inserted.">
      <div className="space-y-4">
        {[
          {
            key: "facebook_video_script",
            title: "Voice-over script",
            description: "Creates the short viral audio spoken over the processed video.",
            icon: MonitorPlay,
          },
          {
            key: "facebook_recipe_card",
            title: "Recipe card image",
            description: "Transforms the first video frame into the vertical recipe-card segment.",
            icon: ImageIcon,
          },
        ].map((item) => (
          <div key={item.key} className="overflow-hidden rounded-[18px] border border-slate-800 bg-[#101827]">
            <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#1877f2]/10 text-[#68a8ff]"><item.icon size={17} /></span>
              <div>
                <h3 className="font-semibold text-white">{item.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{item.description}</p>
              </div>
            </div>
            <div className="p-5">
              <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-slate-600">{item.key}</label>
              <textarea
                value={values[item.key] || ""}
                onChange={(event) => setValues({ ...values, [item.key]: event.target.value })}
                rows={item.key === "facebook_recipe_card" ? 12 : 10}
                className="input-field resize-y font-mono text-xs leading-5"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={save} disabled={saving || prompts.every((prompt) => values[prompt.key] === prompt.value)} className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save prompts
        </button>
      </div>
    </SettingsSection>
  );
}
