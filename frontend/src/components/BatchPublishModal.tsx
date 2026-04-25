"use client";

import { useEffect, useRef, useState } from "react";
import { X, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { api, PublishBatchRequest } from "@/lib/api";

interface Props {
  projectId: string;
  data: PublishBatchRequest;
  onClose: (didPublish: boolean) => void;
}

const POLL_MS = 1500;

export default function BatchPublishModal({ projectId, data, onClose }: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [done, setDone] = useState(0);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    const clearPoll = () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };

    const scheduleNext = (runner: () => Promise<void>) => {
      clearPoll();
      if (cancelled) return;
      pollRef.current = setTimeout(() => {
        void runner();
      }, POLL_MS);
    };

    const syncJob = async (id: string): Promise<void> => {
      try {
        const [job, summary] = await Promise.all([
          api.getJob(id),
          api.getJobPublishSummary(id),
        ]);
        if (cancelled) return;

        setTotal(summary.total ?? job.total_rows ?? null);
        setDone(summary.processed ?? job.current_row ?? 0);
        setSucceeded(summary.succeeded);
        setFailed(summary.failed);

        const terminal = job.status === "completed" || job.status === "failed" || job.status === "stopped";
        if (terminal) {
          setFinished(true);
          const nextErrors: string[] = [];
          if (job.error) nextErrors.push(job.error);
          if (summary.failed > 0 && !job.error) {
            nextErrors.push(`${summary.failed} recipe(s) failed to publish. Open the job page for detailed logs.`);
          }
          setErrors(nextErrors);
          clearPoll();
          return;
        }

        scheduleNext(() => syncJob(id));
      } catch (err: unknown) {
        if (cancelled) return;
        setFatalError(err instanceof Error ? err.message : "Failed to refresh publish progress");
        setFinished(true);
        clearPoll();
      }
    };

    const start = async () => {
      try {
        const job = await api.publishBatchToWordPress(projectId, data);
        if (cancelled) return;
        setJobId(job.id);
        setTotal(job.total_rows ?? null);
        setDone(job.current_row ?? 0);
        await syncJob(job.id);
      } catch (err: unknown) {
        if (cancelled) return;
        setFatalError(err instanceof Error ? err.message : "Batch publish failed");
        setFinished(true);
      }
    };

    void start();

    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [projectId, data]);

  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Publishing to WordPress</h3>
            {jobId && <p className="text-[11px] text-gray-500 mt-1">Job: {jobId}</p>}
          </div>
          {finished && (
            <button onClick={() => onClose(succeeded > 0)} className="text-gray-500 hover:text-gray-300">
              <X size={18} />
            </button>
          )}
        </div>

        {fatalError ? (
          <div className="flex items-start gap-2 text-red-400 text-sm">
            <XCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{fatalError}</span>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>{total === null ? "Starting..." : `${done} / ${total}`}</span>
                <span>{percent}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1 text-green-400">
                <CheckCircle size={14} /> {succeeded} succeeded
              </span>
              {failed > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <XCircle size={14} /> {failed} failed
                </span>
              )}
            </div>

            {finished && errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1">
                <p className="text-xs font-medium text-red-400">Notes:</p>
                {errors.map((entry, i) => (
                  <p key={i} className="text-xs text-red-300">{entry}</p>
                ))}
              </div>
            )}

            {finished && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-sm text-gray-300">
                  {errors.length === 0
                    ? `Finished: ${succeeded} recipe(s) published successfully.`
                    : `Finished: ${succeeded} published, ${failed} failed.`}
                </p>
                <button onClick={() => onClose(succeeded > 0)} className="btn-primary text-sm px-4 py-1.5">
                  Close
                </button>
              </div>
            )}

            {!finished && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" /> Running in the background. This modal can stay open while the job continues safely.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
