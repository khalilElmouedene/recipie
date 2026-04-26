"use client";

const PINTEREST_GALLERY_CONTEXT_STORAGE_KEY = "pinterest_gallery_context_v1";
const CONTEXT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface PinterestGalleryContextSnapshot {
  id: string;
  source: "pin_designer";
  projectId?: string;
  siteId?: string;
  recipeIds: string[];
  createdAt: string;
}

function generateContextId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function storePinterestGalleryContext(
  input: Omit<PinterestGalleryContextSnapshot, "id" | "createdAt">,
): string | null {
  if (!canUseSessionStorage()) return null;

  const recipeIds = Array.from(
    new Set((input.recipeIds || []).map((value) => value.trim()).filter(Boolean)),
  );
  if (!recipeIds.length) return null;

  const snapshot: PinterestGalleryContextSnapshot = {
    ...input,
    recipeIds,
    id: generateContextId(),
    createdAt: new Date().toISOString(),
  };

  try {
    window.sessionStorage.setItem(
      PINTEREST_GALLERY_CONTEXT_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
    return snapshot.id;
  } catch {
    return null;
  }
}

export function readPinterestGalleryContext(
  id: string | null,
): PinterestGalleryContextSnapshot | null {
  if (!id || !canUseSessionStorage()) return null;

  try {
    const raw = window.sessionStorage.getItem(PINTEREST_GALLERY_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PinterestGalleryContextSnapshot>;
    if (parsed.id !== id || parsed.source !== "pin_designer") return null;
    if (!Array.isArray(parsed.recipeIds) || parsed.recipeIds.length === 0) return null;

    const createdAtMs = parsed.createdAt ? Date.parse(parsed.createdAt) : NaN;
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > CONTEXT_MAX_AGE_MS) {
      window.sessionStorage.removeItem(PINTEREST_GALLERY_CONTEXT_STORAGE_KEY);
      return null;
    }

    return {
      id: parsed.id,
      source: "pin_designer",
      projectId: parsed.projectId,
      siteId: parsed.siteId,
      recipeIds: parsed.recipeIds.map((value) => String(value)),
      createdAt: parsed.createdAt!,
    };
  } catch {
    return null;
  }
}
