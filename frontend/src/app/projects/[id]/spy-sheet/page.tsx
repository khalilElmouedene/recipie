"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Save, Download, Upload, Plus, Minus,
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  Palette, PaintBucket, Loader2, Check, Copy, Trash2, Pencil,
} from "lucide-react";
import { api } from "@/lib/api";
import * as XLSX from "xlsx";

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_ROWS = 50;
const DEFAULT_COLS = 26;
const DEFAULT_COL_WIDTH = 120;
const DEFAULT_ROW_HEIGHT = 26;
const HEADER_WIDTH = 50;
const HEADER_HEIGHT = 26;

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

interface CtxMenu {
  x: number;
  y: number;
  sheetId: string;
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

function workbookToXlsx(wb: Workbook): ArrayBuffer {
  const xlWb = XLSX.utils.book_new();
  wb.sheets.forEach((tab) => {
    const wsData: string[][] = [];
    for (let r = 0; r < tab.data.rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < tab.data.cols; c++) {
        row.push(tab.data.cells[cellKey(r, c)]?.v ?? "");
      }
      wsData.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(xlWb, ws, tab.name);
  });
  return XLSX.write(xlWb, { type: "array", bookType: "xlsx" });
}

function xlsxToWorkbook(buffer: ArrayBuffer): Workbook {
  const xlWb = XLSX.read(buffer, { type: "array" });
  const tabs: SheetTab[] = xlWb.SheetNames.map((name) => {
    const ws = xlWb.Sheets[name];
    const rows2d: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
    const data = emptySheetData();
    data.rows = Math.max(DEFAULT_ROWS, rows2d.length);
    data.cols = Math.max(DEFAULT_COLS, Math.max(...rows2d.map((r) => r.length), 0));
    rows2d.forEach((row, r) => {
      row.forEach((val, c) => {
        if (val !== "" && val != null) data.cells[cellKey(r, c)] = { v: String(val) };
      });
    });
    return { id: uid(), name, data };
  });
  const first = tabs[0] ?? newTab("Sheet1");
  return { sheets: tabs.length ? tabs : [first], activeId: first.id };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SpySheetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

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
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const selectionRangesRef = useRef<CellRange[]>([singleCellRange(0, 0)]);
  const dragSelectionRef = useRef<DragSelectionState | null>(null);
  const clipboardFallbackRef = useRef("");

  // ── Active sheet ──
  const activeSheet = workbook.sheets.find((s) => s.id === workbook.activeId)
    ?? workbook.sheets[0];
  const sheetRows = activeSheet?.data.rows ?? DEFAULT_ROWS;
  const sheetCols = activeSheet?.data.cols ?? DEFAULT_COLS;

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
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  useEffect(() => {
    const stopDragSelection = () => {
      dragSelectionRef.current = null;
    };
    window.addEventListener("mouseup", stopDragSelection);
    return () => window.removeEventListener("mouseup", stopDragSelection);
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
    const drag = dragSelectionRef.current;
    if (!drag || drag.mode !== "rows") return;

    const boundedRow = clampIndex(row, 0, sheetRows - 1);
    const nextRange = buildRowSelectionRange(drag.originRow, boundedRow);
    setSel({ row: boundedRow, col: 0 });
    setSelectionRanges(drag.additive ? [...drag.baseRanges, nextRange] : [nextRange]);
  };

  const handleColHeaderMouseDown = (e: React.MouseEvent<HTMLTableCellElement>, col: number) => {
    if (e.button !== 0) return;
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();

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
    const drag = dragSelectionRef.current;
    if (!drag || drag.mode !== "cols") return;

    const boundedCol = clampIndex(col, 0, sheetCols - 1);
    const nextRange = buildColSelectionRange(drag.originCol, boundedCol);
    setSel({ row: 0, col: boundedCol });
    setSelectionRanges(drag.additive ? [...drag.baseRanges, nextRange] : [nextRange]);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(0, 1); }
    else if (e.key === "Escape") { setEditKey(null); }
    else if (e.key === "ArrowUp") { commitEdit(-1, 0); }
    else if (e.key === "ArrowDown") { commitEdit(1, 0); }
  };

  // ── Rows / cols ──
  const addRow = () => updateActiveData((p) => ({ ...p, rows: p.rows + 10 }));
  const addCol = () => updateActiveData((p) => ({ ...p, cols: p.cols + 1 }));
  const removeRow = () => updateActiveData((p) => ({ ...p, rows: Math.max(10, p.rows - 10) }));

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
      const wb = xlsxToWorkbook(ev.target?.result as ArrayBuffer);
      setWorkbook(wb);
      scheduleAutoSave(wb);
      setSingleSelection(0, 0);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleExport = () => {
    const buf = workbookToXlsx(workbook);
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spy-sheet-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const selCell = getCell(sel.row, sel.col);
  const selAddr = `${colLabel(sel.col)}${sel.row + 1}`;
  const sheet = activeSheet?.data ?? emptySheetData();
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
            <Upload size={13} /> Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          </label>
          <button onClick={handleExport} className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 transition">
            <Download size={13} /> Export Excel
          </button>
          <button onClick={() => void handleSave()} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50 transition">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? "Saving…" : "Save"}
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
        style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      >
        <table className="border-collapse" style={{ tableLayout: "fixed", minWidth: HEADER_WIDTH + sheet.cols * DEFAULT_COL_WIDTH }}>
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
                  style={{ width: sheet.colWidths[c] ?? DEFAULT_COL_WIDTH }}
                  className={`sticky top-0 z-10 border-b border-r border-gray-700 bg-gray-800 text-center text-[11px] font-semibold cursor-pointer ${isSelectedCol(c) ? "bg-purple-900/30 text-purple-300" : "text-gray-400"}`}
                  onMouseDown={(e) => handleColHeaderMouseDown(e, c)}
                  onMouseEnter={(e) => handleColHeaderMouseEnter(e, c)}
                >
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: sheet.rows }, (_, r) => (
              <tr key={r} style={{ height: sheet.rowHeights[r] ?? DEFAULT_ROW_HEIGHT }}>
                <td
                  className={`sticky left-0 z-10 border-b border-r border-gray-700 bg-gray-800 text-center text-[11px] text-gray-500 cursor-pointer ${isSelectedRow(r) ? "bg-purple-900/30 text-purple-300 font-semibold" : ""}`}
                  onMouseDown={(e) => handleRowHeaderMouseDown(e, r)}
                  onMouseEnter={(e) => handleRowHeaderMouseEnter(e, r)}
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
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, sheetId: tab.id }); }}
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
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-2xl"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <CtxItem icon={<Pencil size={13} />} label="Rename" onClick={() => { startRename(ctxMenu.sheetId); setCtxMenu(null); }} />
          <CtxItem icon={<Copy size={13} />} label="Duplicate" onClick={() => { duplicateSheet(ctxMenu.sheetId); setCtxMenu(null); }} />
          <div className="my-1 border-t border-gray-800" />
          <CtxItem
            icon={<Trash2 size={13} />}
            label="Delete"
            danger
            disabled={workbook.sheets.length === 1}
            onClick={() => { deleteSheet(ctxMenu.sheetId); setCtxMenu(null); }}
          />
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
