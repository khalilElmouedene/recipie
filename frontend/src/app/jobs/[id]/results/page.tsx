"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { api, GeneratedJobRecipeOut, JobOut, PublishScheduleOut } from "@/lib/api";

export default function JobResultsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<JobOut | null>(null);
  const [recipes, setRecipes] = useState<GeneratedJobRecipeOut[]>([]);
  const [schedule, setSchedule] = useState<PublishScheduleOut | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(240);
  const [imageRetentionDays, setImageRetentionDays] = useState(4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setImageRetentionDays(s.image_retention_days || 4);
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
        image_retention_days: imageRetentionDays,
      });
      setSchedule(s);
    } catch (e: any) {
      setError(e?.message || "Failed to save publish schedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
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

            <div className="mt-3">
              Delete recipe images after (days)
              <input
                type="number"
                min={1}
                max={3650}
                value={imageRetentionDays}
                onChange={(e) => setImageRetentionDays(Number(e.target.value || 4))}
                className="input-field mt-1"
              />
            </div>
          </label>
          <div className="text-xs text-gray-400 self-end">
            {schedule?.next_run_at ? `Next run: ${new Date(schedule.next_run_at).toLocaleString()}` : "No next run scheduled"}
          </div>
        </div>
        {schedule?.last_error && <p className="text-xs text-red-400 mt-2">Last scheduler message: {schedule.last_error}</p>}
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>

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
