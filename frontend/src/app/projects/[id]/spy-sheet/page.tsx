"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Save, Download, Upload, Plus, Minus,
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  Palette, PaintBucket, Loader2, Check, Copy, Trash2, Pencil, Send,
  Globe,
} from "lucide-react";
import { api, SharedRecipeInput } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useJobActivity } from "@/contexts/JobActivityContext";

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_ROWS = 50;
const DEFAULT_COLS = 26;
const DEFAULT_COL_WIDTH = 120;
const MIN_COL_WIDTH = 60;
const COL_RESIZE_HITBOX = 10;
const DEFAULT_ROW_HEIGHT = 26;
const HEADER_WIDTH = 50;
const HEADER_HEIGHT = 26;
const FLOATING_CARD_WIDTH = 360;
const FLOATING_CARD_HEIGHT = 520;
const IMAGE_HEADER_HINTS = new Set([
  "image",
  "image_url",
  "imageurl",
  "img",
  "img_url",
  "photo",
  "photo_url",
  "picture",
  "picture_url",
  "source_image",
  "source_image_url",
  "url",
]);
const RECIPE_HEADER_HINTS = new Set([
  "recipe",
  "recipe_name",
  "recipe_text",
  "recipe_title",
  "text",
  "title",
  "content",
  "prompt",
]);

// ─── Types ────────────────────────────────────────────────────────────────────
interface Cell {
  v?: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  fg?: string;
  bg?: string;
  ha?: "l" | "c" | "r";
  fs?: number;
}

interface SheetData {
  cells: Record<string, Cell>;
  colWidths: Record<number, number>;
  rowHeights: Record<number, number>;
  rows: number;
  cols: number;
}

interface SheetTab {
  id: string;
  name: string;
  data: SheetData;
}

interface Workbook {
  sheets: SheetTab[];
  activeId: string;
}

interface Selection {
  row: number;
  col: number;
}

interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

type DragSelectionState =
  | { mode: "cells"; origin: Selection; additive: boolean; baseRanges: CellRange[] }
  | { mode: "rows"; originRow: number; additive: boolean; baseRanges: CellRange[] }
  | { mode: "cols"; originCol: number; additive: boolean; baseRanges: CellRange[] };

interface ColResizeState {
  col: number;
  startX: number;
  startWidth: number;
}

interface SheetCtxMenu {
  x: number;
  y: number;
  sheetId: string;
}

type SelectionGenerationPreview =
  | {
      ok: true;
      rangeLabel: string;
      items: SharedRecipeInput[];
      rowIndices: number[];
      sourceRows: number;
      skippedRows: number;
      imageCol: number;
      recipeCol: number;
      usedHeaderRow: boolean;
    }
  | {
      ok: false;
      rangeLabel: string;
      message: string;
    };

