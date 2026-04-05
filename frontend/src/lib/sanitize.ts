/**
 * HTML sanitizer using DOMPurify.
 * Replaces the previous regex-based approach which was bypassed by SVG, encoded
 * characters, and creative attribute combinations.
 *
 * On the server (SSR) we use isomorphic-dompurify which bundles JSDOM.
 * On the client, DOMPurify uses the browser DOM directly.
 */

import DOMPurify from "isomorphic-dompurify";

// Allow standard formatting tags used in AI-generated article HTML.
// Explicitly forbid anything that can execute code or fetch resources.
const PURIFY_CONFIG: DOMPurify.Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "base", "link", "meta"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange",
                "onsubmit", "onkeydown", "onkeyup", "onkeypress"],
  ALLOW_DATA_ATTR: false,
};

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as string;
}
