export interface PinterestWorksheetRecipe {
  siteId: string;
  pinTitle: string | null;
  recipeText: string;
  pinDesignImage: string | null;
  pinBoard: string | null;
  pinDescription: string | null;
  wpPermalink: string | null;
  pinTags: string | null;
}

export const PINTEREST_WORKSHEET_INIT_KEY = "pinterestWorksheet.init.v1";
export const PINTEREST_WORKSHEET_STORAGE_KEY = "pinterestWorksheet.saved.v1";

export interface PinterestWorksheetSnapshot {
  header: string[];
  rows: string[][];
  generatedAt: string;
  startDate: string;
  intervalMinutes: number;
}

export const PINTEREST_WORKSHEET_HEADER = [
  "Title",
  "Media URL",
  "Pinterest board",
  "Thumbnail",
  "Description",
  "Link",
  "Publish date",
  "Keywords",
];

function formatPublishDate(ts: number): string {
  const d = new Date(ts);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  const hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${day}/${year} ${hours}:${mins}`;
}

function buildTitle(recipe: PinterestWorksheetRecipe): string {
  if (recipe.pinTitle) return recipe.pinTitle;
  return recipe.recipeText.split("\n")[0]?.trim() || "";
}

export async function buildPinterestWorksheetRows(
  recipes: PinterestWorksheetRecipe[],
  startDate: string,
  intervalMinutes: number,
  resolveMediaUrl: (recipe: PinterestWorksheetRecipe) => Promise<string>,
): Promise<string[][]> {
  const startMs = new Date(startDate).getTime();
  const intervalMs = intervalMinutes * 60 * 1000;
  const rows: string[][] = [];

  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i];
    rows.push([
      buildTitle(recipe),
      await resolveMediaUrl(recipe),
      recipe.pinBoard || "",
      "",
      recipe.pinDescription || "",
      recipe.wpPermalink || "",
      formatPublishDate(startMs + i * intervalMs),
      recipe.pinTags || "",
    ]);
  }

  return rows;
}

export function rowsToCsv(header: string[], rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, "\"\"")}"`;
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}