interface SelectionCtxMenu {
  x: number;
  y: number;
  preview: SelectionGenerationPreview;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const colLabel = (c: number): string => {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const cellKey = (r: number, c: number) => `${r}_${c}`;
const clampIndex = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const normalizeRange = (range: CellRange): CellRange => ({
  startRow: Math.min(range.startRow, range.endRow),
  startCol: Math.min(range.startCol, range.endCol),
  endRow: Math.max(range.startRow, range.endRow),
  endCol: Math.max(range.startCol, range.endCol),
});
const singleCellRange = (row: number, col: number): CellRange => ({
  startRow: row,
  startCol: col,
  endRow: row,
  endCol: col,
});
const buildRange = (a: Selection, b: Selection): CellRange =>
  normalizeRange({ startRow: a.row, startCol: a.col, endRow: b.row, endCol: b.col });
const isCellInRange = (row: number, col: number, range: CellRange): boolean => {
  const n = normalizeRange(range);
  return row >= n.startRow && row <= n.endRow && col >= n.startCol && col <= n.endCol;
};
const rangeToAddress = (range: CellRange): string => {
  const n = normalizeRange(range);
  const start = `${colLabel(n.startCol)}${n.startRow + 1}`;
  const end = `${colLabel(n.endCol)}${n.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
};

const emptySheetData = (): SheetData => ({
  cells: {},
  colWidths: {},
  rowHeights: {},
  rows: DEFAULT_ROWS,
  cols: DEFAULT_COLS,
});

const newTab = (name: string): SheetTab => ({ id: uid(), name, data: emptySheetData() });

const emptyWorkbook = (): Workbook => {
  const t = newTab("Sheet1");
  return { sheets: [t], activeId: t.id };
};

/** Migrate old single-sheet format → Workbook */
function parseStored(raw: string): Workbook {
  try {
    const parsed = JSON.parse(raw);
    // New format
    if (parsed.sheets && parsed.activeId) return parsed as Workbook;
    // Old format — wrap in workbook
    if (parsed.cells !== undefined) {
      const t: SheetTab = { id: uid(), name: "Sheet1", data: parsed as SheetData };
      return { sheets: [t], activeId: t.id };
    }
  } catch {}
  return emptyWorkbook();
}

function sheetDataToCsv(sheet: SheetData): string {
  const keys = Object.keys(sheet.cells).filter((k) => (sheet.cells[k]?.v ?? "") !== "");
  let maxRow = 0;
  let maxCol = 0;
  keys.forEach((k) => {
    const [rStr, cStr] = k.split("_");
    const r = Number(rStr);
    const c = Number(cStr);
    if (!Number.isNaN(r)) maxRow = Math.max(maxRow, r);
    if (!Number.isNaN(c)) maxCol = Math.max(maxCol, c);
  });

  const rowCount = Math.max(1, maxRow + 1);
  const colCount = Math.max(1, maxCol + 1);
  const escape = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

  const lines: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const rowValues: string[] = [];
    for (let c = 0; c < colCount; c++) {
      rowValues.push(sheet.cells[cellKey(r, c)]?.v ?? "");
    }
    lines.push(rowValues.map(escape).join(","));
  }
  return lines.join("\r\n");
}

function csvToRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (inQuotes) {
      if (ch === "\"") {
        if (source[i + 1] === "\"") {
          current += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(current);
      current = "";
      continue;
    }
    if (ch === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }
    if (ch === "\r") continue;

    current += ch;
  }

  row.push(current);
  rows.push(row);

  while (rows.length > 1 && rows[rows.length - 1].every((v) => v === "")) {
    rows.pop();
  }
  return rows;
}

function rowsToSheetData(rows2d: string[][]): SheetData {
  const safeRows = rows2d.length > 0 ? rows2d : [[""]];
  const maxCols = Math.max(...safeRows.map((r) => r.length), 1);
  const data = emptySheetData();
  data.rows = Math.max(DEFAULT_ROWS, safeRows.length);
  data.cols = Math.max(DEFAULT_COLS, maxCols);
  safeRows.forEach((row, r) => {
    row.forEach((val, c) => {
      if (val !== "") data.cells[cellKey(r, c)] = { v: val };
    });
  });
  return data;
}

const normalizeHeaderText = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const isLikelyImageValue = (value: string): boolean => {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return (
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("/uploads/") ||
    /^data:image\//.test(v) ||
    /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/.test(v)
  );
};

const scoreImageColumn = (values: string[]): number =>
  values.reduce((sum, value) => {
    const v = value.trim();
    if (!v) return sum;
    if (isLikelyImageValue(v)) return sum + 3;
    if (v.includes("/")) return sum + 1;
    return sum;
  }, 0);

const scoreRecipeColumn = (values: string[]): number =>
  values.reduce((sum, value) => {
    const v = value.trim();
    if (!v) return sum;
    if (isLikelyImageValue(v)) return sum;
    if (v.length >= 20) return sum + 3;
    if (v.includes(" ")) return sum + 2;
    return sum + 1;
  }, 0);

function clampFloatingCardPosition(x: number, y: number) {
  if (typeof window === "undefined") return { x, y };
  const clampedX = Math.max(12, Math.min(x, window.innerWidth - FLOATING_CARD_WIDTH - 12));
  // Prefer rendering below the cursor; flip above when there isn't enough room.
  const fitsBelow = y + FLOATING_CARD_HEIGHT + 12 <= window.innerHeight;
  const clampedY = fitsBelow
    ? y
    : Math.max(12, y - FLOATING_CARD_HEIGHT);
  return { x: clampedX, y: clampedY };
}

function buildSelectionGenerationPreview(sheet: SheetData, range: CellRange): SelectionGenerationPreview {
  const normalized = normalizeRange(range);
  const rangeLabel = rangeToAddress(normalized);
  const width = normalized.endCol - normalized.startCol + 1;

  if (width < 2) {
    return {
      ok: false,
      rangeLabel,
      message: "Select at least two columns so Spy Sheet can map image_url and recipe_text.",
    };
  }

  const selectedRows = Array.from({ length: normalized.endRow - normalized.startRow + 1 }, (_, rowOffset) => {
    const row = normalized.startRow + rowOffset;
    const values = Array.from({ length: width }, (_, colOffset) => {
      const col = normalized.startCol + colOffset;
      return sheet.cells[cellKey(row, col)]?.v?.trim() ?? "";
    });
    return { row, values };
  }).filter((entry) => entry.values.some(Boolean));

  if (!selectedRows.length) {
    return {
      ok: false,
      rangeLabel,
      message: "The selected range is empty. Pick rows that contain image URLs and recipe text first.",
    };
  }

  const headerValues = selectedRows[0].values.map(normalizeHeaderText);
  const imageHeaderIndex = headerValues.findIndex((value) => IMAGE_HEADER_HINTS.has(value));
  const recipeHeaderIndex = headerValues.findIndex((value) => RECIPE_HEADER_HINTS.has(value));

  let imageIndex = -1;
  let recipeIndex = -1;
  let usedHeaderRow = false;
  let dataRows = selectedRows;

  if (imageHeaderIndex !== -1 && recipeHeaderIndex !== -1 && imageHeaderIndex !== recipeHeaderIndex) {
    imageIndex = imageHeaderIndex;
    recipeIndex = recipeHeaderIndex;
    usedHeaderRow = true;
    dataRows = selectedRows.slice(1);
  } else if (width === 2) {
    const firstColumnValues = selectedRows.map((entry) => entry.values[0] ?? "");
    const secondColumnValues = selectedRows.map((entry) => entry.values[1] ?? "");
    const firstImageScore = scoreImageColumn(firstColumnValues);
    const secondImageScore = scoreImageColumn(secondColumnValues);

    if (secondImageScore > firstImageScore) {
      imageIndex = 1;
      recipeIndex = 0;
    } else if (firstImageScore > secondImageScore) {
      imageIndex = 0;
      recipeIndex = 1;
    } else {
      const firstRecipeScore = scoreRecipeColumn(firstColumnValues);
      const secondRecipeScore = scoreRecipeColumn(secondColumnValues);
      if (firstRecipeScore > secondRecipeScore) {
        imageIndex = 1;
        recipeIndex = 0;
      } else {
        imageIndex = 0;
        recipeIndex = 1;
      }
    }
  } else {
    return {
      ok: false,
      rangeLabel,
      message:
        "Select exactly two columns, or include header names like image_url and recipe_text in the selected block.",
    };
  }

  if (!dataRows.length) {
    return {
      ok: false,
      rangeLabel,
      message: "I found the column mapping, but there are no data rows under that selection yet.",
    };
  }

  let skippedRows = 0;
  const items: SharedRecipeInput[] = [];
  const rowIndices: number[] = [];
  dataRows.forEach(({ row, values }) => {
    const image_url = values[imageIndex]?.trim() ?? "";
    const recipe_text = values[recipeIndex]?.trim() ?? "";
    if (image_url && recipe_text) {
      items.push({ image_url, recipe_text });
      rowIndices.push(row);
      return;
    }
    if (values.some(Boolean)) skippedRows += 1;
  });

  if (!items.length) {
    return {
      ok: false,
      rangeLabel,
      message: "No valid rows were found. Each selected row needs both an image URL and recipe text.",
    };
  }

  return {
    ok: true,
    rangeLabel,
    items,
    rowIndices,
    sourceRows: dataRows.length,
    skippedRows,
    imageCol: normalized.startCol + imageIndex,
    recipeCol: normalized.startCol + recipeIndex,
    usedHeaderRow,
  };
}

function deleteSheetRows(data: SheetData, rowIndicesToDelete: number[]): SheetData {
  if (!rowIndicesToDelete.length) return data;
  const toDelete = new Set(rowIndicesToDelete);
  const sortedDeletes = [...rowIndicesToDelete].sort((a, b) => a - b);
  const nextCells: SheetData["cells"] = {};
  for (const [key, cell] of Object.entries(data.cells)) {
    const under = key.lastIndexOf("_");
    const r = parseInt(key.slice(0, under), 10);
    const c = parseInt(key.slice(under + 1), 10);
    if (toDelete.has(r)) continue;
    const shift = sortedDeletes.filter((dr) => dr < r).length;
    nextCells[cellKey(r - shift, c)] = cell;
  }
  return { ...data, cells: nextCells };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SpySheetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { trackJob } = useJobActivity();

  const [workbook, setWorkbook] = useState<Workbook>(emptyWorkbook());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({ row: 0, col: 0 });
  const [selectionAnchor, setSelectionAnchor] = useState<Selection>({ row: 0, col: 0 });
  const [selectionRanges, setSelectionRanges] = useState<CellRange[]>([singleCellRange(0, 0)]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [formulaVal, setFormulaVal] = useState("");

  // Sheet tab rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Context menu
  const [tabCtxMenu, setTabCtxMenu] = useState<SheetCtxMenu | null>(null);
  const [selectionCtxMenu, setSelectionCtxMenu] = useState<SelectionCtxMenu | null>(null);
  const [startingGeneration, setStartingGeneration] = useState(false);
  const [deleteAfterGeneration, setDeleteAfterGeneration] = useState(false);
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scraping, setScraping] = useState(false);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const selectionRangesRef = useRef<CellRange[]>([singleCellRange(0, 0)]);
  const dragSelectionRef = useRef<DragSelectionState | null>(null);
  const colResizeRef = useRef<ColResizeState | null>(null);
  const clipboardFallbackRef = useRef("");

  // ── Active sheet ──
  const activeSheet = workbook.sheets.find((s) => s.id === workbook.activeId)
    ?? workbook.sheets[0];
  const sheetRows = activeSheet?.data.rows ?? DEFAULT_ROWS;
  const sheetCols = activeSheet?.data.cols ?? DEFAULT_COLS;
  const sheet = activeSheet?.data ?? emptySheetData();

  const clampToSheet = useCallback((row: number, col: number): Selection => ({
    row: clampIndex(row, 0, sheetRows - 1),
    col: clampIndex(col, 0, sheetCols - 1),
  }), [sheetRows, sheetCols]);

  const setSingleSelection = useCallback((row: number, col: number) => {
    const bounded = clampToSheet(row, col);
    setSel(bounded);
    setSelectionAnchor(bounded);
    setSelectionRanges([singleCellRange(bounded.row, bounded.col)]);
  }, [clampToSheet]);

  const selectedCellsFromRanges = useCallback((ranges: CellRange[]): Selection[] => {
    const seen = new Set<string>();
    const out: Selection[] = [];
    ranges.forEach((range) => {
      const n = normalizeRange(range);
      const startRow = clampIndex(n.startRow, 0, sheetRows - 1);
      const endRow = clampIndex(n.endRow, 0, sheetRows - 1);
      const startCol = clampIndex(n.startCol, 0, sheetCols - 1);
      const endCol = clampIndex(n.endCol, 0, sheetCols - 1);
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const key = cellKey(r, c);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ row: r, col: c });
        }
      }
    });
    return out;
  }, [sheetRows, sheetCols]);

  // ── Load ──
  useEffect(() => {
    api.getSpySheet(id)
      .then((res) => {
        if (res.data) setWorkbook(parseStored(res.data));
        if (res.updated_at) setSavedAt(res.updated_at);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // ── Formula bar sync ──
  useEffect(() => {
    if (editKey === null) {
      const cell = activeSheet?.data.cells[cellKey(sel.row, sel.col)];
      setFormulaVal(cell?.v ?? "");
    }
  }, [sel, workbook, editKey, activeSheet]);

  useEffect(() => {
    selectionRangesRef.current = selectionRanges;
  }, [selectionRanges]);

  // ── Close context menu on outside click ──
  useEffect(() => {
    if (!tabCtxMenu && !selectionCtxMenu) return;
    const close = () => {
      setTabCtxMenu(null);
      setSelectionCtxMenu(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [tabCtxMenu, selectionCtxMenu]);

  useEffect(() => {
    const stopDragSelection = () => { dragSelectionRef.current = null; };
    window.addEventListener("mouseup", stopDragSelection);
    window.addEventListener("touchend", stopDragSelection);
    return () => {
      window.removeEventListener("mouseup", stopDragSelection);
      window.removeEventListener("touchend", stopDragSelection);
    };
  }, []);

  // ── Auto-scroll during drag selection ──
  useEffect(() => {
    const ZONE = 60;
    const MAX_SPEED = 18;
    let rafId: number | null = null;
    let mouseX = 0;
    let mouseY = 0;

    const scroll = () => {
      if (!dragSelectionRef.current && !colResizeRef.current) { rafId = null; return; }
      const el = gridRef.current;
      if (!el) { rafId = null; return; }
      const rect = el.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (mouseY < rect.top + ZONE) dy = -MAX_SPEED * ((rect.top + ZONE - mouseY) / ZONE);
      else if (mouseY > rect.bottom - ZONE) dy = MAX_SPEED * ((mouseY - (rect.bottom - ZONE)) / ZONE);
      if (mouseX < rect.left + ZONE) dx = -MAX_SPEED * ((rect.left + ZONE - mouseX) / ZONE);
      else if (mouseX > rect.right - ZONE) dx = MAX_SPEED * ((mouseX - (rect.right - ZONE)) / ZONE);
      if (dx !== 0 || dy !== 0) { el.scrollLeft += dx; el.scrollTop += dy; }
      rafId = requestAnimationFrame(scroll);
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      const pt = "touches" in e ? e.touches[0] : e;
      mouseX = pt.clientX; mouseY = pt.clientY;
      if ((dragSelectionRef.current || colResizeRef.current) && rafId === null) {
        rafId = requestAnimationFrame(scroll);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // ── Auto-save ──
  const scheduleAutoSave = useCallback((wb: Workbook) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      api.saveSpySheet(id, JSON.stringify(wb))
        .then((res) => { if (res.updated_at) setSavedAt(res.updated_at); })
        .catch(() => {});
    }, 2000);
  }, [id]);

  const updateWorkbook = useCallback((updater: (prev: Workbook) => Workbook) => {
    setWorkbook((prev) => {
      const next = updater(prev);
      scheduleAutoSave(next);
      return next;
    });
  }, [scheduleAutoSave]);

  // Helper: update only the active sheet's data
  const updateActiveData = useCallback((updater: (prev: SheetData) => SheetData) => {
    updateWorkbook((wb) => ({
      ...wb,
      sheets: wb.sheets.map((s) =>
        s.id === wb.activeId ? { ...s, data: updater(s.data) } : s
      ),
    }));
  }, [updateWorkbook]);

  useEffect(() => {
    const resetResizeCursor = () => {
      if (typeof document === "undefined") return;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const handleResizeMove = (e: MouseEvent) => {
      const resize = colResizeRef.current;
      if (!resize) return;
      const nextWidth = Math.max(MIN_COL_WIDTH, Math.round(resize.startWidth + (e.clientX - resize.startX)));
      updateActiveData((prev) => {
        const current = prev.colWidths[resize.col] ?? DEFAULT_COL_WIDTH;
        if (current === nextWidth) return prev;
        const nextColWidths = { ...prev.colWidths };
        if (nextWidth === DEFAULT_COL_WIDTH) delete nextColWidths[resize.col];
        else nextColWidths[resize.col] = nextWidth;
        return { ...prev, colWidths: nextColWidths };
      });
    };

    const handleResizeUp = () => {
      if (!colResizeRef.current) return;
      colResizeRef.current = null;
      resetResizeCursor();
    };

    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeUp);
    return () => {
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeUp);
      resetResizeCursor();
    };
  }, [updateActiveData]);

  // ── Manual save ──
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.saveSpySheet(id, JSON.stringify(workbook));
      if (res.updated_at) setSavedAt(res.updated_at);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    } catch {}
    setSaving(false);
  };

  // ── Cell helpers ──
  const getCell = (r: number, c: number): Cell =>
    activeSheet?.data.cells[cellKey(r, c)] ?? {};

  const setCell = (r: number, c: number, patch: Partial<Cell>) => {
    updateActiveData((prev) => {
      const key = cellKey(r, c);
      const existing = prev.cells[key] ?? {};
      const merged = { ...existing, ...patch };
      if (merged.v === "") delete merged.v;
      if (Object.keys(merged).length === 0) {
        const { [key]: _, ...rest } = prev.cells;
        return { ...prev, cells: rest };
      }
      return { ...prev, cells: { ...prev.cells, [key]: merged } };
    });
  };

  const applyPatchToSelection = useCallback((patch: Partial<Cell>) => {
    const targets = selectedCellsFromRanges(selectionRangesRef.current);
    if (!targets.length) return;
    updateActiveData((prev) => {
      const nextCells = { ...prev.cells };
      targets.forEach(({ row, col }) => {
        const key = cellKey(row, col);
        const existing = nextCells[key] ?? {};
        const merged = { ...existing, ...patch };
        if (merged.v === "") delete merged.v;
        if (Object.keys(merged).length === 0) {
          delete nextCells[key];
          return;
        }
        nextCells[key] = merged;
      });
      return { ...prev, cells: nextCells };
    });
  }, [selectedCellsFromRanges, updateActiveData]);

  const isSelectedCell = useCallback((row: number, col: number): boolean =>
    selectionRanges.some((range) => isCellInRange(row, col, range)),
  [selectionRanges]);

  const isSelectedRow = useCallback((row: number): boolean =>
    selectionRanges.some((range) => {
      const n = normalizeRange(range);
      return row >= n.startRow && row <= n.endRow;
    }),
  [selectionRanges]);

  const isSelectedCol = useCallback((col: number): boolean =>
    selectionRanges.some((range) => {
      const n = normalizeRange(range);
      return col >= n.startCol && col <= n.endCol;
    }),
  [selectionRanges]);

  const writeClipboardText = useCallback(async (text: string) => {
    clipboardFallbackRef.current = text;
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }, []);

  const readClipboardText = useCallback(async (): Promise<string> => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      return clipboardFallbackRef.current;
    }
    try {
      const text = await navigator.clipboard.readText();
      return text || clipboardFallbackRef.current;
    } catch {
      return clipboardFallbackRef.current;
    }
  }, []);

  const serializeSelectionToTsv = useCallback((range: CellRange): string => {
    const n = normalizeRange(range);
    const lines: string[] = [];
    for (let r = n.startRow; r <= n.endRow; r++) {
      const rowVals: string[] = [];
      for (let c = n.startCol; c <= n.endCol; c++) {
        rowVals.push(getCell(r, c).v ?? "");
      }
      lines.push(rowVals.join("\t"));
    }
    return lines.join("\n");
  }, [getCell]);

  const handleCopySelection = useCallback(async () => {
    const ranges = selectionRangesRef.current;
    const sourceRange = ranges[ranges.length - 1] ?? singleCellRange(sel.row, sel.col);
    await writeClipboardText(serializeSelectionToTsv(sourceRange));
  }, [sel.row, sel.col, serializeSelectionToTsv, writeClipboardText]);

  const pasteTextAtSelection = useCallback((text: string) => {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let rows = normalized.split("\n");
    if (rows.length > 0 && rows[rows.length - 1] === "") rows = rows.slice(0, -1);
    if (!rows.length) return;

    const matrix = rows.map((rowText) => rowText.split("\t"));
    const oneCellPaste = matrix.length === 1 && matrix[0].length === 1;
    const selectedTargets = selectedCellsFromRanges(selectionRangesRef.current);

    updateActiveData((prev) => {
      const nextCells = { ...prev.cells };
      const setValue = (row: number, col: number, value: string) => {
        if (row < 0 || col < 0 || row >= prev.rows || col >= prev.cols) return;
        const key = cellKey(row, col);
        const existing = nextCells[key] ?? {};
        const merged: Partial<Cell> = { ...existing, v: value };
        if (merged.v === "") delete merged.v;
        if (Object.keys(merged).length === 0) {
          delete nextCells[key];
          return;
        }
        nextCells[key] = merged;
      };

      if (oneCellPaste && selectedTargets.length > 1) {
        const value = matrix[0][0] ?? "";
        selectedTargets.forEach(({ row, col }) => setValue(row, col, value));
      } else {
        matrix.forEach((rowVals, rOffset) => {
          rowVals.forEach((value, cOffset) => {
            setValue(sel.row + rOffset, sel.col + cOffset, value);
          });
        });
      }
      return { ...prev, cells: nextCells };
    });
  }, [sel.row, sel.col, selectedCellsFromRanges, updateActiveData]);

  const handlePasteFromClipboard = useCallback(async () => {
    const text = await readClipboardText();
    if (!text) return;
    pasteTextAtSelection(text);
  }, [pasteTextAtSelection, readClipboardText]);

  // ── Editing ──
  const startEdit = (r: number, c: number, initialChar?: string) => {
    const key = cellKey(r, c);
    const val = initialChar !== undefined ? initialChar : (activeSheet?.data.cells[key]?.v ?? "");
    setEditKey(key);
    setEditVal(val);
    setFormulaVal(val);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitEdit = useCallback((moveRow = 0, moveCol = 0) => {
    if (editKey === null) return;
    const [rStr, cStr] = editKey.split("_");
    const r = parseInt(rStr);
    const c = parseInt(cStr);
    setCell(r, c, { v: editVal });
    setEditKey(null);
    setSingleSelection(r + moveRow, c + moveCol);
  }, [editKey, editVal, setSingleSelection]); // eslint-disable-line

  // ── Formatting ──
  const toggleProp = (prop: keyof Cell) => {
    const cell = getCell(sel.row, sel.col);
    applyPatchToSelection({ [prop]: !cell[prop as "b"] } as Partial<Cell>);
  };
  const setProp = (prop: keyof Cell, val: unknown) =>
    applyPatchToSelection({ [prop]: val } as Partial<Cell>);

  const moveSelectionBy = (dRow: number, dCol: number, extend: boolean) => {
    const next = clampToSheet(sel.row + dRow, sel.col + dCol);
    setSel(next);
    if (extend) {
      setSelectionRanges([buildRange(selectionAnchor, next)]);
      return;
    }
    setSelectionAnchor(next);
    setSelectionRanges([singleCellRange(next.row, next.col)]);
  };

  const selectAllCells = useCallback(() => {
    const origin = { row: 0, col: 0 };
    setSel(origin);
    setSelectionAnchor(origin);
    setSelectionRanges([buildRange(origin, { row: sheetRows - 1, col: sheetCols - 1 })]);
  }, [sheetRows, sheetCols]);

  const buildRowSelectionRange = useCallback((fromRow: number, toRow: number): CellRange =>
    buildRange({ row: fromRow, col: 0 }, { row: toRow, col: sheetCols - 1 }),
  [sheetCols]);

  const buildColSelectionRange = useCallback((fromCol: number, toCol: number): CellRange =>
    buildRange({ row: 0, col: fromCol }, { row: sheetRows - 1, col: toCol }),
  [sheetRows]);

  // ── Grid keyboard ──
  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (editKey !== null) return;
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === "ArrowUp") { e.preventDefault(); moveSelectionBy(-1, 0, e.shiftKey); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveSelectionBy(1, 0, e.shiftKey); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); moveSelectionBy(0, -1, e.shiftKey); }
    else if (e.key === "ArrowRight") { e.preventDefault(); moveSelectionBy(0, 1, e.shiftKey); }
    else if (e.key === "Tab") { e.preventDefault(); moveSelectionBy(0, e.shiftKey ? -1 : 1, false); }
    else if (e.key === "Enter") { startEdit(sel.row, sel.col); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); applyPatchToSelection({ v: "" }); }
    else if (e.key === "F2") { e.preventDefault(); startEdit(sel.row, sel.col); }
    else if (ctrlOrMeta && key === "a") {
      e.preventDefault();
      selectAllCells();
    }
    else if (ctrlOrMeta && key === "c") { e.preventDefault(); void handleCopySelection(); }
    else if (ctrlOrMeta && key === "v") { e.preventDefault(); void handlePasteFromClipboard(); }
    else if (ctrlOrMeta && key === "b") { e.preventDefault(); toggleProp("b"); }
    else if (ctrlOrMeta && key === "i") { e.preventDefault(); toggleProp("i"); }
    else if (ctrlOrMeta && key === "u") { e.preventDefault(); toggleProp("u"); }
    else if (ctrlOrMeta && key === "s") { e.preventDefault(); void handleSave(); }
    else if (!ctrlOrMeta && !e.altKey && e.key.length === 1) { startEdit(sel.row, sel.col, e.key); }
  };

  const handleCellMouseDown = (e: React.MouseEvent<HTMLTableCellElement>, row: number, col: number) => {
    if (e.button !== 0) return;
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();

    const cell = clampToSheet(row, col);
    const additive = e.ctrlKey || e.metaKey;
    const anchor = e.shiftKey ? selectionAnchor : cell;
    const baseRanges = additive ? selectionRangesRef.current : [];
    const nextRange = buildRange(anchor, cell);

    setSel(cell);
    if (!e.shiftKey) setSelectionAnchor(cell);
    setSelectionRanges(additive ? [...baseRanges, nextRange] : [nextRange]);
    dragSelectionRef.current = { mode: "cells", origin: anchor, additive, baseRanges };
    e.preventDefault();
  };

  const handleCellMouseEnter = (e: React.MouseEvent<HTMLTableCellElement>, row: number, col: number) => {
    if ((e.buttons & 1) !== 1) return;
    if (colResizeRef.current) return;
    const drag = dragSelectionRef.current;
    if (!drag || drag.mode !== "cells") return;
    const cell = clampToSheet(row, col);
    const nextRange = buildRange(drag.origin, cell);
    setSel(cell);
    setSelectionRanges(drag.additive ? [...drag.baseRanges, nextRange] : [nextRange]);
  };

  const handleRowHeaderMouseDown = (e: React.MouseEvent<HTMLTableCellElement>, row: number) => {
    if (e.button !== 0) return;
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();

    const boundedRow = clampIndex(row, 0, sheetRows - 1);
    const additive = e.ctrlKey || e.metaKey;
    const anchorRow = e.shiftKey ? clampIndex(selectionAnchor.row, 0, sheetRows - 1) : boundedRow;
    const baseRanges = additive ? selectionRangesRef.current : [];
    const nextRange = buildRowSelectionRange(anchorRow, boundedRow);

    setSel({ row: boundedRow, col: 0 });
    if (!e.shiftKey) setSelectionAnchor({ row: boundedRow, col: 0 });
    setSelectionRanges(additive ? [...baseRanges, nextRange] : [nextRange]);
    dragSelectionRef.current = { mode: "rows", originRow: anchorRow, additive, baseRanges };
    e.preventDefault();
  };

  const handleRowHeaderMouseEnter = (e: React.MouseEvent<HTMLTableCellElement>, row: number) => {
    if ((e.buttons & 1) !== 1) return;
    if (colResizeRef.current) return;
    const drag = dragSelectionRef.current;
    if (!drag || drag.mode !== "rows") return;

    const boundedRow = clampIndex(row, 0, sheetRows - 1);
    const nextRange = buildRowSelectionRange(drag.originRow, boundedRow);
    setSel({ row: boundedRow, col: 0 });
    setSelectionRanges(drag.additive ? [...drag.baseRanges, nextRange] : [nextRange]);
  };

  const startColResize = useCallback((col: number, clientX: number) => {
    const boundedCol = clampIndex(col, 0, sheetCols - 1);
    const startWidth = activeSheet?.data.colWidths[boundedCol] ?? DEFAULT_COL_WIDTH;
    colResizeRef.current = {
      col: boundedCol,
      startX: clientX,
      startWidth,
    };
    if (typeof document !== "undefined") {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
  }, [activeSheet, sheetCols]);

  const handleColHeaderMouseDown = (e: React.MouseEvent<HTMLTableCellElement>, col: number) => {
    if (e.button !== 0) return;
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();

    const rect = e.currentTarget.getBoundingClientRect();
    const rightDist = rect.right - e.clientX;
    const leftDist = e.clientX - rect.left;
    if (rightDist <= COL_RESIZE_HITBOX) {
      startColResize(col, e.clientX);
      e.preventDefault();
      return;
    }
    if (leftDist <= COL_RESIZE_HITBOX && col > 0) {
      startColResize(col - 1, e.clientX);
      e.preventDefault();
      return;
    }

    const boundedCol = clampIndex(col, 0, sheetCols - 1);
    const additive = e.ctrlKey || e.metaKey;
    const anchorCol = e.shiftKey ? clampIndex(selectionAnchor.col, 0, sheetCols - 1) : boundedCol;
    const baseRanges = additive ? selectionRangesRef.current : [];
    const nextRange = buildColSelectionRange(anchorCol, boundedCol);

    setSel({ row: 0, col: boundedCol });
    if (!e.shiftKey) setSelectionAnchor({ row: 0, col: boundedCol });
    setSelectionRanges(additive ? [...baseRanges, nextRange] : [nextRange]);
    dragSelectionRef.current = { mode: "cols", originCol: anchorCol, additive, baseRanges };
    e.preventDefault();
  };

  const handleColHeaderMouseEnter = (e: React.MouseEvent<HTMLTableCellElement>, col: number) => {
    if ((e.buttons & 1) !== 1) return;
    if (colResizeRef.current) return;
    const drag = dragSelectionRef.current;
    if (!drag || drag.mode !== "cols") return;

    const boundedCol = clampIndex(col, 0, sheetCols - 1);
    const nextRange = buildColSelectionRange(drag.originCol, boundedCol);
    setSel({ row: 0, col: boundedCol });
    setSelectionRanges(drag.additive ? [...drag.baseRanges, nextRange] : [nextRange]);
  };

  const handleColResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>, col: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (editKey !== null) commitEdit();
    startColResize(col, e.clientX);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(0, 1); }
    else if (e.key === "Escape") { setEditKey(null); }
    else if (e.key === "ArrowUp") { commitEdit(-1, 0); }
    else if (e.key === "ArrowDown") { commitEdit(1, 0); }
  };

  // ── Touch helpers (mobile selection) ──
  const getCellFromPoint = useCallback((clientX: number, clientY: number): { row: number; col: number; isRowHeader: boolean } | null => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const td = el.closest("[data-row]") as HTMLElement | null;
    if (!td) return null;
    const row = parseInt(td.dataset.row ?? "", 10);
    const col = parseInt(td.dataset.col ?? "", 10);
    const isRowHeader = td.dataset.rowheader === "1";
    if (isNaN(row)) return null;
    return { row, col: isNaN(col) ? 0 : col, isRowHeader };
  }, []);

  const handleGridTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const hit = getCellFromPoint(t.clientX, t.clientY);
    if (!hit) return;
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();
    if (hit.isRowHeader) {
      const boundedRow = clampIndex(hit.row, 0, sheetRows - 1);
      const nextRange = buildRowSelectionRange(boundedRow, boundedRow);
      setSel({ row: boundedRow, col: 0 });
      setSelectionAnchor({ row: boundedRow, col: 0 });
      setSelectionRanges([nextRange]);
      dragSelectionRef.current = { mode: "rows", originRow: boundedRow, additive: false, baseRanges: [] };
    } else {
      const cell = clampToSheet(hit.row, hit.col);
      const nextRange = buildRange(cell, cell);
      setSel(cell);
      setSelectionAnchor(cell);
      setSelectionRanges([nextRange]);
      dragSelectionRef.current = { mode: "cells", origin: cell, additive: false, baseRanges: [] };
    }
    e.preventDefault();
  }, [editKey, commitEdit, clampToSheet, sheetRows, buildRange, buildRowSelectionRange, getCellFromPoint]);

  const handleGridTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const drag = dragSelectionRef.current;
    if (!drag) return;
    const t = e.touches[0];
    const hit = getCellFromPoint(t.clientX, t.clientY);
    if (!hit) return;
    if (drag.mode === "cells") {
      const cell = clampToSheet(hit.row, hit.col);
      setSel(cell);
      setSelectionRanges([buildRange(drag.origin, cell)]);
    } else if (drag.mode === "rows") {
      const boundedRow = clampIndex(hit.row, 0, sheetRows - 1);
      setSel({ row: boundedRow, col: 0 });
      setSelectionRanges([buildRowSelectionRange(drag.originRow, boundedRow)]);
    }
    e.preventDefault();
  }, [clampToSheet, sheetRows, buildRange, buildRowSelectionRange, getCellFromPoint]);

  // ── Rows / cols ──
  const addRow = () => updateActiveData((p) => ({ ...p, rows: p.rows + 10 }));
  const addCol = () => updateActiveData((p) => ({ ...p, cols: p.cols + 1 }));
  const removeRow = () => updateActiveData((p) => ({ ...p, rows: Math.max(10, p.rows - 10) }));

  const findSelectedRangeAt = useCallback((row: number, col: number): CellRange | null => {
    const ranges = selectionRangesRef.current;
    for (let i = ranges.length - 1; i >= 0; i -= 1) {
      if (isCellInRange(row, col, ranges[i])) return normalizeRange(ranges[i]);
    }
    return null;
  }, []);

  const openSelectionGenerateMenu = useCallback((clientX: number, clientY: number, range: CellRange) => {
    const { x, y } = clampFloatingCardPosition(clientX, clientY);
    setTabCtxMenu(null);
    setSelectionCtxMenu({
      x,
      y,
      preview: buildSelectionGenerationPreview(sheet, range),
    });
  }, [sheet]);

  const handleCellContextMenu = (e: React.MouseEvent<HTMLTableCellElement>, row: number, col: number) => {
    e.preventDefault();
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();

    const bounded = clampToSheet(row, col);
    const range = findSelectedRangeAt(bounded.row, bounded.col) ?? singleCellRange(bounded.row, bounded.col);
    if (!findSelectedRangeAt(bounded.row, bounded.col)) {
      setSel(bounded);
      setSelectionAnchor(bounded);
      setSelectionRanges([range]);
    }
    openSelectionGenerateMenu(e.clientX, e.clientY, range);
  };

  const handleRowHeaderContextMenu = (e: React.MouseEvent<HTMLTableCellElement>, row: number) => {
    e.preventDefault();
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();

    const boundedRow = clampIndex(row, 0, sheetRows - 1);
    const range = findSelectedRangeAt(boundedRow, 0) ?? buildRowSelectionRange(boundedRow, boundedRow);
    if (!findSelectedRangeAt(boundedRow, 0)) {
      setSel({ row: boundedRow, col: 0 });
      setSelectionAnchor({ row: boundedRow, col: 0 });
      setSelectionRanges([range]);
    }
    openSelectionGenerateMenu(e.clientX, e.clientY, range);
  };

  const handleColHeaderContextMenu = (e: React.MouseEvent<HTMLTableCellElement>, col: number) => {
    e.preventDefault();
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();

    const boundedCol = clampIndex(col, 0, sheetCols - 1);
    const range = findSelectedRangeAt(0, boundedCol) ?? buildColSelectionRange(boundedCol, boundedCol);
    if (!findSelectedRangeAt(0, boundedCol)) {
      setSel({ row: 0, col: boundedCol });
      setSelectionAnchor({ row: 0, col: boundedCol });
      setSelectionRanges([range]);
    }
    openSelectionGenerateMenu(e.clientX, e.clientY, range);
  };

  const handleGenerateFromSelection = useCallback(async () => {
    if (!selectionCtxMenu?.preview.ok || startingGeneration) return;
    setStartingGeneration(true);
    const preview = selectionCtxMenu.preview;
    try {
      const job = await api.startJob(id, {
        job_type: "articles_all_sites",
        shared_recipes: preview.items,
      });
      trackJob(job, {
        title: "Spy Sheet all-sites generation",
        sourceLabel: `${preview.items.length} selected row(s)`,
      });
      if (deleteAfterGeneration) {
        updateActiveData((prev) => deleteSheetRows(prev, preview.rowIndices));
      }
      setSelectionCtxMenu(null);
      toast.success(`Started generation for ${preview.items.length} selected row(s). Added to the pipeline.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start generation from Spy Sheet");
    } finally {
      setStartingGeneration(false);
    }
  }, [id, selectionCtxMenu, startingGeneration, deleteAfterGeneration, updateActiveData, toast, trackJob]);

  // ── Sheet tab operations ──
  const addSheet = () => {
    const existing = workbook.sheets.map((s) => s.name);
    let n = workbook.sheets.length + 1;
    let name = `Sheet${n}`;
    while (existing.includes(name)) name = `Sheet${++n}`;
    const t = newTab(name);
    updateWorkbook((wb) => ({ sheets: [...wb.sheets, t], activeId: t.id }));
    setSingleSelection(0, 0);
    setEditKey(null);
  };

  const switchSheet = (sheetId: string) => {
    if (editKey !== null) commitEdit();
    updateWorkbook((wb) => ({ ...wb, activeId: sheetId }));
    setSingleSelection(0, 0);
    setEditKey(null);
  };

  const deleteSheet = (sheetId: string) => {
    if (workbook.sheets.length === 1) return; // must keep at least one
    updateWorkbook((wb) => {
      const sheets = wb.sheets.filter((s) => s.id !== sheetId);
      const activeId = wb.activeId === sheetId
        ? (sheets[sheets.findIndex((_, i) => wb.sheets[i]?.id === sheetId) - 1] ?? sheets[0]).id
        : wb.activeId;
      return { sheets, activeId };
    });
    setSingleSelection(0, 0);
    setEditKey(null);
  };

  const duplicateSheet = (sheetId: string) => {
    const src = workbook.sheets.find((s) => s.id === sheetId);
    if (!src) return;
    const t: SheetTab = { id: uid(), name: `${src.name} (copy)`, data: JSON.parse(JSON.stringify(src.data)) };
    updateWorkbook((wb) => {
      const idx = wb.sheets.findIndex((s) => s.id === sheetId);
      const sheets = [...wb.sheets.slice(0, idx + 1), t, ...wb.sheets.slice(idx + 1)];
      return { sheets, activeId: t.id };
    });
    setSingleSelection(0, 0);
    setEditKey(null);
  };

  const startRename = (sheetId: string) => {
    const tab = workbook.sheets.find((s) => s.id === sheetId);
    if (!tab) return;
    setRenamingId(sheetId);
    setRenameVal(tab.name);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const name = renameVal.trim() || (workbook.sheets.find((s) => s.id === renamingId)?.name ?? "Sheet");
    updateWorkbook((wb) => ({
      ...wb,
      sheets: wb.sheets.map((s) => s.id === renamingId ? { ...s, name } : s),
    }));
    setRenamingId(null);
  };

  // ── Import / Export ──
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = typeof ev.target?.result === "string" ? ev.target.result : "";
      const rows = csvToRows(text);
      const imported = rowsToSheetData(rows);
      setWorkbook((prev) => {
        const next: Workbook = {
          ...prev,
          sheets: prev.sheets.map((s) =>
            s.id === prev.activeId ? { ...s, data: imported } : s
          ),
        };
        scheduleAutoSave(next);
        return next;
      });
      setSingleSelection(0, 0);
      setEditKey(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleExport = () => {
    const csv = sheetDataToCsv(sheet);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spy-sheet-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleScrapeSource = async () => {
    const url = scrapeUrl.trim();
    if (!url || scraping) return;
    setScraping(true);
    try {
      const res = await api.scrapeSpySheetSource(id, url);
      if (res.data) setWorkbook(parseStored(res.data));
      if (res.updated_at) setSavedAt(res.updated_at);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      setScrapeUrl("");
      if (res.rows_added > 0) {
        toast.success(`Scraped ${res.rows_added} row(s) from ${res.site_name}.`);
      } else {
        toast.warning(`No new rows found for ${res.site_name}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to scrape source");
    } finally {
      setScraping(false);
    }
  };

  const selCell = getCell(sel.row, sel.col);
  const selAddr = `${colLabel(sel.col)}${sel.row + 1}`;
  const tableMinWidth = HEADER_WIDTH + Array.from(
    { length: sheet.cols },
    (_, c) => sheet.colWidths[c] ?? DEFAULT_COL_WIDTH,
  ).reduce((sum, width) => sum + width, 0);
  const alignMap: Record<string, React.CSSProperties["textAlign"]> = { l: "left", c: "center", r: "right" };
  const selectedCells = selectedCellsFromRanges(selectionRanges);
  const selectionLabel = selectionRanges.length === 1
    ? rangeToAddress(selectionRanges[0])
    : `${selectionRanges.length} ranges (${selectedCells.length} cells)`;

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-950">
        <Loader2 size={32} className="animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 overflow-hidden select-none">

      {/* ── Toolbar ── */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-900">

        {/* Row 1: nav + actions */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
          <button
            onClick={() => router.push(`/projects/${id}`)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <span className="text-sm font-semibold text-white ml-1">Spy Sheet</span>
          <div className="flex-1" />
          {savedAt && !saving && (
            <span className="flex items-center gap-1 text-[11px] text-gray-500">
              <Check size={11} className="text-green-500" />
              Saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 transition">
            <Upload size={13} /> Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImport} />
          </label>
          <button onClick={handleExport} className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 transition">
            <Download size={13} /> Export CSV
          </button>
          <button onClick={() => void handleSave()} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50 transition">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {/* Row 1b: scrape source input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900/80">
          <Globe size={14} className="text-purple-400 shrink-0" />
          <input
            type="url"
            value={scrapeUrl}
            onChange={(e) => setScrapeUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleScrapeSource(); }}
            placeholder="Paste a WordPress site or article link to scrape rows into this Spy Sheet"
            className="flex-1 rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:border-purple-500 focus:outline-none transition"
          />
          <button
            onClick={() => void handleScrapeSource()}
            disabled={scraping || !scrapeUrl.trim()}
            className="flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50 transition shrink-0"
          >
            {scraping ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {scraping ? "Scraping..." : "Add"}
          </button>
        </div>

        {/* Row 2: formatting toolbar */}
        <div className="flex items-center gap-0.5 px-3 py-1.5 overflow-x-auto">
          <ToolbarGroup>
            <FmtBtn active={!!selCell.b} title="Bold (Ctrl+B)" onClick={() => toggleProp("b")}><Bold size={14} /></FmtBtn>
            <FmtBtn active={!!selCell.i} title="Italic (Ctrl+I)" onClick={() => toggleProp("i")}><Italic size={14} /></FmtBtn>
            <FmtBtn active={!!selCell.u} title="Underline (Ctrl+U)" onClick={() => toggleProp("u")}><Underline size={14} /></FmtBtn>
            <FmtBtn active={!!selCell.s} title="Strikethrough" onClick={() => toggleProp("s")}><Strikethrough size={14} /></FmtBtn>
          </ToolbarGroup>
          <Sep />
          <ToolbarGroup>
            <select
              value={selCell.fs ?? 13}
              onChange={(e) => setProp("fs", Number(e.target.value))}
              className="h-7 rounded border border-gray-700 bg-gray-800 px-1.5 text-xs text-gray-200 focus:outline-none"
              title="Font size"
            >
              {[10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </ToolbarGroup>
          <Sep />
          <ToolbarGroup>
            <FmtBtn active={selCell.ha === "l" || !selCell.ha} title="Align Left" onClick={() => setProp("ha", "l")}><AlignLeft size={14} /></FmtBtn>
            <FmtBtn active={selCell.ha === "c"} title="Align Center" onClick={() => setProp("ha", "c")}><AlignCenter size={14} /></FmtBtn>
            <FmtBtn active={selCell.ha === "r"} title="Align Right" onClick={() => setProp("ha", "r")}><AlignRight size={14} /></FmtBtn>
          </ToolbarGroup>
          <Sep />
          <ToolbarGroup>
            <label className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded hover:bg-gray-700 transition" title="Text color">
              <Palette size={14} className="text-gray-300" />
              <div className="absolute bottom-1 left-1.5 h-1 w-4 rounded-sm" style={{ backgroundColor: selCell.fg ?? "#ffffff" }} />
              <input type="color" value={selCell.fg ?? "#ffffff"} onChange={(e) => setProp("fg", e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
            </label>
            <label className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded hover:bg-gray-700 transition" title="Fill color">
              <PaintBucket size={14} className="text-gray-300" />
              <div className="absolute bottom-1 left-1.5 h-1 w-4 rounded-sm" style={{ backgroundColor: selCell.bg ?? "transparent" }} />
              <input type="color" value={selCell.bg ?? "#1f2937"} onChange={(e) => setProp("bg", e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
            </label>
          </ToolbarGroup>
          <Sep />
          <ToolbarGroup>
            <FmtBtn title="Add 10 rows" onClick={addRow}><Plus size={13} /><span className="text-[10px]">Row</span></FmtBtn>
            <FmtBtn title="Remove 10 rows" onClick={removeRow}><Minus size={13} /><span className="text-[10px]">Row</span></FmtBtn>
            <FmtBtn title="Add column" onClick={addCol}><Plus size={13} /><span className="text-[10px]">Col</span></FmtBtn>
          </ToolbarGroup>
        </div>

        {/* Row 3: formula bar */}
        <div className="flex items-center gap-2 border-t border-gray-800 px-3 py-1.5">
          <span className="w-12 shrink-0 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-center text-xs font-mono text-gray-300">
            {selAddr}
          </span>
          <input
            value={formulaVal}
            onChange={(e) => {
              setFormulaVal(e.target.value);
              if (editKey !== null) setEditVal(e.target.value);
              else setCell(sel.row, sel.col, { v: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(1, 0); gridRef.current?.focus(); }
            }}
            placeholder="Cell value…"
            className="flex-1 rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-100 placeholder-gray-600 focus:border-purple-500 focus:outline-none transition font-mono"
          />
        </div>
      </div>

      {/* ── Grid ── */}
      <div
        ref={gridRef}
        className="flex-1 overflow-auto outline-none"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        onCopy={(e) => {
          if (editKey !== null) return;
          e.preventDefault();
          void handleCopySelection();
        }}
        onPaste={(e) => {
          if (editKey !== null) return;
          const text = e.clipboardData.getData("text/plain");
          if (!text) return;
          e.preventDefault();
          pasteTextAtSelection(text);
        }}
        onTouchStart={handleGridTouchStart}
        onTouchMove={handleGridTouchMove}
        style={{ fontFamily: "Inter, system-ui, sans-serif", touchAction: "none" }}
      >
        <table className="border-collapse" style={{ tableLayout: "fixed", minWidth: tableMinWidth }}>
          <thead>
            <tr style={{ height: HEADER_HEIGHT }}>
              <th
                style={{ width: HEADER_WIDTH, minWidth: HEADER_WIDTH }}
                className="sticky top-0 left-0 z-20 border-b border-r border-gray-700 bg-gray-800 cursor-pointer hover:bg-gray-700/80"
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  gridRef.current?.focus();
                  if (editKey !== null) commitEdit();
                  selectAllCells();
                  e.preventDefault();
                }}
              />
              {Array.from({ length: sheet.cols }, (_, c) => (
                <th
                  key={c}
                  style={{ width: sheet.colWidths[c] ?? DEFAULT_COL_WIDTH, minWidth: MIN_COL_WIDTH }}
                  className={`relative sticky top-0 z-10 border-b border-r border-gray-700 bg-gray-800 text-center text-[11px] font-semibold cursor-pointer ${isSelectedCol(c) ? "bg-purple-900/30 text-purple-300" : "text-gray-400"}`}
                  onMouseDown={(e) => handleColHeaderMouseDown(e, c)}
                  onMouseEnter={(e) => handleColHeaderMouseEnter(e, c)}
                  onContextMenu={(e) => handleColHeaderContextMenu(e, c)}
                >
                  {colLabel(c)}
                  <div
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-purple-500/30"
                    onMouseDown={(e) => handleColResizeMouseDown(e, c)}
                    title="Resize column"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: sheet.rows }, (_, r) => (
              <tr key={r} style={{ height: sheet.rowHeights[r] ?? DEFAULT_ROW_HEIGHT }}>
                <td
                  data-row={r}
                  data-rowheader="1"
                  className={`sticky left-0 z-10 border-b border-r border-gray-700 bg-gray-800 text-center text-[11px] text-gray-500 cursor-pointer ${isSelectedRow(r) ? "bg-purple-900/30 text-purple-300 font-semibold" : ""}`}
                  onMouseDown={(e) => handleRowHeaderMouseDown(e, r)}
                  onMouseEnter={(e) => handleRowHeaderMouseEnter(e, r)}
                  onContextMenu={(e) => handleRowHeaderContextMenu(e, r)}
                >
                  {r + 1}
                </td>
                {Array.from({ length: sheet.cols }, (_, c) => {
                  const key = cellKey(r, c);
                  const cell = sheet.cells[key] ?? {};
                  const isSelected = isSelectedCell(r, c);
                  const isActiveCell = sel.row === r && sel.col === c;
                  const isEditing = editKey === key;
                  const cellStyle: React.CSSProperties = {
                    backgroundColor: cell.bg || undefined,
                    color: cell.fg || undefined,
                    fontWeight: cell.b ? "bold" : undefined,
                    fontStyle: cell.i ? "italic" : undefined,
                    textDecoration: [cell.u && "underline", cell.s && "line-through"].filter(Boolean).join(" ") || undefined,
                    textAlign: alignMap[cell.ha ?? "l"] ?? "left",
                    fontSize: cell.fs ? `${cell.fs}px` : "13px",
                  };
                  return (
                    <td
                      key={c}
                      data-row={r}
                      data-col={c}
                      style={cellStyle}
                      className={`relative border-b border-r border-gray-800 px-1.5 overflow-hidden whitespace-nowrap text-gray-100 cursor-default transition-colors ${
                        isActiveCell
                          ? "outline outline-2 outline-purple-500 outline-offset-[-1px] bg-purple-950/20"
                          : isSelected
                            ? "outline outline-1 outline-purple-700/80 outline-offset-[-1px] bg-purple-950/10"
                            : "hover:bg-gray-800/40"
                      }`}
                      onMouseDown={(e) => handleCellMouseDown(e, r, c)}
                      onMouseEnter={(e) => handleCellMouseEnter(e, r, c)}
                      onContextMenu={(e) => handleCellContextMenu(e, r, c)}
                      onDoubleClick={() => startEdit(r, c)}
                    >
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={editVal}
                          onChange={(e) => { setEditVal(e.target.value); setFormulaVal(e.target.value); }}
                          onKeyDown={handleInputKeyDown}
                          onBlur={() => commitEdit()}
                          className="absolute inset-0 w-full h-full bg-white/5 px-1.5 text-gray-100 focus:outline-none"
                          style={{ fontSize: cell.fs ? `${cell.fs}px` : "13px", fontWeight: cell.b ? "bold" : undefined, fontStyle: cell.i ? "italic" : undefined, textAlign: alignMap[cell.ha ?? "l"] ?? "left", zIndex: 5 }}
                        />
                      ) : (
                        <span style={cellStyle} className="block truncate">{cell.v ?? ""}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Sheet tabs bar ── */}
      <div className="shrink-0 flex items-stretch border-t border-gray-700 bg-gray-900">
        {/* Scrollable tabs */}
        <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
          {workbook.sheets.map((tab) => {
            const isActive = tab.id === workbook.activeId;
            const isRenaming = renamingId === tab.id;
            return (
              <div
                key={tab.id}
                className={`group relative flex items-center shrink-0 border-r border-gray-700 px-3 cursor-pointer select-none transition-colors ${
                  isActive
                    ? "bg-gray-950 border-t-2 border-t-purple-500 text-white"
                    : "bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                }`}
                style={{ minWidth: 80, maxWidth: 180 }}
                onClick={() => !isRenaming && switchSheet(tab.id)}
                onDoubleClick={() => startRename(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelectionCtxMenu(null);
                  setTabCtxMenu({ x: e.clientX, y: e.clientY, sheetId: tab.id });
                }}
              >
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") setRenamingId(null); }}
                    className="w-full bg-transparent text-xs text-white outline-none border-b border-purple-400"
                    style={{ minWidth: 60 }}
                  />
                ) : (
                  <span className="text-xs truncate">{tab.name}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Add sheet button */}
        <button
          onClick={addSheet}
          className="shrink-0 flex items-center justify-center w-8 border-l border-gray-700 text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition"
          title="Add sheet"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* ── Status bar ── */}
      <div className="shrink-0 flex items-center justify-between border-t border-gray-800 bg-gray-900 px-4 py-1">
        <span className="text-[11px] text-gray-500">{sheet.rows} rows × {sheet.cols} cols</span>
        <span className="text-[11px] text-gray-500">{Object.keys(sheet.cells).length} cells used</span>
        <span className="text-[11px] text-gray-500">{selectionLabel}{selCell.v ? ` = ${selCell.v}` : ""}</span>
      </div>

      {/* ── Tab context menu ── */}
      {tabCtxMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-2xl"
          style={{ top: tabCtxMenu.y, left: tabCtxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <CtxItem icon={<Pencil size={13} />} label="Rename" onClick={() => { startRename(tabCtxMenu.sheetId); setTabCtxMenu(null); }} />
          <CtxItem icon={<Copy size={13} />} label="Duplicate" onClick={() => { duplicateSheet(tabCtxMenu.sheetId); setTabCtxMenu(null); }} />
          <div className="my-1 border-t border-gray-800" />
          <CtxItem
            icon={<Trash2 size={13} />}
            label="Delete"
            danger
            disabled={workbook.sheets.length === 1}
            onClick={() => { deleteSheet(tabCtxMenu.sheetId); setTabCtxMenu(null); }}
          />
        </div>
      )}

      {selectionCtxMenu && (
        <div
          className="fixed z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-purple-800/40 bg-gray-900/95 p-4 shadow-2xl backdrop-blur-sm overflow-y-auto"
          style={{ top: selectionCtxMenu.y, left: selectionCtxMenu.x, maxHeight: "calc(100vh - 24px)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Generate From Selection</div>
              <div className="mt-1 text-[11px] text-gray-500">{selectionCtxMenu.preview.rangeLabel}</div>
            </div>
            <button
              onClick={() => setSelectionCtxMenu(null)}
              className="rounded-md px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
            >
              Close
            </button>
          </div>

          {selectionCtxMenu.preview.ok ? (
            <>
              <div className="mt-3 space-y-2 rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs text-gray-300">
                <div className="flex items-center justify-between gap-3">
                  <span>Ready rows</span>
                  <span className="font-semibold text-white">{selectionCtxMenu.preview.items.length}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Image column</span>
                  <span className="font-mono text-purple-300">{colLabel(selectionCtxMenu.preview.imageCol)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Recipe text column</span>
                  <span className="font-mono text-purple-300">{colLabel(selectionCtxMenu.preview.recipeCol)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Skipped incomplete rows</span>
                  <span>{selectionCtxMenu.preview.skippedRows}</span>
                </div>
                <div className="text-[11px] text-gray-500">
                  {selectionCtxMenu.preview.usedHeaderRow
                    ? "Headers were detected in the selection, so generation will use the rows underneath them."
                    : "This selection will start the same all-sites generation job used in the project workflow."}
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Preview</div>
                <div className="mt-2 space-y-2">
                  {selectionCtxMenu.preview.items.slice(0, 2).map((item, idx) => (
                    <div key={`${item.image_url}-${idx}`} className="rounded-md border border-gray-800 bg-gray-900/60 p-2">
                      <div className="truncate text-[11px] text-purple-300">{item.image_url}</div>
                      <div className="mt-1 truncate text-xs text-gray-300">{item.recipe_text}</div>
                    </div>
                  ))}
                </div>
              </div>

              <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={deleteAfterGeneration}
                  onChange={(e) => setDeleteAfterGeneration(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-600 accent-purple-500"
                />
                <span className="text-xs text-gray-300">Delete rows from sheet after generation</span>
              </label>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setSelectionCtxMenu(null)}
                  className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800 transition"
                >
                  Keep Editing
                </button>
                <button
                  onClick={() => void handleGenerateFromSelection()}
                  disabled={startingGeneration}
                  className="flex items-center gap-2 rounded-md bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-60 transition"
                >
                  {startingGeneration ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {startingGeneration ? "Starting..." : "Generate On All Sites"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mt-3 rounded-lg border border-amber-700/30 bg-amber-950/20 p-3 text-xs text-amber-100">
                {selectionCtxMenu.preview.message}
              </div>
              <div className="mt-3 text-[11px] text-gray-500">
                Tip: select the rows that contain your image URL and recipe text columns, then right-click again.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Micro components ─────────────────────────────────────────────────────────
function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}
function Sep() {
  return <div className="mx-1.5 h-5 w-px bg-gray-700" />;
}
function FmtBtn({ active, title, onClick, children }: { active?: boolean; title?: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className={`flex items-center gap-0.5 h-7 min-w-7 px-1.5 rounded text-xs transition ${active ? "bg-purple-600/30 text-purple-300" : "text-gray-400 hover:bg-gray-700 hover:text-gray-200"}`}>
      {children}
    </button>
  );
}
function CtxItem({ icon, label, onClick, danger, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition disabled:opacity-30 disabled:cursor-not-allowed ${danger ? "text-red-400 hover:bg-red-950/40" : "text-gray-300 hover:bg-gray-800"}`}
    >
      {icon} {label}
    </button>
  );
}
