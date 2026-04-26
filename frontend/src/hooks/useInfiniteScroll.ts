import { useEffect, useRef, useCallback, useState } from "react";

/**
 * Attaches an IntersectionObserver to a sentinel element.
 * Calls `onLoadMore` when the sentinel enters the viewport,
 * but only when `hasMore` is true AND `loading` is false.
 * Uses a stable ref for the callback to avoid observer restarts on every render.
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  { hasMore, loading }: { hasMore: boolean; loading: boolean },
  rootMargin = "300px",
) {
  const [sentinelNode, setSentinelNode] = useState<HTMLDivElement | null>(null);
  const callbackRef = useRef(onLoadMore);
  useEffect(() => { callbackRef.current = onLoadMore; }, [onLoadMore]);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    setSentinelNode(node);
  }, []);

  useEffect(() => {
    if (!sentinelNode || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) callbackRef.current();
      },
      { rootMargin },
    );

    observer.observe(sentinelNode);
    return () => observer.disconnect();
    // Re-attach when hasMore/loading changes so we stop observing when done
  }, [sentinelNode, hasMore, loading, rootMargin]);

  return sentinelRef;
}
