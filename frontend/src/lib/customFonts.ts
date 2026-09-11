import type { CustomFontDefinition } from "@/lib/api";

const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"];
const uploadedFontRegistry = new Map<string, CustomFontDefinition>();

function registryKey(family: string): string {
  return family.trim().toLowerCase();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read font file."));
    };
    reader.onerror = () => reject(new Error("Could not read font file."));
    reader.readAsDataURL(file);
  });
}

export function setUploadedFontDefinitions(fonts: CustomFontDefinition[]): void {
  uploadedFontRegistry.clear();
  fonts.forEach((font) => {
    if (font.source === "upload" && font.family?.trim() && font.dataUrl?.startsWith("data:")) {
      uploadedFontRegistry.set(registryKey(font.family), font);
    }
  });
}

export function findUploadedFont(family: string): CustomFontDefinition | undefined {
  return uploadedFontRegistry.get(registryKey(family));
}

export function getFontFamilyFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, "");
  return withoutExtension.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Uploaded Font";
}

export function isSupportedFontFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return FONT_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

export async function loadUploadedFont(font: CustomFontDefinition): Promise<void> {
  if (typeof document === "undefined") return;
  const family = font.family.trim();
  const dataUrl = font.dataUrl || "";
  if (!family || !dataUrl.startsWith("data:")) return;

  if ("fonts" in document && typeof FontFace !== "undefined") {
    try {
      const existing = Array.from(document.fonts).some((face) => face.family.replace(/^["']|["']$/g, "") === family);
      if (!existing) {
        const face = new FontFace(family, `url(${dataUrl})`);
        await face.load();
        document.fonts.add(face);
      }
      await document.fonts.load(`400 16px "${family}"`).catch(() => {});
      return;
    } catch {
      // Fall back to a stylesheet rule below.
    }
  }

  const styleId = `uploaded-font-${family.replace(/[^a-z0-9_-]/gi, "_")}`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `@font-face{font-family:"${family.replace(/"/g, '\\"')}";src:url("${dataUrl}")}`;
    document.head.appendChild(style);
  }
}

export async function loadUploadedFontDefinitions(fonts: CustomFontDefinition[]): Promise<string[]> {
  const uploadFonts = fonts.filter((font) => font.source === "upload" && font.dataUrl);
  setUploadedFontDefinitions(fonts);
  await Promise.all(uploadFonts.map(loadUploadedFont));
  return uploadFonts.map((font) => font.family);
}

export async function createUploadedFontDefinitionFromFile(file: File, familyName?: string): Promise<CustomFontDefinition> {
  if (!isSupportedFontFile(file)) {
    throw new Error("Choose a .ttf, .otf, .woff, or .woff2 font file.");
  }

  const family = (familyName || getFontFamilyFromFileName(file.name)).trim();
  const dataUrl = await fileToDataUrl(file);
  return { family, source: "upload", fileName: file.name, dataUrl };
}
