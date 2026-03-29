/**
 * Injects the Pin Designer export into generated article HTML so it appears in WordPress
 * after publish. Wrapped in a figure with data-pin-display="optional" so the site owner
 * can hide it with CSS, e.g. .recipe-generator-pin-embed[data-pin-display="optional"] { display: none; }
 */

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Remove a previously injected pin block so re-saving replaces it. */
export function removeRecipeGeneratorPinEmbed(html: string): string {
  return html
    // Remove new WP block format (with block comments)
    .replace(
      /<!-- wp:image [^>]*recipe-generator-pin-embed[^>]*-->[\s\S]*?<!-- \/wp:image -->/gi,
      ""
    )
    // Remove old raw figure format (legacy)
    .replace(
      /<figure\b[^>]*\bdata-recipe-generator-pin-embed=["']1["'][^>]*>[\s\S]*?<\/figure>/gi,
      ""
    )
    .trim();
}

function buildPinFigureHtml(imageDataUrl: string, alt: string): string {
  const safeAlt = escapeHtmlAttr(alt);
  const blockAttrs = JSON.stringify({
    className: "recipe-generator-pin-embed",
    sizeSlug: "full",
    linkDestination: "none",
    align: "center",
  });
  return (
    `\n<!-- wp:image ${blockAttrs} -->\n` +
    `<figure class="wp-block-image size-full aligncenter recipe-generator-pin-embed" data-recipe-generator-pin-embed="1" data-pin-display="optional">` +
    `<img src="${imageDataUrl}" alt="${safeAlt}" loading="lazy" decoding="async" style="max-width:400px;height:auto;border-radius:8px;" />` +
    `</figure>\n` +
    `<!-- /wp:image -->\n`
  );
}

/** Insert snippet before WPRM shortcode/block, else before </body>, else append. */
function insertBeforeRecipeOrEnd(html: string, snippet: string): string {
  const lower = html.toLowerCase();
  const wprmShort = lower.indexOf("[wprm-recipe");
  const wprmBlock = lower.indexOf("<!-- wp:wp-recipe-maker");
  const wprmBlock2 = lower.indexOf("<!-- wp:wprm/");
  const candidates = [wprmShort, wprmBlock, wprmBlock2].filter((i) => i >= 0);
  if (candidates.length > 0) {
    const idx = Math.min(...candidates);
    return html.slice(0, idx) + snippet + html.slice(idx);
  }
  const bodyClose = lower.lastIndexOf("</body>");
  if (bodyClose >= 0) {
    return html.slice(0, bodyClose) + snippet + html.slice(bodyClose);
  }
  return html + snippet;
}

/**
 * Strips any old app pin embed, then adds the new image at the bottom of the article
 * body but before the recipe card (WPRM) when present.
 */
export function appendPinImageToArticleHtml(
  html: string | null | undefined,
  imageDataUrl: string,
  options?: { alt?: string }
): string {
  const cleaned = removeRecipeGeneratorPinEmbed((html ?? "").trim());
  const figure = buildPinFigureHtml(imageDataUrl, options?.alt ?? "Recipe pin");
  if (!cleaned) return figure.trim();
  return insertBeforeRecipeOrEnd(cleaned, figure).trim();
}
