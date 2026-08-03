"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  CloudUpload,
  Loader2,
  Plus,
  Rocket,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  api,
  FacebookPageOut,
  FacebookProjectOut,
  FacebookSpyRowOut,
} from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";

type LaunchMode = "draft" | "schedule";

function localDateTimeValue(date = new Date(Date.now() + 60 * 60 * 1000)) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function FacebookSpySheetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [project, setProject] = useState<FacebookProjectOut | null>(null);
  const [pages, setPages] = useState<FacebookPageOut[]>([]);
  const [rows, setRows] = useState<FacebookSpyRowOut[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newLink, setNewLink] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [showLaunch, setShowLaunch] = useState(false);
  const [launchMode, setLaunchMode] = useState<LaunchMode>("draft");
  const [startAt, setStartAt] = useState(localDateTimeValue);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [launching, setLaunching] = useState(false);
  const newFileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const [projectData, rowData, pageData] = await Promise.all([
        api.getFacebookProject(id),
        api.getFacebookSpyRows(id),
        api.getFacebookPages(id),
      ]);
      setProject(projectData);
      setRows(rowData);
      setPages(pageData);
      setSelectedPages(new Set(pageData.map((page) => page.id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Spy Sheet");
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );

  const addRow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newLink.trim() || !newTitle.trim()) return;
    setAdding(true);
    try {
      const created = await api.createFacebookSpyRow(id, {
        direct_link: newLink.trim(),
        post_title: newTitle.trim(),
      });
      setRows((current) => [...current, created]);
      setNewLink("");
      setNewTitle("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add row");
    } finally {
      setAdding(false);
    }
  };

  const patchRow = async (
    row: FacebookSpyRowOut,
    data: Partial<Pick<FacebookSpyRowOut, "direct_link" | "post_title">>,
  ) => {
    const value = Object.values(data)[0];
    if (!value?.trim()) return;
    try {
      const updated = await api.updateFacebookSpyRow(row.id, data);
      setRows((current) => current.map((item) => (item.id === row.id ? updated : item)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save row");
      load();
    }
  };

  const deleteRow = async (rowId: string) => {
    await api.deleteFacebookSpyRow(rowId);
    setRows((current) => current.filter((row) => row.id !== rowId));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(rowId);
      return next;
    });
  };

  const uploadVideo = async (file: File, row?: FacebookSpyRowOut) => {
    setUploading(row?.id || "new");
    try {
      const { url } = await api.uploadFacebookVideo(file);
      if (row) {
        const updated = await api.updateFacebookSpyRow(row.id, { direct_link: url });
        setRows((current) => current.map((item) => (item.id === row.id ? updated : item)));
      } else {
        setNewLink(url);
      }
      toast.success("Video uploaded to the workspace");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Video upload failed");
    } finally {
      setUploading(null);
    }
  };

  const startGeneration = async () => {
    setLaunching(true);
    try {
      const result = await api.startFacebookGeneration(id, {
        row_ids: selectedRows.map((row) => row.id),
        schedule: launchMode === "schedule",
        start_at:
          launchMode === "schedule" ? new Date(startAt).toISOString() : undefined,
        page_ids: [...selectedPages],
      });
      setRows((current) => current.filter((row) => !selected.has(row.id)));
      setSelected(new Set());
      setShowLaunch(false);
      toast.success(
        `Generation started for ${result.removed_rows} video${result.removed_rows === 1 ? "" : "s"}.`,
      );
      if (result.remaining_rows <= 2) {
        toast.warning(
          result.low_queue_email_sent
            ? `Only ${result.remaining_rows} Spy Sheet rows remain. A reminder email was sent.`
            : `Only ${result.remaining_rows} Spy Sheet rows remain. Add more data soon.`,
        );
      }
      router.push(`/facebook/${id}/logs`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start generation");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <button
        onClick={() => router.push(`/facebook/${id}`)}
        className="mb-5 flex items-center gap-2 text-sm text-slate-500 transition hover:text-white"
      >
        <ArrowLeft size={16} />
        Back to Calendar
      </button>

      <div className="flex flex-col gap-5 rounded-[24px] border border-slate-800 bg-[#0d1422] p-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#68a8ff]">
            <span className="h-2 w-2 rounded-full bg-[#1877f2] shadow-[0_0_12px_#1877f2]" />
            Intake queue
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Spy Sheet</h1>
          <p className="mt-2 text-sm text-slate-500">
            {project?.name || "Facebook project"} · Add a workspace video and the post title you want to develop.
          </p>
        </div>
        <button
          onClick={() => setShowLaunch(true)}
          disabled={selected.size === 0 || pages.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1877f2] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(24,119,242,.25)] transition hover:bg-[#2f86f6] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Rocket size={17} />
          Start Generation
          {selected.size > 0 && (
            <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-xs">{selected.size}</span>
          )}
        </button>
      </div>

      {pages.length === 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle size={17} className="shrink-0 text-amber-400" />
          Connect at least one Facebook Page in Settings before starting generation.
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded-[20px] border border-slate-800 bg-[#101827]">
        <div className="grid grid-cols-[48px_minmax(260px,1.25fr)_minmax(240px,1fr)_92px] items-center border-b border-slate-800 bg-slate-950/40 px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          <label className="grid place-items-center">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))}
              className="rounded border-slate-600 bg-slate-900 text-[#1877f2] focus:ring-[#1877f2]"
              aria-label="Select all rows"
            />
          </label>
          <span>Direct Link</span>
          <span>Post Title</span>
          <span className="text-right">Actions</span>
        </div>

        {rows.map((row, index) => (
          <div
            key={row.id}
            className={`grid grid-cols-[48px_minmax(260px,1.25fr)_minmax(240px,1fr)_92px] items-center px-3 py-2.5 transition ${
              index !== rows.length - 1 ? "border-b border-slate-800/80" : ""
            } ${selected.has(row.id) ? "bg-[#1877f2]/[0.055]" : "hover:bg-white/[0.018]"}`}
          >
            <label className="grid place-items-center">
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    next.has(row.id) ? next.delete(row.id) : next.add(row.id);
                    return next;
                  })
                }
                className="rounded border-slate-600 bg-slate-900 text-[#1877f2] focus:ring-[#1877f2]"
                aria-label={`Select ${row.post_title}`}
              />
            </label>
            <div className="flex min-w-0 items-center gap-2 pr-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-800 text-slate-400">
                <Video size={15} />
              </span>
              <input
                value={row.direct_link}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((item) =>
                      item.id === row.id ? { ...item, direct_link: event.target.value } : item,
                    ),
                  )
                }
                onBlur={(event) => patchRow(row, { direct_link: event.target.value })}
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-300 outline-none placeholder:text-slate-700"
              />
            </div>
            <input
              value={row.post_title}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item) =>
                    item.id === row.id ? { ...item, post_title: event.target.value } : item,
                  ),
                )
              }
              onBlur={(event) => patchRow(row, { post_title: event.target.value })}
              className="min-w-0 bg-transparent pr-4 text-sm font-medium text-white outline-none placeholder:text-slate-700"
            />
            <div className="flex justify-end gap-1">
              <label className="cursor-pointer rounded-lg p-2 text-slate-600 transition hover:bg-[#1877f2]/10 hover:text-[#68a8ff]" title="Replace workspace video">
                {uploading === row.id ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16} />}
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadVideo(file, row);
                    event.target.value = "";
                  }}
                />
              </label>
              <button onClick={() => deleteRow(row.id)} className="rounded-lg p-2 text-slate-600 transition hover:bg-red-500/10 hover:text-red-400" title="Delete row">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        <form
          onSubmit={addRow}
          className="grid grid-cols-[48px_minmax(260px,1.25fr)_minmax(240px,1fr)_92px] items-center border-t border-slate-800 bg-slate-950/20 px-3 py-3"
        >
          <span className="grid place-items-center text-slate-700">
            <Plus size={16} />
          </span>
          <div className="flex items-center gap-2 pr-4">
            <input
              value={newLink}
              onChange={(event) => setNewLink(event.target.value)}
              className="input-field h-10 flex-1 text-sm"
              placeholder="Paste a video link or upload…"
            />
            <button
              type="button"
              onClick={() => newFileRef.current?.click()}
              disabled={uploading !== null}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-400 transition hover:border-[#1877f2]/60 hover:text-[#68a8ff]"
              title="Upload video"
            >
              {uploading === "new" ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16} />}
            </button>
            <input
              ref={newFileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadVideo(file);
                event.target.value = "";
              }}
            />
          </div>
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            className="input-field h-10 text-sm"
            placeholder="e.g. Crispy garlic parmesan potatoes"
          />
          <div className="flex justify-end">
            <button
              disabled={adding || !newLink.trim() || !newTitle.trim()}
              className="grid h-10 w-10 place-items-center rounded-lg bg-[#1877f2] text-white transition hover:bg-[#2f86f6] disabled:opacity-30"
              title="Add row"
            >
              {adding ? <Loader2 size={16} className="animate-spin" /> : <Check size={17} />}
            </button>
          </div>
        </form>

        {rows.length === 0 && (
          <div className="border-t border-slate-800 px-6 py-10 text-center text-sm text-slate-600">
            Your intake queue is empty. Use the row above to add the first source video.
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-slate-600">
        Selected rows are removed from the Spy Sheet as soon as generation begins. A reminder email is sent when two or fewer rows remain.
      </p>

      {showLaunch && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-black/75 p-3 backdrop-blur-sm sm:p-4">
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-[24px] border border-slate-700 bg-[#101827] shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#68a8ff]">Generation plan</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Prepare {selected.size} post{selected.size === 1 ? "" : "s"}</h2>
              </div>
              <button onClick={() => setShowLaunch(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-color:#334155_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => setLaunchMode("draft")}
                  className={`rounded-2xl border p-4 text-left transition ${
                    launchMode === "draft" ? "border-[#1877f2] bg-[#1877f2]/10" : "border-slate-700 hover:border-slate-600"
                  }`}
                >
                  <Video size={19} className={launchMode === "draft" ? "text-[#68a8ff]" : "text-slate-500"} />
                  <p className="mt-3 text-sm font-semibold text-white">Prepare drafts</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Generate everything, then publish manually from Calendar.</p>
                </button>
                <button
                  onClick={() => setLaunchMode("schedule")}
                  className={`rounded-2xl border p-4 text-left transition ${
                    launchMode === "schedule" ? "border-[#1877f2] bg-[#1877f2]/10" : "border-slate-700 hover:border-slate-600"
                  }`}
                >
                  <CalendarClock size={19} className={launchMode === "schedule" ? "text-[#68a8ff]" : "text-slate-500"} />
                  <p className="mt-3 text-sm font-semibold text-white">Schedule automatically</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Use each Page’s daily window, cap, and interval.</p>
                </button>
              </div>

              {launchMode === "schedule" && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Start scheduling from</label>
                  <input
                    type="datetime-local"
                    value={startAt}
                    onChange={(event) => setStartAt(event.target.value)}
                    min={localDateTimeValue(new Date())}
                    className="input-field"
                  />
                </div>
              )}

              <div>
                <p className="mb-2 text-sm font-medium text-slate-300">Publish to Pages</p>
                <div className="space-y-2">
                  {pages.map((page) => (
                    <label key={page.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3">
                      <span className="flex items-center gap-3">
                        {page.picture_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={page.picture_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : (
                          <span className="h-8 w-8 rounded-full bg-[#1877f2]" />
                        )}
                        <span>
                          <span className="block text-sm font-medium text-white">{page.name}</span>
                          <span className="block text-xs text-slate-600">
                            {page.publish_start_time}–{page.publish_end_time} · every {page.interval_minutes / 60 >= 1 ? `${page.interval_minutes / 60}h` : `${page.interval_minutes}m`}
                          </span>
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={selectedPages.has(page.id)}
                        onChange={() =>
                          setSelectedPages((current) => {
                            const next = new Set(current);
                            next.has(page.id) ? next.delete(page.id) : next.add(page.id);
                            return next;
                          })
                        }
                        className="rounded border-slate-600 bg-slate-900 text-[#1877f2] focus:ring-[#1877f2]"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-3 border-t border-slate-800 bg-slate-950/30 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-600">Content is generated once and reused for every selected Page.</p>
              <button
                onClick={startGeneration}
                disabled={launching || selectedPages.size === 0 || (launchMode === "schedule" && !startAt)}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2f86f6] disabled:opacity-40"
              >
                {launching ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
                {launching ? "Starting…" : "Start generation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
