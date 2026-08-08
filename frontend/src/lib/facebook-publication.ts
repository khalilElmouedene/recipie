export type FacebookPublicationType = "video" | "image";

/**
 * Build the public Facebook URL for the object type that was actually
 * published. Page photo posts use a Page-scoped post URL, not a Reel URL.
 */
export function facebookPublicationUrl(
  postType: FacebookPublicationType,
  postId: string,
) {
  const normalizedId = postId.trim();
  if (postType === "video") {
    return `https://www.facebook.com/reel/${encodeURIComponent(normalizedId)}`;
  }

  const separator = normalizedId.indexOf("_");
  if (separator > 0 && separator < normalizedId.length - 1) {
    const pageId = normalizedId.slice(0, separator);
    const pagePostId = normalizedId.slice(separator + 1);
    return `https://www.facebook.com/${encodeURIComponent(pageId)}/posts/${encodeURIComponent(pagePostId)}`;
  }

  // Meta can return only the photo object ID on some Graph API versions.
  return `https://www.facebook.com/photo.php?fbid=${encodeURIComponent(normalizedId)}`;
}

