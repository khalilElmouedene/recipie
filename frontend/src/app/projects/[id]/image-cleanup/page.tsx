"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, Trash2, Play } from "lucide-react";
import { api, PublishScheduleOut, ImageCleanupRunResult } from "@/lib/api";

export default function ProjectImageCleanupPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();

  const [schedule, setSchedule] = useState<PublishScheduleOut | null>(null);
  const [retentionDays, setRetentionDays] = useState(4);
  const [publishedOnly, setPublishedOnly] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningRetention, setRunningRetention] = useState(false);
  const [runningDeleteAllPublished, setRunningDeleteAllPublished] = useState(false);
  const [result, setResult] = useState<ImageCleanupRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPublishSchedule(projectId)
      .then((s) => {
        setSchedule(s);
        setRetentionDays(s.image_retention_days || 4);
      })
      .catch(() => {});
  }, [projectId]);

  const saveRetention = async () => {
    if (!schedule) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setPublishSchedule(projectId, {
        enabled: schedule.enabled,
        interval_minutes: schedule.interval_minutes || 240,
        image_retention_days: retentionDays,
      });
      setSchedule(updated);
    } catch (e: any) {
      setError(e?.message || "Failed to save retention settings.");
    } finally {
      setSaving(false);
    }
  };

  const runRetentionCleanupNow = async () => {
    setRunningRetention(true);
    setError(null);
    try {
      const out = await api.runProjectImageCleanup(projectId, {
        delete_all_published: false,
        published_only: publishedOnly,
        retention_days: retentionDays,
      });
      setResult(out);
    } catch (e: any) {
      setError(e?.message || "Failed to run retention cleanup.");
    } finally {
      setRunningRetention(false);
    }
  };

  const runDeleteAllPublishedNow = async () => {
    if (!confirm("Delete generated images for ALL published recipes now? This cannot be undone.")) return;
    setRunningDeleteAllPublished(true);
    setError(null);
    try {
      const out = await api.runProjectImageCleanup(projectId, {
        delete_all_published: true,
      });
      setResult(out);
    } catch (e: any) {
      setError(e?.message || "Failed to delete all published recipe images.");
    } finally {
      setRunningDeleteAllPublished(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => router.push(`/projects/${projectId}/sites/all-sites-generate`)}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4"
      >
        <ArrowLeft size={16} /> Back to All Sites Generate
      </button>

      <div className="card mb-5">
        <h1 className="text-2xl font-bold text-white">Image Cleanup Controls</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage generated recipe image deletion with manual actions and scheduled retention.
        </p>
      </div>

      <div className="card mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Scheduled Retention</h2>
          <button
            onClick={saveRetention}
            disabled={saving || !schedule}
            className="btn-secondary flex items-center gap-2"
          >
            <Save size={14} /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Scheduler runs hourly in background and deletes cached generated images older than retention days.
        </p>
        <label className="text-sm text-gray-300 block max-w-xs">
          Delete generated images after (days)
          <input
            type="number"
            min={1}
            max={3650}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value || 4))}
            className="input-field mt-1"
          />
        </label>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-3">Run Cleanup Now</h2>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={publishedOnly}
              onChange={(e) => setPublishedOnly(e.target.checked)}
            />
            Retention cleanup scope: published recipes only
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={runRetentionCleanupNow}
              disabled={runningRetention}
              className="btn-primary flex items-center gap-2"
            >
              <Play size={14} /> {runningRetention ? "Running..." : "Run Retention Cleanup Now"}
            </button>
            <button
              onClick={runDeleteAllPublishedNow}
              disabled={runningDeleteAllPublished}
              className="btn-secondary flex items-center gap-2 border-red-700/50 text-red-300"
            >
              <Trash2 size={14} /> {runningDeleteAllPublished ? "Deleting..." : "Delete ALL Published Images Now"}
            </button>
          </div>

          {result && (
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 text-sm text-gray-300">
              <p>Mode: <span className="font-mono text-gray-200">{result.mode}</span></p>
              <p>Recipes updated: <span className="text-brand-300">{result.recipes_updated}</span></p>
              <p>Files deleted: <span className="text-brand-300">{result.files_deleted}</span></p>
            </div>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}

