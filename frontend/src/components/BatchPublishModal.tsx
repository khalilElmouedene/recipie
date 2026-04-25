"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, PublishBatchRequest } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useJobActivity } from "@/contexts/JobActivityContext";

interface Props {
  projectId: string;
  data: PublishBatchRequest;
  onClose: (didPublish: boolean) => void;
}

function publishTitleFromRequest(data: PublishBatchRequest): string {
  if (data.recipe_id) return "Publishing one recipe to WordPress";
  if (data.recipe_ids) return `Publishing ${data.recipe_ids.length} recipe(s) to WordPress`;
  if (data.site_id) return "Publishing site recipes to WordPress";
  return "Publishing project recipes to WordPress";
}

export default function BatchPublishModal({ projectId, data, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { trackJob } = useJobActivity();
  const [jobId, setJobId] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    const start = async () => {
      try {
        const job = await api.publishBatchToWordPress(projectId, data);
        if (cancelled) return;
        setJobId(job.id);
        trackJob(job, {
          title: publishTitleFromRequest(data),
          sourceLabel: "Open the pipeline icon anytime to watch progress or jump to logs.",
          href: `/jobs/${job.id}`,
        });
        toast.success("Publish job added to the pipeline.");
        onClose(false);
      } catch (err: unknown) {
        if (cancelled) return;
        setFatalError(err instanceof Error ? err.message : "Batch publish failed");
      }
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [data, onClose, projectId, toast, trackJob]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Starting WordPress Publish</h3>
            <p className="text-[11px] text-gray-500 mt-1">
              The publish job will continue in the global pipeline so you can keep working.
            </p>
          </div>
          {fatalError && (
            <button onClick={() => onClose(false)} className="text-gray-500 hover:text-gray-300">
              <X size={18} />
            </button>
          )}
        </div>

        {fatalError ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-red-400 text-sm">
              <XCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{fatalError}</span>
            </div>
            <div className="flex justify-end">
              <button onClick={() => onClose(false)} className="btn-primary text-sm px-4 py-1.5">
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-blue-900/40 bg-blue-950/20 px-4 py-4">
            <div className="flex items-start gap-3">
              <Loader2 size={18} className="mt-0.5 flex-shrink-0 animate-spin text-blue-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-blue-100">
                  Sending publish task to the background pipeline...
                </p>
                <p className="mt-2 text-xs leading-5 text-blue-200/70">
                  {jobId
                    ? `Job ${jobId} is ready.`
                    : "You will be able to open the job logs from the bell icon in the top bar."}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => router.push(jobId ? `/jobs/${jobId}` : `/projects/${projectId}`)}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-800"
              >
                Open logs instead
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
