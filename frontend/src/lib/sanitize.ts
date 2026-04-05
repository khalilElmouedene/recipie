/**
 * HTML sanitizer for AI-generated article preview (DOMPurify, SSR-safe).
 */
import DOMPurify from "isomorphic-dompurify";

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  });
}
