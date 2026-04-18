"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, CalendarClock, History, Trash2 } from "lucide-react";
import { api, GeneratedJobRecipeOut, JobOut, PublishScheduleOut, PublishBatchRequest } from "@/lib/api";
import { getUserRole } from "@/lib/auth";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";
import BatchPublishModal from "@/components/BatchPublishModal";

export default function JobResultsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const role = getUserRole();
  const toast = useToast();
  const openConfirm = useConfirm();
  const canAdmin = role === "owner" || role === "admin";
  const [job, setJob] = useState<JobOut | null>(null);
  const [recipes, setRecipes] = useState<GeneratedJobRecipeOut[]>([]);
  const [schedule, setSchedule] = useState<PublishScheduleOut | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(240);
  const [deletingPublished, setDeletingPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchPublishing, setBatchPublishing] = useState<null | "wordpress_scheduled" | "manual_backdate">(null);
  const [batchModalData, setBatchModalData] = useState<PublishBatchRequest | null>(null);

  useEffect(() => {
    api.getJob(id).then(setJob).catch(() => router.push("/"));
    api.getJobGeneratedRecipes(id).then(setRecipes).catch(() => {});
  }, [id, router]);

  useEffect(() => {
    if (!job?.project_id) return;
    api.getPublishSchedule(job.project_id)
      .then((s) => {
        setSchedule(s);
        setEnabled(s.enabled);
        setIntervalMinutes(s.interval_minutes || 240);
      })
      .catch(() => {});
  }, [job?.project_id]);

  const grouped = useMemo(() => {
    const map = new Map<string, GeneratedJobRecipeOut[]>();
    for (const r of recipes) {
      const arr = map.get(r.site_domain) || [];
      arr.push(r);
      map.set(r.site_domain, arr);
    }
    return Array.from(map.entries());
  }, [recipes]);

  const onSaveSchedule = async () => {
    if (!job?.project_id) return;
    setSaving(true);
    setError(null);
    try {
      const s = await api.setPublishSchedule(job.project_id, {
        enabled,
        interval_minutes: intervalMinutes,
        image_retention_days: 7,
      });
      setSchedule(s);
    } catch (e: any) {
      setError(e?.message || "Failed to save publish schedule");
    } finally {
      setSaving(false);
    }
  };

  const deletePublishedNow = async () => {
    if (!job?.project_id) return;
    if (!await openConfirm({ message: "Delete ALL published recipes and their images from server? This cannot be undone.", danger: true, confirmLabel: "Delete All" })) return;
    setDeletingPublished(true);
    try {
      const res = await api.runProjectImageCleanup(job.project_id, { delete_all_published: true });
      toast.success(`Deleted: ${res.recipes_deleted} recipes, ${res.files_deleted} image files removed.`);
      const list = await api.getJobGeneratedRecipes(id);
      setRecipes(list);
    } catch (e: any) {
      setError(e?.message || "Failed to delete published recipes.");
    } finally {
      setDeletingPublished(false);
    }
  };

  const hasGenerated = recipes.some((r) => r.status === "generated");
  const canBatch = canAdmin && !!job?.project_id && hasGenerated && !batchPublishing;

  const runBatch = (mode: "wordpress_scheduled" | "manual_backdate") => {
    if (!job?.project_id) return;
    setBatchPublishing(mode);
    setBatchModalData({ mode });
  };

  const handleBatchModalClose = async (didPublish: boolean) => {
    setBatchModalData(null);
    setBatchPublishing(null);
    if (didPublish) {
      const list = await api.getJobGeneratedRecipes(id);
      setRecipes(list);
    }
  };

  return (
    <div>
      {batchModalData && job?.project_id && (
        <BatchPublishModal
          projectId={job.project_id}
          data={batchModalData}
          onClose={handleBatchModalClose}
        />
      )}
      <button onClick={() => router.push(`/jobs/${id}`)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4">
        <ArrowLeft size={16} /> Back to Job
      </button>

      <div className="card mb-4">
        <h1 className="text-2xl font-bold text-white">All-Sites Generated Recipes</h1>
        <p className="text-sm text-gray-400 mt-1">
          Here are the recipes created from your input list. You can also configure automatic publishing to WordPress.
        </p>
      </div>

      <div className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Auto Publish Settings</h2>
          <button onClick={onSaveSchedule} disabled={saving} className="btn-primary flex items-center gap-2">
            <Save size={14} /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable scheduler
          </label>
          <label className="text-sm text-gray-300">
            Interval (minutes)
            <input
              type="number"
              min={1}
              max={10080}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value || 240))}
              className="input-field mt-1"
            />
          </label>
          <div className="flex flex-col gap-2 self-end">
            <div className="text-xs text-gray-400">
              {schedule?.next_run_at ? `Next run: ${new Date(schedule.next_run_at).toLocaleString()}` : "No next run scheduled"}
            </div>
            {canAdmin && (
              <button
                onClick={deletePublishedNow}
                disabled={deletingPublished}
                className="btn-secondary flex items-center gap-2 justify-center border-red-700/50 text-red-300 text-sm"
                title="Delete all published recipes and their images from server"
              >
                <Trash2 size={14} /> {deletingPublished ? "Deleting..." : "Delete Published Now"}
              </button>
            )}
          </div>
        </div>
        {schedule?.last_error && <p className="text-xs text-red-400 mt-2">Last scheduler message: {schedule.last_error}</p>}
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>

      {canAdmin && job?.project_id && (
        <div className="card mb-4">
          <h2 className="text-lg font-semibold text-white mb-2">Publish to WordPress (batch)</h2>
          <p className="text-xs text-gray-500 mb-3">
            Same as on the All Sites Generate page: schedule staggered future posts in WordPress using your saved interval,
            or publish all now with random backdates (last 6 months). Save the schedule above first so the interval is stored.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canBatch}
              onClick={() => void runBatch("wordpress_scheduled")}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <CalendarClock size={14} />{" "}
              {batchPublishing === "wordpress_scheduled" ? "Working…" : "Schedule on WordPress"}
            </button>
            <button
              type="button"
              disabled={!canBatch}
              onClick={() => void runBatch("manual_backdate")}
              className="btn-secondary flex items-center gap-2 text-sm border-orange-800/50 text-orange-200"
            >
              <History size={14} /> {batchPublishing === "manual_backdate" ? "Working…" : "Manual (backdated)"}
            </button>
          </div>
          {!hasGenerated && (
            <p className="text-xs text-amber-400 mt-2">No generated recipes left to publish in this job.</p>
          )}
        </div>
      )}

      <div className="space-y-4">
        {grouped.length === 0 && (
          <div className="card text-sm text-gray-400">No generated recipes were linked to this job yet.</div>
        )}
        {grouped.map(([domain, items]) => (
          <div key={domain} className="card">
            <h3 className="text-sm font-semibold text-brand-300 mb-2">{domain}</h3>
            <div className="space-y-2">
              {items.map((r) => (
                <div key={r.id} className="rounded border border-gray-700 p-3">
                  <div className="text-sm text-white">{r.recipe_text.split("\n")[0]}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Status: {r.status} · Created: {new Date(r.created_at).toLocaleString()}
                  </div>
                  {r.wp_permalink && (
                    <a href={r.wp_permalink} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                      Open Published Article
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
