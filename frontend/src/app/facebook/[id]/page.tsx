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
  Link2,
  ListVideo,
  Loader2,
  MessageSquare,
  MessageSquareText,
  MonitorPlay,
  MoreHorizontal,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ScrollText,
  Send,
  Settings2,
  Sheet,
  SlidersHorizontal,
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
  FacebookPageHealthOut,
  FacebookPageOut,
  FacebookProjectOut,
  FacebookVideoFormat,
  PromptOut,
} from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";
import FacebookWebsiteSettings from "@/components/facebook/FacebookWebsiteSettings";
import FacebookAiPromptSettings from "@/components/facebook/FacebookAiPromptSettings";

type MainTab = "calendar" | "posts" | "settings";
type PostFilter = "all" | "ready" | "processing" | "failed" | "published";
type SettingsTab = "website" | "pages" | "keys" | "ai_prompts" | "video_prompts" | "video_settings";

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

function canPublishFacebookDelivery(
  content: FacebookContentOut,
  delivery: FacebookDeliveryOut,
) {
  if (content.status === "ready") return true;

  // A Facebook delivery can fail after the article has already been published
  // to WordPress. Older records may consequently carry a non-ready content
  // status even though every reusable publication asset is present. Keep the
  // Facebook retry available in that case, without offering it for a genuine
  // video/article generation failure.
  return delivery.status === "failed"
    && Boolean(content.processed_video_url)
    && Boolean(content.article_url || content.generated_article);
}

