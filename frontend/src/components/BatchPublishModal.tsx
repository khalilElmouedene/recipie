"use client";
import { useEffect, useRef, useState } from "react";
import { X, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { api, BatchPublishEvent, PublishBatchRequest } from "@/lib/api";

interface Props {
  projectId: string;
  data: PublishBatchRequest;
  onClose: (didPublish: boolean) => void;
}

export default function BatchPublishModal({ projectId, data, onClose }: Props) {
  const [total, setTotal] = useState<number | null>(null);
  const [done, setDone] = useState(0);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [lastRecipe, setLastRecipe] = useState("");
  const [fatalError, setFatalError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const handleEvent = (e: BatchPublishEvent) => {
      if (e.type === "start") {
        setTotal(e.total);
      } else if (e.type === "progress") {
        setDone(e.done);
        setTotal(e.total);
        setSucceeded(e.succeeded);
        setFailed(e.failed);
        setLastRecipe(e.recipe_name);
      } else if (e.type === "done") {
        setTotal(e.total);
        setSucceeded(e.succeeded);
        setFailed(e.failed);
        setErrors(e.errors);
        setDone(e.total);
        setFinished(true);
      }
    };

    api.publishBatchStream(projectId, data, handleEvent).catch((err: unknown) => {
      setFatalError(err instanceof Error ? err.message : "Batch publish failed");
      setFinished(true);
    });
  }, [projectId, data]);

  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Publishing to WordPress</h3>
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
            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>{total === null ? "Starting…" : `${done} / ${total}`}</span>
                <span>{percent}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            {/* Counters */}
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

            {/* Current recipe */}
            {!finished && lastRecipe && (
              <p className="text-xs text-gray-400 truncate flex items-center gap-2">
                <Loader2 size={12} className="animate-spin flex-shrink-0" />
                {lastRecipe}
              </p>
            )}

            {/* Error list */}
            {finished && errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1">
                <p className="text-xs font-medium text-red-400">Errors:</p>
                {errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-300 truncate">{e}</p>
                ))}
              </div>
            )}

            {/* Done state */}
            {finished && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-sm text-gray-300">
                  {fatalError ? "" : errors.length === 0
                    ? `All ${succeeded} recipes published successfully!`
                    : `Finished: ${succeeded} published, ${failed} failed.`}
                </p>
                <button onClick={() => onClose(succeeded > 0)} className="btn-primary text-sm px-4 py-1.5">
                  Close
                </button>
              </div>
            )}

            {/* Spinner while running */}
            {!finished && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" /> Do not close this window while publishing…
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
