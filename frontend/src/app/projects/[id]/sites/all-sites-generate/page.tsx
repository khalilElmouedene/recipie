"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Send, Save } from "lucide-react";
import { api, SharedRecipeInput, SiteOut, JobOut, PublishScheduleOut } from "@/lib/api";

export default function AllSitesGeneratePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const [sites, setSites] = useState<SiteOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SharedRecipeInput[]>([{ image_url: "", recipe_text: "" }]);
  const [history, setHistory] = useState<JobOut[]>([]);
  const [schedule, setSchedule] = useState<PublishScheduleOut | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState(4);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [startingPublish, setStartingPublish] = useState(false);

  useEffect(() => {
    api.getSites(projectId).then(setSites).catch(() => {});
    api.getProjectJobs(projectId)
      .then((jobs) => setHistory(jobs.filter((j) => j.job_type === "articles_all_sites")))
      .catch(() => {});
    api.getPublishSchedule(projectId)
      .then((s) => {
        setSchedule(s);
        setEnabled(s.enabled);
        setIntervalHours(s.interval_hours || 4);
      })
      .catch(() => {});
  }, [projectId]);

  const validCount = rows
    .map((r) => ({ image_url: r.image_url.trim(), recipe_text: r.recipe_text.trim() }))
    .filter((r) => r.image_url && r.recipe_text).length;

  const handleRun = async () => {
    const valid = rows
      .map((r) => ({ image_url: r.image_url.trim(), recipe_text: r.recipe_text.trim() }))
      .filter((r) => r.image_url && r.recipe_text);
    if (!valid.length) {
      alert("Add at least one recipe with image URL and recipe text.");
      return;
    }
    if (sites.length === 0) {
      alert("Add at least one site first.");
      return;
    }
    setLoading(true);
    try {
      const job = await api.startJob(projectId, {
        job_type: "articles_all_sites",
        shared_recipes: valid,
      });
      router.push(`/jobs/${job.id}`);
    } catch (e: any) {
      alert(e.message || "Failed to start all-sites generation job");
      setLoading(false);
    }
  };

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const s = await api.setPublishSchedule(projectId, { enabled, interval_hours: intervalHours });
      setSchedule(s);
    } catch (e: any) {
      alert(e?.message || "Failed to save publish schedule");
    } finally {
      setSavingSchedule(false);
    }
  };

  const startPublishingNow = async () => {
    setStartingPublish(true);
    try {
      const s = await api.startPublishScheduleNow(projectId);
      setSchedule(s);
      setEnabled(s.enabled);
      setIntervalHours(s.interval_hours || 4);
    } catch (e: any) {
      alert(e?.message || "Failed to start publishing queue");
    } finally {
      setStartingPublish(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => router.push(`/projects/${projectId}`)}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4"
      >
        <ArrowLeft size={16} /> Back to Project
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Generate Articles For All Sites</h1>
        <p className="text-sm text-gray-400 mt-1">
          One Midjourney generation per recipe input, reused across all sites.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Sites: {sites.length} · Valid recipe inputs: {validCount} · Planned article generations: {validCount * sites.length}
        </p>
      </div>

      <div className="card mb-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-2">Publishing Schedule</h2>
        <p className="text-xs text-gray-500 mb-3">
          Queue mode: the scheduler publishes one article every interval across all sites. Example: 12 articles = 12 intervals.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable scheduler
          </label>
          <label className="text-sm text-gray-300">
            Interval (hours)
            <input
              type="number"
              min={1}
              max={168}
              value={intervalHours}
              onChange={(e) => setIntervalHours(Number(e.target.value || 4))}
              className="input-field mt-1"
            />
          </label>
          <div className="flex md:justify-end gap-2 flex-wrap">
            <button onClick={saveSchedule} disabled={savingSchedule} className="btn-secondary flex items-center gap-2 w-full md:w-auto justify-center">
              <Save size={14} /> {savingSchedule ? "Saving..." : "Save Schedule"}
            </button>
            <button
              onClick={startPublishingNow}
              disabled={startingPublish}
              className="btn-primary flex items-center gap-2 w-full md:w-auto justify-center"
              title="Start queue immediately (publishes one article now, then continues by interval)"
            >
              <Send size={14} /> {startingPublish ? "Starting..." : "Start Publishing"}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {schedule?.next_run_at ? `Next run: ${new Date(schedule.next_run_at).toLocaleString()}` : "No next run scheduled"}
        </p>
        {schedule?.last_error && <p className="text-xs text-red-400 mt-1">Last scheduler message: {schedule.last_error}</p>}
      </div>

      <div className="card mb-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-2">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">No previous all-sites jobs yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((j) => (
              <div key={j.id} className="rounded border border-gray-700 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white">Job {j.id.slice(0, 8)} · {j.status}</p>
                  <p className="text-xs text-gray-400">{new Date(j.created_at).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => router.push(`/jobs/${j.id}`)} className="btn-secondary text-xs px-2 py-1">
                    Logs
                  </button>
                  {j.status !== "running" && (
                    <button onClick={() => router.push(`/jobs/${j.id}/results`)} className="btn-secondary text-xs px-2 py-1">
                      Results
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {rows.map((r, idx) => (
          <div key={idx} className="card border border-gray-700">
            <div className="text-xs text-gray-500 mb-2">Recipe Input #{idx + 1}</div>
            <div className="space-y-2">
              <input
                value={r.image_url}
                onChange={(e) => setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, image_url: e.target.value } : x)))}
                className="input-field"
                placeholder="Image URL"
              />
              <textarea
                value={r.recipe_text}
                onChange={(e) => setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, recipe_text: e.target.value } : x)))}
                className="input-field"
                placeholder="Recipe text/title"
                rows={4}
              />
            </div>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                className="mt-2 text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { image_url: "", recipe_text: "" }])}
          className="btn-secondary flex items-center gap-2"
        >
          <Plus size={16} /> Add Recipe Input
        </button>
        <button
          onClick={handleRun}
          disabled={loading}
          className="btn-primary flex items-center gap-2"
        >
          <Send size={16} /> {loading ? "Starting..." : "Run All Sites Job"}
        </button>
      </div>
    </div>
  );
}
