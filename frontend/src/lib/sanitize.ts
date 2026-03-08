/**
 * Lightweight client-side HTML sanitizer.
 * Strips <script>, <iframe>, <object>, <embed>, <form> tags and all on* event
 * handler attributes and javascript: hrefs before rendering via dangerouslySetInnerHTML.
 *
 * This is intentionally minimal — it covers the main XSS vectors in AI-generated
 * article HTML without requiring a heavy library like DOMPurify.
 */

const FORBIDDEN_TAGS = /(<\/?(script|iframe|object|embed|form|base|link|meta|style)[^>]*>)/gi;
const EVENT_ATTRS = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
const JS_HREF = /(href|src|action)\s*=\s*["']?\s*javascript:[^"'\s>]*/gi;
const DATA_HREF = /(href|src)\s*=\s*["']?\s*data:[^"'\s>]*/gi;

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(FORBIDDEN_TAGS, "")
    .replace(EVENT_ATTRS, "")
    .replace(JS_HREF, "")
    .replace(DATA_HREF, "");
}