function publishableFacebookDeliveries(content: FacebookContentOut) {
  return content.deliveries.filter(
    (delivery) =>
      ["draft", "scheduled", "failed"].includes(delivery.status)
      && canPublishFacebookDelivery(content, delivery),
  );
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
  const [tab, setTab] = useState<MainTab>("posts");
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
              Generation Jobs
            </Link>
            <Link
              href={`/facebook/${project.id}/publishing-jobs`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-300 transition hover:border-[#1877f2]/40 hover:bg-[#1877f2]/10 hover:text-[#8bbcff]"
            >
              <Radio size={17} />
              Publication Jobs
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
          { key: "posts" as MainTab, label: "Posts", icon: ListVideo },
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
        {tab === "calendar" || tab === "posts" ? (
          <FacebookCalendar
            contents={contents}
            pages={pages}
            project={project}
            viewMode={tab === "posts" ? "list" : "calendar"}
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
  viewMode,
  onRefresh,
  onOpenSettings,
}: {
  contents: FacebookContentOut[];
  pages: FacebookPageOut[];
  project: FacebookProjectOut;
  viewMode: "calendar" | "list";
  onRefresh: () => void;
  onOpenSettings: (tab: SettingsTab) => void;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedContent, setSelectedContent] = useState<FacebookContentOut | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishingContentId, setPublishingContentId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [scheduleDelivery, setScheduleDelivery] = useState<FacebookDeliveryOut | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [postQuery, setPostQuery] = useState("");
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const selectedContentId = selectedContent?.id;

  const postCounts = useMemo(() => ({
    all: contents.length,
    ready: contents.filter((content) => content.status === "ready").length,
    processing: contents.filter((content) => content.status === "processing").length,
    failed: contents.filter((content) =>
      content.status === "failed" || content.deliveries.some((delivery) => delivery.status === "failed"),
    ).length,
    published: contents.filter((content) =>
      content.deliveries.some((delivery) => delivery.status === "published"),
    ).length,
  }), [contents]);

  const visibleContents = useMemo(() => {
    const query = postQuery.trim().toLowerCase();
    return contents.filter((content) => {
      const matchesQuery = !query
        || content.title.toLowerCase().includes(query)
        || content.deliveries.some((delivery) => delivery.page_name.toLowerCase().includes(query));
      if (!matchesQuery) return false;
      if (postFilter === "ready") return content.status === "ready";
      if (postFilter === "processing") return content.status === "processing";
      if (postFilter === "failed") {
        return content.status === "failed" || content.deliveries.some((delivery) => delivery.status === "failed");
      }
      if (postFilter === "published") {
        return content.deliveries.some((delivery) => delivery.status === "published");
      }
      return true;
    });
  }, [contents, postFilter, postQuery]);

  const selectableVisibleIds = useMemo(
    () => visibleContents
      .filter((content) => publishableFacebookDeliveries(content).length > 0)
      .map((content) => content.id),
    [visibleContents],
  );

  const selectedDeliveryIds = useMemo(
    () => contents
      .filter((content) => selectedPostIds.has(content.id))
      .flatMap((content) => publishableFacebookDeliveries(content).map((delivery) => delivery.id)),
    [contents, selectedPostIds],
  );

  const allSelectableVisibleSelected = selectableVisibleIds.length > 0
    && selectableVisibleIds.every((contentId) => selectedPostIds.has(contentId));

  const toggleSelectAllVisible = () => {
    setSelectedPostIds((current) => {
      const next = new Set(current);
      if (allSelectableVisibleSelected) {
        selectableVisibleIds.forEach((contentId) => next.delete(contentId));
      } else {
        selectableVisibleIds.forEach((contentId) => next.add(contentId));
      }
      return next;
    });
  };

  useEffect(() => {
    const available = new Set(
      contents
        .filter((content) => publishableFacebookDeliveries(content).length > 0)
        .map((content) => content.id),
    );
    setSelectedPostIds((current) => {
      const next = new Set([...current].filter((contentId) => available.has(contentId)));
      if (next.size === current.size && [...next].every((contentId) => current.has(contentId))) {
        return current;
      }
      return next;
    });
  }, [contents]);

  useEffect(() => {
    if (!selectedContentId) return;
    setSelectedContent(contents.find((content) => content.id === selectedContentId) || null);
  }, [contents, selectedContentId]);

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
      toast.success(`Publication started for ${delivery.page_name}`);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Facebook publication failed");
      onRefresh();
    } finally {
      setPublishingId(null);
    }
  };

  const publishContent = async (content: FacebookContentOut) => {
    const deliveries = publishableFacebookDeliveries(content);
    if (!deliveries.length) {
      toast.warning("This post has no delivery waiting to be published.");
      return;
    }
    setPublishingContentId(content.id);
    try {
      const result = await api.publishFacebookDeliveriesBulk(
        deliveries.map((delivery) => delivery.id),
      );
      if (result.queued_ids.length) {
        toast.success(
          `${result.queued_ids.length} Facebook publication job${result.queued_ids.length === 1 ? "" : "s"} started.`,
        );
      }
      if (result.skipped_ids.length) {
        toast.warning(
          `${result.skipped_ids.length} publication job${result.skipped_ids.length === 1 ? " was" : "s were"} already running or completed.`,
        );
      }
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start Facebook publication");
      onRefresh();
    } finally {
      setPublishingContentId(null);
    }
  };

  const publishSelected = async () => {
    if (!selectedDeliveryIds.length) {
      toast.warning("Select at least one post that is ready to publish or retry.");
      return;
    }
    setBulkPublishing(true);
    try {
      const result = await api.publishFacebookDeliveriesBulk(selectedDeliveryIds);
      if (result.queued_ids.length) {
        toast.success(
          `${result.queued_ids.length} Page publication${result.queued_ids.length === 1 ? "" : "s"} started from ${selectedPostIds.size} selected post${selectedPostIds.size === 1 ? "" : "s"}.`,
        );
      }
      if (result.skipped_ids.length) {
        toast.warning(
          `${result.skipped_ids.length} publication${result.skipped_ids.length === 1 ? " was" : "s were"} skipped because the status changed.`,
        );
      }
      setSelectedPostIds(new Set());
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish selected posts");
      onRefresh();
    } finally {
      setBulkPublishing(false);
    }
  };

  const scheduleInline = async (delivery: FacebookDeliveryOut, value: string) => {
    try {
      await api.scheduleFacebookDelivery(delivery.id, new Date(value).toISOString());
      toast.success(`${delivery.page_name} publication scheduled`);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not schedule publication");
      throw error;
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

  const deleteGeneration = async (content: FacebookContentOut) => {
    const accepted = await confirm({
      message: `Delete “${content.title}” from this calendar? Its local files (including an unshared uploaded source) and pending deliveries will be removed. Already published Facebook or WordPress posts are not deleted.`,
      confirmLabel: "Delete generation",
      danger: true,
    });
    if (!accepted) return;
    setDeletingId(content.id);
    try {
      await api.deleteFacebookContent(content.id);
      setSelectedContent((selected) => selected?.id === content.id ? null : selected);
      toast.success("Generation deleted from the calendar");
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete generation");
    } finally {
      setDeletingId(null);
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
      {viewMode === "calendar" && (
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
      )}

      <div className={`${viewMode === "calendar" ? "mt-7" : ""} flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between`}>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
            {viewMode === "list" ? "Content management" : "Generated content"}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            {viewMode === "list" ? "All Facebook posts" : "Facebook post queue"}
          </h2>
          {viewMode === "list" && <p className="mt-1 text-sm text-slate-500">Search, review and manage generated posts without navigating the calendar.</p>}
        </div>
        <button onClick={onRefresh} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {viewMode === "list" && contents.length > 0 && (
        <div className="mt-5 space-y-3 rounded-[18px] border border-slate-800 bg-[#101827] p-3 sm:p-4">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              type="search"
              value={postQuery}
              onChange={(event) => setPostQuery(event.target.value)}
              placeholder="Search by post title or Facebook Page…"
              className="input-field pl-10"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {([[
              "all", "All",
            ], [
              "ready", "Ready",
            ], [
              "processing", "Processing",
            ], [
              "failed", "Needs attention",
            ], [
              "published", "Published",
            ]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPostFilter(value)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  postFilter === value
                    ? "bg-[#1877f2] text-white"
                    : "bg-slate-900 text-slate-500 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {label} <span className="ml-1 opacity-70">{postCounts[value]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-800 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <label className={`inline-flex items-center gap-2.5 text-xs font-medium ${selectableVisibleIds.length ? "cursor-pointer text-slate-300" : "cursor-not-allowed text-slate-600"}`}>
              <input
                type="checkbox"
                checked={allSelectableVisibleSelected}
                disabled={!selectableVisibleIds.length || bulkPublishing}
                onChange={toggleSelectAllVisible}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-[#1877f2]"
              />
              Select all publishable posts in this view
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {selectedPostIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedPostIds(new Set())}
                  disabled={bulkPublishing}
                  className="px-2 py-2 text-xs font-medium text-slate-500 transition hover:text-white disabled:opacity-50"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => void publishSelected()}
                disabled={!selectedDeliveryIds.length || bulkPublishing}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-xs font-semibold text-white shadow-[0_8px_24px_rgba(24,119,242,0.18)] transition hover:bg-[#2f86f6] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {bulkPublishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {bulkPublishing
                  ? "Starting publicationsâ€¦"
                  : `Publish selected (${selectedPostIds.size} posts / ${selectedDeliveryIds.length} Pages)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {contents.length === 0 ? (
        <Link
          href={`/facebook/${project.id}/spy-sheet`}
          className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-[20px] border border-dashed border-slate-700 bg-[#101827] p-6 text-center transition hover:border-[#1877f2]/50"
        >
          <Sheet size={24} className="text-[#68a8ff]" />
          <p className="mt-4 font-semibold text-white">No Facebook posts yet</p>
          <p className="mt-2 text-sm text-slate-500">Add source videos to Spy Sheet and start generation.</p>
        </Link>
      ) : viewMode === "list" ? (
        visibleContents.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-[18px] border border-slate-800 bg-[#101827]">
            <div className="hidden grid-cols-[32px_72px_minmax(220px,1fr)_120px_190px_280px] gap-4 border-b border-slate-800 bg-slate-950/25 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 lg:grid">
              <span>Select</span>
              <span>Media</span>
              <span>Post</span>
              <span>Generation</span>
              <span>Page delivery</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-slate-800">
              {visibleContents.map((content) => (
                <FacebookPostListRow
                  key={content.id}
                  content={content}
                  selected={selectedPostIds.has(content.id)}
                  selectable={publishableFacebookDeliveries(content).length > 0}
                  publishing={publishingContentId === content.id}
                  publishingDeliveryId={publishingId}
                  retrying={retryingId === content.id}
                  replacing={replacingId === content.id}
                  deleting={deletingId === content.id}
                  onSelect={(selected) => setSelectedPostIds((current) => {
                    const next = new Set(current);
                    if (selected) next.add(content.id);
                    else next.delete(content.id);
                    return next;
                  })}
                  onPublishAll={() => void publishContent(content)}
                  onPublishDelivery={(delivery) => void publish(delivery)}
                  onScheduleDelivery={scheduleInline}
                  onRetry={() => void retryGeneration(content)}
                  onReplace={(file) => void replaceVideoAndRetry(content, file)}
                  onDelete={() => void deleteGeneration(content)}
                  onOpen={() => setSelectedContent(content)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid min-h-44 place-items-center rounded-[18px] border border-dashed border-slate-700 bg-[#101827] px-6 text-center">
            <div>
              <Search className="mx-auto text-slate-600" size={24} />
              <p className="mt-3 text-sm font-medium text-slate-300">No posts match this search</p>
              <button type="button" onClick={() => { setPostQuery(""); setPostFilter("all"); }} className="mt-2 text-xs font-medium text-[#68a8ff] hover:text-white">Clear filters</button>
            </div>
          </div>
        )
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {contents.map((content) => (
            <FacebookPostCard
              key={content.id}
              content={content}
              publishingId={publishingId}
              retryingId={retryingId}
              replacingId={replacingId}
              deletingId={deletingId}
              onPublish={publish}
              onRetry={retryGeneration}
              onReplace={replaceVideoAndRetry}
              onDelete={deleteGeneration}
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
          deleting={deletingId === selectedContent.id}
          publishing={publishingContentId === selectedContent.id}
          publishingDeliveryId={publishingId}
          onRetry={() => void retryGeneration(selectedContent)}
          onReplace={(file) => void replaceVideoAndRetry(selectedContent, file)}
          onDelete={() => void deleteGeneration(selectedContent)}
          onPublish={() => void publishContent(selectedContent)}
          onPublishDelivery={(delivery) => void publish(delivery)}
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

function FacebookPostListRow({
  content,
  selected,
  selectable,
  publishing,
  publishingDeliveryId,
  retrying,
  replacing,
  deleting,
  onSelect,
  onPublishAll,
  onPublishDelivery,
  onScheduleDelivery,
  onRetry,
  onReplace,
  onDelete,
  onOpen,
}: {
  content: FacebookContentOut;
  selected: boolean;
  selectable: boolean;
  publishing: boolean;
  publishingDeliveryId: string | null;
  retrying: boolean;
  replacing: boolean;
  deleting: boolean;
  onSelect: (selected: boolean) => void;
  onPublishAll: () => void;
  onPublishDelivery: (delivery: FacebookDeliveryOut) => void;
  onScheduleDelivery: (delivery: FacebookDeliveryOut, value: string) => Promise<void>;
  onRetry: () => void;
  onReplace: (file: File) => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [scheduleDeliveryId, setScheduleDeliveryId] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const publishedCount = content.deliveries.filter((delivery) => delivery.status === "published").length;
  const failedCount = content.deliveries.filter((delivery) => delivery.status === "failed").length;
  const pendingCount = content.deliveries.filter((delivery) =>
    ["processing", "draft", "scheduled", "publishing"].includes(delivery.status),
  ).length;
  const nextDate = content.deliveries
    .map((delivery) => delivery.scheduled_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0] || null;
  const publishableDeliveries = publishableFacebookDeliveries(content);
  const retryOnly = publishableDeliveries.length > 0
    && publishableDeliveries.every((delivery) => delivery.status === "failed");

  const editSchedule = (delivery: FacebookDeliveryOut) => {
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60_000);
    setScheduleDeliveryId(delivery.id);
    setScheduleValue(localDateTimeInput(delivery.scheduled_at || fiveMinutesFromNow));
    setExpanded(true);
  };

  const saveInlineSchedule = async (delivery: FacebookDeliveryOut) => {
    if (!scheduleValue) return;
    setSavingSchedule(true);
    try {
      await onScheduleDelivery(delivery, scheduleValue);
      setScheduleDeliveryId(null);
      setScheduleValue("");
    } finally {
      setSavingSchedule(false);
    }
  };

  return (
    <article className={`transition ${selected ? "bg-[#1877f2]/[0.06]" : "hover:bg-slate-900/35"}`}>
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[32px_72px_minmax(220px,1fr)_120px_190px_280px] lg:items-center">
        <label className={`${selectable ? "cursor-pointer" : "cursor-not-allowed"}`} title={selectable ? "Select this post for bulk publication" : "No Page delivery is ready to publish"}>
          <input
            type="checkbox"
            checked={selected}
            disabled={!selectable || publishing || deleting}
            onChange={(event) => onSelect(event.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-[#1877f2] disabled:opacity-30"
          />
        </label>

        <button type="button" onClick={onOpen} className="relative h-16 w-16 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-600" title="Preview generated post">
          {content.screenshot_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.screenshot_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full place-items-center"><Video size={20} /></span>
          )}
          {content.processed_video_url && <span className="absolute bottom-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/75 text-white"><Video size={10} /></span>}
        </button>

        <div className="min-w-0">
          <button type="button" onClick={onOpen} className="block max-w-full text-left" title="Preview generated post">
            <h3 className="truncate text-sm font-semibold text-white transition hover:text-[#8bbcff]" title={content.title}>{content.title}</h3>
          </button>
          <p className="mt-1 text-xs text-slate-600">Created {formatDate(content.created_at)}</p>
          {nextDate && <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-amber-300/80"><Clock3 size={11} /> Next: {formatDate(nextDate)}</p>}
        </div>

        <div>
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[content.status]}`}>
            {content.status}
          </span>
          {content.error_message && <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-red-300" title={content.error_message}>{content.error_message}</p>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {publishedCount > 0 && <span className="rounded-md border border-emerald-900/60 bg-emerald-950/25 px-2 py-1 text-[10px] font-medium text-emerald-300">{publishedCount} published</span>}
          {pendingCount > 0 && <span className="rounded-md border border-blue-900/60 bg-blue-950/25 px-2 py-1 text-[10px] font-medium text-blue-300">{pendingCount} pending</span>}
          {failedCount > 0 && <span className="rounded-md border border-red-900/60 bg-red-950/25 px-2 py-1 text-[10px] font-medium text-red-300">{failedCount} failed</span>}
          {content.deliveries.length === 0 && <span className="text-xs text-slate-600">No Page delivery</span>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
          {publishableDeliveries.length > 0 && (
            <button
              type="button"
              onClick={onPublishAll}
              disabled={publishing || deleting || Boolean(publishingDeliveryId)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${retryOnly ? "border border-red-800/60 bg-red-950/30 text-red-200 hover:bg-red-900/40" : "bg-[#1877f2] text-white hover:bg-[#2f86f6]"}`}
              title={`${retryOnly ? "Retry" : "Publish"} all available Page deliveries`}
            >
              {publishing ? <Loader2 size={14} className="animate-spin" /> : retryOnly ? <RotateCcw size={14} /> : <Send size={14} />}
              {publishing ? "Startingâ€¦" : retryOnly ? "Retry Facebook" : `Publish (${publishableDeliveries.length})`}
            </button>
          )}
          {content.status === "failed" && (
            <>
              <button type="button" onClick={onRetry} disabled={retrying || replacing || deleting} className="rounded-lg p-2 text-red-400 transition hover:bg-red-500/10 disabled:opacity-50" title="Retry generation from the same link">
                {retrying ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              </button>
              <label className={`rounded-lg p-2 text-red-400 transition hover:bg-red-500/10 ${replacing || retrying || deleting ? "pointer-events-none opacity-50" : "cursor-pointer"}`} title="Upload another video and retry generation">
                {replacing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  disabled={replacing || retrying || deleting}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onReplace(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </>
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${expanded ? "border-[#1877f2]/60 bg-[#1877f2]/10 text-[#8bbcff]" : "border-slate-700 text-slate-300 hover:border-[#1877f2]/50 hover:text-[#8bbcff]"}`}
          >
            <SlidersHorizontal size={14} /> {expanded ? "Close actions" : "All actions"}
          </button>
          {(content.status === "ready" || content.status === "failed") && (
            <button type="button" onClick={onDelete} disabled={deleting || retrying || publishing} className="rounded-lg p-2 text-slate-600 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50" title="Delete generation">
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 bg-slate-950/20 px-4 py-4 lg:pl-[136px]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Page actions</p>
              <p className="mt-1 text-xs text-slate-500">Publish, retry, schedule or open each Page delivery without opening the post popup.</p>
            </div>
            <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-white">
              <MonitorPlay size={14} /> Preview media and article
            </button>
          </div>
          <div className="grid gap-2 xl:grid-cols-2">
            {content.deliveries.map((delivery) => {
              const canPublish = ["draft", "scheduled", "failed"].includes(delivery.status)
                && canPublishFacebookDelivery(content, delivery);
              const editingSchedule = scheduleDeliveryId === delivery.id;
              return (
                <div key={delivery.id} className="rounded-xl border border-slate-800 bg-[#0d1422] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-semibold text-white">{delivery.page_name}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase ${STATUS_STYLE[delivery.status]}`}>{delivery.status}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-600">{formatDate(delivery.scheduled_at || delivery.published_at)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {delivery.status === "published" && delivery.facebook_post_id && (
                        <a
                          href={`https://www.facebook.com/reel/${delivery.facebook_post_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-900/60 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-950/30"
                        >
                          View Reel <ExternalLink size={11} />
                        </a>
                      )}
                      {canPublish && (
                        <>
                          <button
                            type="button"
                            onClick={() => editSchedule(delivery)}
                            disabled={publishing || Boolean(publishingDeliveryId)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:border-amber-700/60 hover:text-amber-300 disabled:opacity-50"
                          >
                            <Clock3 size={12} /> Schedule
                          </button>
                          <button
                            type="button"
                            onClick={() => onPublishDelivery(delivery)}
                            disabled={publishing || Boolean(publishingDeliveryId)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${delivery.status === "failed" ? "border border-red-800/60 bg-red-950/30 text-red-200 hover:bg-red-900/40" : "bg-[#1877f2] text-white hover:bg-[#2f86f6]"}`}
                          >
                            {publishingDeliveryId === delivery.id ? <Loader2 size={12} className="animate-spin" /> : delivery.status === "failed" ? <RotateCcw size={12} /> : <Send size={12} />}
                            {delivery.status === "failed" ? "Retry" : "Publish"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {delivery.error_message && (
                    <p className="mt-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[11px] leading-4 text-red-300">{delivery.error_message}</p>
                  )}
                  {editingSchedule && (
                    <div className="mt-3 flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row">
                      <input
                        type="datetime-local"
                        value={scheduleValue}
                        min={localDateTimeInput(new Date())}
                        onChange={(event) => setScheduleValue(event.target.value)}
                        className="input-field min-w-0 flex-1 py-2 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void saveInlineSchedule(delivery)}
                        disabled={!scheduleValue || savingSchedule}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-40"
                      >
                        {savingSchedule ? <Loader2 size={13} className="animate-spin" /> : <CalendarDays size={13} />} Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setScheduleDeliveryId(null)}
                        disabled={savingSchedule}
                        className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:text-white disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {content.deliveries.length === 0 && (
              <p className="text-xs text-slate-600">No Facebook Page delivery exists for this post.</p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function FacebookPostCard({
  content,
  publishingId,
  retryingId,
  replacingId,
  deletingId,
  onPublish,
  onRetry,
  onReplace,
  onDelete,
  onSchedule,
  onOpen,
}: {
  content: FacebookContentOut;
  publishingId: string | null;
  retryingId: string | null;
  replacingId: string | null;
  deletingId: string | null;
  onPublish: (delivery: FacebookDeliveryOut) => void;
  onRetry: (content: FacebookContentOut) => void;
  onReplace: (content: FacebookContentOut, file: File) => void;
  onDelete: (content: FacebookContentOut) => void;
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
            <div className="flex items-center gap-1">
              {(content.status === "ready" || content.status === "failed") && (
                <button
                  onClick={() => onDelete(content)}
                  disabled={deletingId === content.id}
                  className="rounded-lg p-2 text-slate-600 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                  title="Delete generation"
                >
                  {deletingId === content.id ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
                </button>
              )}
              <button onClick={onOpen} className="rounded-lg p-2 text-slate-600 hover:bg-slate-800 hover:text-white"><MoreHorizontal size={17} /></button>
            </div>
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
                {canPublishFacebookDelivery(content, delivery) && ["draft", "failed", "scheduled"].includes(delivery.status) && (
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
                      {delivery.status === "failed" ? "Retry" : "Publish"}
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
  deleting,
  publishing,
  publishingDeliveryId,
  onRetry,
  onReplace,
  onDelete,
  onPublish,
  onPublishDelivery,
  onClose,
}: {
  content: FacebookContentOut;
  retrying: boolean;
  replacing: boolean;
  deleting: boolean;
  publishing: boolean;
  publishingDeliveryId: string | null;
  onRetry: () => void;
  onReplace: (file: File) => void;
  onDelete: () => void;
  onPublish: () => void;
  onPublishDelivery: (delivery: FacebookDeliveryOut) => void;
  onClose: () => void;
}) {
  const publishableDeliveries = content.deliveries.filter((delivery) =>
    ["draft", "scheduled", "failed"].includes(delivery.status)
      && canPublishFacebookDelivery(content, delivery),
  );
  const publishLabel = publishableDeliveries.length === 1
    ? `Publish to ${publishableDeliveries[0].page_name}`
    : `Publish to ${publishableDeliveries.length} Pages`;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
      <div className="mx-auto my-8 max-w-4xl overflow-hidden rounded-[24px] border border-slate-700 bg-[#101827] shadow-2xl">
        <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#68a8ff]">Generated Facebook post</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{content.title}</h2>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {publishableDeliveries.length > 0 && (
              <button
                onClick={onPublish}
                disabled={publishing || Boolean(publishingDeliveryId) || deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-3.5 py-2 text-xs font-semibold text-white shadow-[0_8px_24px_rgba(24,119,242,0.2)] transition hover:bg-[#2f86f6] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {publishing ? "Publishing…" : publishLabel}
              </button>
            )}
            {(content.status === "ready" || content.status === "failed") && (
              <button
                onClick={onDelete}
                disabled={deleting || publishing || Boolean(publishingDeliveryId)}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Delete
              </button>
            )}
            <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
          </div>
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
                    {delivery.status === "published" && delivery.facebook_post_id && (
                      <a
                        href={`https://www.facebook.com/reel/${delivery.facebook_post_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#8bbcff] transition hover:text-white"
                      >
                        View Reel on Facebook <ExternalLink size={12} />
                      </a>
                    )}
                    {canPublishFacebookDelivery(content, delivery) && ["draft", "scheduled", "failed"].includes(delivery.status) && (
                      <button
                        type="button"
                        onClick={() => onPublishDelivery(delivery)}
                        disabled={publishing || Boolean(publishingDeliveryId)}
                        className={`mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          delivery.status === "failed"
                            ? "border border-red-800/60 bg-red-950/30 text-red-200 hover:bg-red-900/40"
                            : "bg-[#1877f2] text-white hover:bg-[#2f86f6]"
                        }`}
                      >
                        {publishingDeliveryId === delivery.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : delivery.status === "failed" ? (
                          <RotateCcw size={14} />
                        ) : (
                          <Send size={14} />
                        )}
                        {publishingDeliveryId === delivery.id
                          ? "Publishing…"
                          : delivery.status === "failed"
                            ? "Retry publication"
                            : "Publish now"}
                      </button>
                    )}
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
    { key: "video_settings" as SettingsTab, label: "Video Settings", icon: SlidersHorizontal },
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
        {activeTab === "video_settings" && <FacebookVideoSettings project={project} onProject={onProject} />}
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

const VIDEO_FORMAT_OPTIONS: Array<{
  value: FacebookVideoFormat;
  label: string;
  dimensions: string;
  description: string;
}> = [
  { value: "2:3", label: "Portrait 2:3", dimensions: "1024 × 1536", description: "Portrait creative format" },
  { value: "9:16", label: "Reel 9:16", dimensions: "1080 × 1920", description: "Recommended for Facebook Reels" },
  { value: "4:5", label: "Feed 4:5", dimensions: "1080 × 1350", description: "Portrait Facebook feed" },
  { value: "1:1", label: "Square 1:1", dimensions: "1080 × 1080", description: "Square feed post" },
];

function FacebookVideoSettings({
  project,
  onProject,
}: {
  project: FacebookProjectOut;
  onProject: (project: FacebookProjectOut) => void;
}) {
  const toast = useToast();
  const [format, setFormat] = useState<FacebookVideoFormat>(project.video_format);
  const [introSeconds, setIntroSeconds] = useState(project.video_intro_seconds);
  const [fps, setFps] = useState<24 | 30 | 60>(project.video_fps);
  const [bitrate, setBitrate] = useState(project.video_bitrate_kbps);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormat(project.video_format);
    setIntroSeconds(project.video_intro_seconds);
    setFps(project.video_fps);
    setBitrate(project.video_bitrate_kbps);
  }, [project]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateFacebookProject(project.id, {
        video_format: format,
        video_intro_seconds: Math.min(15, Math.max(1, introSeconds)),
        video_fps: fps,
        video_bitrate_kbps: Math.min(20000, Math.max(1000, bitrate)),
      });
      onProject(updated);
      toast.success("Video settings saved for this project");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save video settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title="Video Settings"
      description="These render settings apply only to this Facebook project. Existing generated videos are unchanged; retries use the new settings."
    >
      <div className="overflow-hidden rounded-[20px] border border-slate-800 bg-[#101827]">
        <div className="border-b border-slate-800 px-5 py-4">
          <h3 className="font-semibold text-white">Output format</h3>
          <p className="mt-1 text-xs text-slate-500">The source is centered and cropped to fill the frame without black padding.</p>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {VIDEO_FORMAT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFormat(option.value)}
              className={`rounded-xl border p-4 text-left transition ${
                format === option.value
                  ? "border-[#1877f2] bg-[#1877f2]/10"
                  : "border-slate-700 bg-slate-950/25 hover:border-slate-600"
              }`}
            >
              <span className="text-sm font-semibold text-white">{option.label}</span>
              <span className="mt-2 block font-mono text-xs text-[#68a8ff]">{option.dimensions}</span>
              <span className="mt-2 block text-[11px] leading-4 text-slate-500">{option.description}</span>
            </button>
          ))}
        </div>

        {format !== "9:16" && (
          <div className="mx-5 mb-5 rounded-xl border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-xs leading-5 text-amber-200">
            Facebook Reels are designed for the 9:16 full-screen format. Other formats remain available for creative testing, but Meta may crop them or reject them during Reel processing.
          </div>
        )}

        <div className="grid gap-5 border-t border-slate-800 p-5 md:grid-cols-3">
          <label>
            <span className="text-xs font-medium text-slate-300">Source-video intro</span>
            <span className="mt-1 block text-[11px] text-slate-600">Seconds shown before the recipe card</span>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={15}
                step={0.5}
                value={introSeconds}
                onChange={(event) => setIntroSeconds(Number(event.target.value))}
                className="min-w-0 flex-1 accent-[#1877f2]"
              />
              <span className="w-12 rounded-lg border border-slate-700 bg-slate-950/40 px-2 py-1.5 text-center text-xs font-semibold text-white">{introSeconds}s</span>
            </div>
          </label>

          <label>
            <span className="text-xs font-medium text-slate-300">Frame rate</span>
            <span className="mt-1 block text-[11px] text-slate-600">30 FPS is recommended for most videos</span>
            <select value={fps} onChange={(event) => setFps(Number(event.target.value) as 24 | 30 | 60)} className="input-field mt-3">
              <option value={24}>24 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </label>

          <label>
            <span className="text-xs font-medium text-slate-300">Video bitrate</span>
            <span className="mt-1 block text-[11px] text-slate-600">Higher quality uses more server storage</span>
            <div className="relative mt-3">
              <input
                type="number"
                min={1000}
                max={20000}
                step={500}
                value={bitrate}
                onChange={(event) => setBitrate(Number(event.target.value))}
                className="input-field pr-16"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-600">kbps</span>
            </div>
          </label>
        </div>
        <div className="flex justify-end border-t border-slate-800 px-5 py-4">
          <button onClick={save} disabled={saving} className="btn-secondary inline-flex items-center gap-2">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save video settings
          </button>
        </div>
      </div>
    </SettingsSection>
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
  const [reconnectingPageId, setReconnectingPageId] = useState<string | null>(null);
  const [editingPage, setEditingPage] = useState<FacebookPageOut | null>(null);
  const [appId, setAppId] = useState(project.app_id || "");
  const [appSecret, setAppSecret] = useState("");
  const [savingApp, setSavingApp] = useState(false);
  const [pageHealth, setPageHealth] = useState<Record<string, FacebookPageHealthOut>>({});
  const [checkingPageId, setCheckingPageId] = useState<string | null>(null);
  const oauthPopupRef = useRef<Window | null>(null);
  const oauthPopupPollRef = useRef<number | null>(null);
  const oauthTimeoutRef = useRef<number | null>(null);
  const reconnectingPageRef = useRef<FacebookPageOut | null>(null);

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
    reconnectingPageRef.current = null;
    setReconnectingPageId(null);
  }, [clearOAuthWindow]);

  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== "facebook-oauth") return;
      if (oauthPopupRef.current && event.source !== oauthPopupRef.current) return;

      // The callback was reached, so popup polling is no longer needed. Keep the
      // loading state active while the backend exchanges the authorization code.
      const reconnectingPage = reconnectingPageRef.current;
      clearOAuthWindow(false);
      if (event.data.error) {
        toast.error(event.data.error);
        setConnecting(false);
        reconnectingPageRef.current = null;
        setReconnectingPageId(null);
        return;
      }
      try {
        const connected = await api.connectFacebookPages({ code: event.data.code, state: event.data.state });
        if (reconnectingPage) {
          try {
            const health = await api.getFacebookPageHealth(reconnectingPage.id);
            setPageHealth((current) => ({ ...current, [reconnectingPage.id]: health }));
            if (health.status === "healthy") {
              toast.success(`${reconnectingPage.name} reconnected and verified`);
            } else if (health.status === "warning") {
              toast.warning(health.message);
            } else {
              toast.error(health.message);
            }
          } catch {
            // The token exchange succeeded. A transient health-check failure
            // should not misreport the reconnection itself as failed.
            toast.success(`${reconnectingPage.name} reconnected successfully`);
          }
        } else {
          toast.success(`${connected.length} Facebook Page${connected.length === 1 ? "" : "s"} connected`);
        }
        setShowConnect(false);
        onRefresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not connect Facebook Pages");
      } finally {
        setConnecting(false);
        reconnectingPageRef.current = null;
        setReconnectingPageId(null);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [clearOAuthWindow, onRefresh, toast]);

  useEffect(() => () => clearOAuthWindow(true), [clearOAuthWindow]);

  const connectOAuth = async (page?: FacebookPageOut) => {
    stopOAuth(true);
    reconnectingPageRef.current = page || null;
    setReconnectingPageId(page?.id || null);
    setConnecting(true);
    try {
      const { url } = await api.getFacebookOAuthUrl(
        project.id,
        page?.comment_mode || commentMode,
        page?.id,
      );
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

  const checkPageConnection = async (page: FacebookPageOut) => {
    setCheckingPageId(page.id);
    try {
      const health = await api.getFacebookPageHealth(page.id);
      setPageHealth((current) => ({ ...current, [page.id]: health }));
      if (health.status === "healthy") toast.success(`${page.name} connection is healthy`);
      else if (health.status === "warning") toast.warning(health.message);
      else toast.error(health.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not check Facebook Page connection");
    } finally {
      setCheckingPageId(null);
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
    setPageHealth((current) => {
      const next = { ...current };
      delete next[page.id];
      return next;
    });
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
      <div className="mb-4 rounded-xl border border-[#1877f2]/25 bg-[#1877f2]/5 px-4 py-3 text-xs leading-5 text-slate-400">
        Connection health validates the token, Page, Meta app, and required permissions. For a Reel to be visible to people outside your app roles, the Meta app must also be set to <strong className="text-white">Live</strong> in the Meta Developer dashboard.
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
                    First comment: {page.comment_mode === "full_recipe_url" ? "Full Recipe : WordPress URL" : "Generated recipe"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void checkPageConnection(page)}
                  disabled={checkingPageId === page.id}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  <RefreshCw size={14} className={checkingPageId === page.id ? "animate-spin" : ""} />
                  Check connection
                </button>
                <button
                  onClick={() => void connectOAuth(page)}
                  disabled={connecting}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    pageHealth[page.id]?.status && pageHealth[page.id].status !== "healthy"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15"
                      : "border-[#1877f2]/35 bg-[#1877f2]/10 text-[#8fc0ff] hover:border-[#1877f2]/60 hover:bg-[#1877f2]/15 hover:text-white"
                  }`}
                  title="Renew this Page authorization without changing its settings"
                >
                  {reconnectingPageId === page.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Link2 size={14} />
                  )}
                  {reconnectingPageId === page.id ? "Reconnecting..." : "Reconnect"}
                </button>
                <button onClick={() => setEditingPage(page)} className="btn-secondary inline-flex items-center gap-2"><Pencil size={14} /> Schedule</button>
                <button onClick={() => removePage(page)} className="rounded-lg border border-red-900/40 p-2.5 text-red-400 hover:bg-red-500/10"><Trash2 size={15} /></button>
              </div>
            </div>
            {pageHealth[page.id] && (
              <div
                className={`mx-5 mb-4 rounded-xl border px-4 py-3 text-xs leading-5 ${
                  pageHealth[page.id].status === "healthy"
                    ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-200"
                    : pageHealth[page.id].status === "warning"
                      ? "border-amber-800/50 bg-amber-950/20 text-amber-200"
                      : "border-red-800/50 bg-red-950/20 text-red-200"
                }`}
              >
                <div className="flex items-start gap-2">
                  {pageHealth[page.id].status === "healthy" ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  )}
                  <div>
                    <p className="font-semibold">
                      {pageHealth[page.id].status === "healthy"
                        ? "Connection ready"
                        : pageHealth[page.id].status === "warning"
                          ? "Connection needs attention"
                          : "Connection cannot publish reliably"}
                    </p>
                    <p className="mt-1 opacity-85">{pageHealth[page.id].message}</p>
                    {(pageHealth[page.id].expires_at || pageHealth[page.id].data_access_expires_at) && (
                      <p className="mt-1 opacity-70">
                        Authorization expiry: {formatDate(pageHealth[page.id].expires_at || pageHealth[page.id].data_access_expires_at)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
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
          onOAuth={() => void connectOAuth()}
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
              { mode: "full_recipe" as FacebookCommentMode, title: "Full Recipe", sample: "Ingredients\n- 2 cups ...\n\nInstructions\n1. Mix ..." },
              { mode: "full_recipe_url" as FacebookCommentMode, title: "Full Recipe + URL", sample: "Full Recipe : https://your-site.com/article" },
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
              <option value="full_recipe_url">Full Recipe : WordPress article URL</option>
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
  const confirm = useConfirm();
  const [prompts, setPrompts] = useState<PromptOut[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    const all = await api.getSettingsPrompts(contentProjectId);
    const selected = all.filter((prompt) => FACEBOOK_PROMPT_KEYS.includes(prompt.key));
    setPrompts(selected);
    setValues(Object.fromEntries(selected.map((prompt) => [prompt.key, prompt.value])));
  }, [contentProjectId]);

  useEffect(() => {
    void load().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Could not load video prompts");
    });
    // ToastContext recreates its facade when notifications change; depending on
    // that object here would reload prompts after every toast (and loop on errors).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

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

  const reset = async () => {
    const accepted = await confirm({
      message:
        "Reset only this Facebook project's video prompts to their built-in defaults? Other prompts and projects will not be changed.",
      confirmLabel: "Reset video prompts",
      danger: true,
    });
    if (!accepted) return;
    setResetting(true);
    try {
      await api.resetSettingsPrompts(contentProjectId, FACEBOOK_PROMPT_KEYS);
      await load();
      toast.success("This project's video prompts were reset");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset video prompts");
    } finally {
      setResetting(false);
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
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button onClick={reset} disabled={resetting || saving} className="btn-secondary inline-flex items-center gap-2 hover:border-red-700 hover:text-red-300 disabled:opacity-40">
          {resetting ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Reset defaults
        </button>
        <button onClick={save} disabled={saving || resetting || prompts.every((prompt) => values[prompt.key] === prompt.value)} className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save prompts
        </button>
      </div>
    </SettingsSection>
  );
}
