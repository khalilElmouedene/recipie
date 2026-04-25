"use client";
import { Loader2 } from "lucide-react";

interface Props {
  sentinelRef: React.Ref<HTMLDivElement>;
  loading: boolean;
  hasMore: boolean;
  /** Text shown next to the spinner while loading. */
  loadingText?: string;
  /** Optional text shown when all items are loaded. */
  endText?: string;
  className?: string;
}

/**
 * Drop this at the bottom of any paginated list.
 * Attach `sentinelRef` (from useInfiniteScroll) to it — the observer
 * fires when this element scrolls into view.
 */
export default function InfiniteScrollSentinel({
  sentinelRef,
  loading,
  hasMore,
  loadingText = "Chargement…",
  endText,
  className = "",
}: Props) {
  return (
    <div ref={sentinelRef} className={`flex justify-center py-4 ${className}`}>
      {loading && (
        <span className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={15} className="animate-spin" />
          {loadingText}
        </span>
      )}
      {!hasMore && !loading && endText && (
        <span className="text-xs text-gray-600">{endText}</span>
      )}
    </div>
  );
}
