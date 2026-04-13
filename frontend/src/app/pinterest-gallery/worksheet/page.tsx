"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Save, Plus } from "lucide-react";
import {
  PINTEREST_WORKSHEET_HEADER,
  PINTEREST_WORKSHEET_INIT_KEY,
  PINTEREST_WORKSHEET_STORAGE_KEY,
  PinterestWorksheetSnapshot,
} from "@/lib/pinterestWorksheet";

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
  | { mode: "rows"; originRow: number; additive: boolean; baseRanges: CellRange[] };

interface WorksheetData {
  header: string[];
  rows: string[][];
}

interface PersistedWorksheet extends WorksheetData {
  updatedAt: string | null;
}

const DEFAULT_COL_WIDTH = 220;
const HEADER_WIDTH = 52;
const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 34;

const clampIndex = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const colLabel = (c: number): string => {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

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

const rangeToAddress = (range: CellRange, rowOffset: number): string => {
  const n = normalizeRange(range);
  const start = `${colLabel(n.startCol)}${n.startRow + rowOffset}`;
  const end = `${colLabel(n.endCol)}${n.endRow + rowOffset}`;
  return start === end ? start : `${start}:${end}`;
};

function emptyWorksheet(): WorksheetData {
  return { header: [...PINTEREST_WORKSHEET_HEADER], rows: [Array(PINTEREST_WORKSHEET_HEADER.length).fill("")] };
}

function normalizeWorksheet(raw: WorksheetData): WorksheetData {
  const expectedHeader = [...PINTEREST_WORKSHEET_HEADER];
  const sourceHeader = Array.isArray(raw.header) ? raw.header : [];
  const columnMap = expectedHeader.map((col) =>
    sourceHeader.findIndex((h) => h.trim().toLowerCase() === col.trim().toLowerCase()),
  );
  const sourceRows = raw.rows.length > 0 ? raw.rows : [Array(expectedHeader.length).fill("")];
  const rows = sourceRows.map((row) =>
    expectedHeader.map((_, colIndex) => {
      const srcIndex = columnMap[colIndex];
      if (srcIndex < 0 || srcIndex >= row.length) return "";
      return row[srcIndex] ?? "";
    }),
  );

  return {
    header: expectedHeader,
    rows,
  };
}

function parseSnapshot(raw: string | null): WorksheetData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PinterestWorksheetSnapshot;
    if (!Array.isArray(parsed.header) || !Array.isArray(parsed.rows)) return null;
    if (!parsed.header.every((v) => typeof v === "string")) return null;
    if (!parsed.rows.every((row) => Array.isArray(row) && row.every((v) => typeof v === "string"))) return null;
    return normalizeWorksheet({ header: parsed.header, rows: parsed.rows });
  } catch {
    return null;
  }
}

function parsePersisted(raw: string | null): PersistedWorksheet | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedWorksheet;
    if (!Array.isArray(parsed.header) || !Array.isArray(parsed.rows)) return null;
    if (!parsed.header.every((v) => typeof v === "string")) return null;
    if (!parsed.rows.every((row) => Array.isArray(row) && row.every((v) => typeof v === "string"))) return null;
    return {
      ...normalizeWorksheet({ header: parsed.header, rows: parsed.rows }),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

export default function PinterestWorksheetPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [sheet, setSheet] = useState<WorksheetData>(emptyWorksheet());
  const [sel, setSel] = useState<Selection>({ row: 0, col: 0 });
  const [selectionAnchor, setSelectionAnchor] = useState<Selection>({ row: 0, col: 0 });
  const [selectionRanges, setSelectionRanges] = useState<CellRange[]>([singleCellRange(0, 0)]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [formulaVal, setFormulaVal] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const selectionRangesRef = useRef<CellRange[]>([singleCellRange(0, 0)]);
  const dragSelectionRef = useRef<DragSelectionState | null>(null);
  const clipboardFallbackRef = useRef("");

  const rowsCount = sheet.rows.length;
  const colsCount = sheet.header.length;

  const clampSelection = useCallback((row: number, col: number): Selection => ({
    row: Math.max(0, Math.min(rowsCount - 1, row)),
    col: Math.max(0, Math.min(colsCount - 1, col)),
  }), [rowsCount, colsCount]);

  const setSingleSelection = useCallback((row: number, col: number) => {
    const bounded = clampSelection(row, col);
    setSel(bounded);
    setSelectionAnchor(bounded);
    setSelectionRanges([singleCellRange(bounded.row, bounded.col)]);
  }, [clampSelection]);

  const selectedCellsFromRanges = useCallback((ranges: CellRange[]): Selection[] => {
    const seen = new Set<string>();
    const out: Selection[] = [];
    ranges.forEach((range) => {
      const n = normalizeRange(range);
      const startRow = clampIndex(n.startRow, 0, rowsCount - 1);
      const endRow = clampIndex(n.endRow, 0, rowsCount - 1);
      const startCol = clampIndex(n.startCol, 0, colsCount - 1);
      const endCol = clampIndex(n.endCol, 0, colsCount - 1);
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const key = `${r}_${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ row: r, col: c });
        }
      }
    });
    return out;
  }, [rowsCount, colsCount]);

  const setCell = useCallback((row: number, col: number, value: string) => {
    setSheet((prev) => {
      const rows = prev.rows.map((r) => [...r]);
      if (!rows[row]) return prev;
      rows[row][col] = value;
      return { ...prev, rows };
    });
  }, []);

  const manualSave = useCallback(() => {
    if (typeof window === "undefined") return;
    const stamp = new Date().toISOString();
    const payload: PersistedWorksheet = {
      header: sheet.header,
      rows: sheet.rows,
      updatedAt: stamp,
    };
    localStorage.setItem(PINTEREST_WORKSHEET_STORAGE_KEY, JSON.stringify(payload));
    setSavedAt(stamp);
  }, [sheet]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      manualSave();
    } finally {
      setSaving(false);
    }
  }, [manualSave]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const snapshot = parseSnapshot(sessionStorage.getItem(PINTEREST_WORKSHEET_INIT_KEY));
    if (snapshot) {
      setSheet(snapshot);
      setSel({ row: 0, col: 0 });
      setSelectionAnchor({ row: 0, col: 0 });
      setSelectionRanges([singleCellRange(0, 0)]);
      sessionStorage.removeItem(PINTEREST_WORKSHEET_INIT_KEY);
      setLoading(false);
      setHydrated(true);
      return;
    }

    const persisted = parsePersisted(localStorage.getItem(PINTEREST_WORKSHEET_STORAGE_KEY));
    if (persisted) {
      setSheet({ header: persisted.header, rows: persisted.rows });
      setSel({ row: 0, col: 0 });
      setSelectionAnchor({ row: 0, col: 0 });
      setSelectionRanges([singleCellRange(0, 0)]);
      setSavedAt(persisted.updatedAt);
      setLoading(false);
      setHydrated(true);
      return;
    }

    setSheet(emptyWorksheet());

    setLoading(false);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (editKey !== null) return;
    const val = sheet.rows[sel.row]?.[sel.col] ?? "";
    setFormulaVal(val);
  }, [sheet, sel, editKey]);

  useEffect(() => {
    selectionRangesRef.current = selectionRanges;
  }, [selectionRanges]);

  useEffect(() => {
    const stopDragSelection = () => {
      dragSelectionRef.current = null;
    };
    window.addEventListener("mouseup", stopDragSelection);
    return () => window.removeEventListener("mouseup", stopDragSelection);
  }, []);

  useEffect(() => {
    if (!hydrated || loading) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      manualSave();
    }, 1200);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [sheet, hydrated, loading, manualSave]);

  const startEdit = (row: number, col: number, seed?: string) => {
    const key = `${row}_${col}`;
    const val = seed !== undefined ? seed : (sheet.rows[row]?.[col] ?? "");
    setEditKey(key);
    setEditVal(val);
    setFormulaVal(val);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitEdit = useCallback((moveRow = 0, moveCol = 0) => {
    if (!editKey) return;
    const [rStr, cStr] = editKey.split("_");
    const row = Number(rStr);
    const col = Number(cStr);
    if (Number.isNaN(row) || Number.isNaN(col)) {
      setEditKey(null);
      return;
    }
    setCell(row, col, editVal);
    setEditKey(null);
    setSingleSelection(row + moveRow, col + moveCol);
  }, [editKey, editVal, setCell, setSingleSelection]);

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
        rowVals.push(sheet.rows[r]?.[c] ?? "");
      }
      lines.push(rowVals.join("\t"));
    }
    return lines.join("\n");
  }, [sheet.rows]);

  const handleCopySelection = useCallback(async () => {
    const ranges = selectionRangesRef.current;
    const sourceRange = ranges[ranges.length - 1] ?? singleCellRange(sel.row, sel.col);
    await writeClipboardText(serializeSelectionToTsv(sourceRange));
  }, [sel.row, sel.col, serializeSelectionToTsv, writeClipboardText]);

  const clearSelectionValues = useCallback(() => {
    const targets = selectedCellsFromRanges(selectionRangesRef.current);
    if (!targets.length) return;
    setSheet((prev) => {
      const rows = prev.rows.map((r) => [...r]);
      targets.forEach(({ row, col }) => {
        if (!rows[row]) return;
        rows[row][col] = "";
      });
      return { ...prev, rows };
    });
  }, [selectedCellsFromRanges]);

  const pasteTextAtSelection = useCallback((text: string) => {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let lines = normalized.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines = lines.slice(0, -1);
    if (!lines.length) return;
    const matrix = lines.map((line) => line.split("\t"));
    const oneCellPaste = matrix.length === 1 && matrix[0].length === 1;
    const selectedTargets = selectedCellsFromRanges(selectionRangesRef.current);

    setSheet((prev) => {
      const rows = prev.rows.map((r) => [...r]);
      const setValue = (row: number, col: number, value: string) => {
        if (row < 0 || row >= rows.length || col < 0 || col >= prev.header.length) return;
        rows[row][col] = value;
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

      return { ...prev, rows };
    });
  }, [sel.row, sel.col, selectedCellsFromRanges]);

  const handlePasteFromClipboard = useCallback(async () => {
    const text = await readClipboardText();
    if (!text) return;
    pasteTextAtSelection(text);
  }, [pasteTextAtSelection, readClipboardText]);

  const moveSelectionBy = useCallback((dRow: number, dCol: number, extend: boolean) => {
    const next = clampSelection(sel.row + dRow, sel.col + dCol);
    setSel(next);
    if (extend) {
      setSelectionRanges([buildRange(selectionAnchor, next)]);
      return;
    }
    setSelectionAnchor(next);
    setSelectionRanges([singleCellRange(next.row, next.col)]);
  }, [clampSelection, sel.row, sel.col, selectionAnchor]);

  const selectAllCells = useCallback(() => {
    const origin = { row: 0, col: 0 };
    setSel(origin);
    setSelectionAnchor(origin);
    setSelectionRanges([buildRange(origin, { row: rowsCount - 1, col: colsCount - 1 })]);
  }, [rowsCount, colsCount]);

  const buildRowSelectionRange = useCallback((fromRow: number, toRow: number): CellRange =>
    buildRange({ row: fromRow, col: 0 }, { row: toRow, col: colsCount - 1 }),
  [colsCount]);

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editKey !== null) return;
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === "ArrowUp") { e.preventDefault(); moveSelectionBy(-1, 0, e.shiftKey); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveSelectionBy(1, 0, e.shiftKey); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); moveSelectionBy(0, -1, e.shiftKey); }
    else if (e.key === "ArrowRight") { e.preventDefault(); moveSelectionBy(0, 1, e.shiftKey); }
    else if (e.key === "Tab") { e.preventDefault(); moveSelectionBy(0, e.shiftKey ? -1 : 1, false); }
    else if (e.key === "Enter") { startEdit(sel.row, sel.col); }
    else if (e.key === "F2") { e.preventDefault(); startEdit(sel.row, sel.col); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearSelectionValues(); }
    else if (ctrlOrMeta && key === "a") { e.preventDefault(); selectAllCells(); }
    else if (ctrlOrMeta && key === "s") { e.preventDefault(); void handleSave(); }
    else if (ctrlOrMeta && key === "c") { e.preventDefault(); void handleCopySelection(); }
    else if (ctrlOrMeta && key === "v") { e.preventDefault(); void handlePasteFromClipboard(); }
    else if (!ctrlOrMeta && !e.altKey && e.key.length === 1) {
      startEdit(sel.row, sel.col, e.key);
    }
  };

  const handleCellMouseDown = (e: React.MouseEvent<HTMLTableCellElement>, row: number, col: number) => {
    if (e.button !== 0) return;
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();

    const cell = clampSelection(row, col);
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
    const cell = clampSelection(row, col);
    const nextRange = buildRange(drag.origin, cell);
    setSel(cell);
    setSelectionRanges(drag.additive ? [...drag.baseRanges, nextRange] : [nextRange]);
  };

  const handleRowHeaderMouseDown = (e: React.MouseEvent<HTMLTableCellElement>, row: number) => {
    if (e.button !== 0) return;
    if (editKey !== null) commitEdit();
    gridRef.current?.focus();

    const boundedRow = clampIndex(row, 0, rowsCount - 1);
    const additive = e.ctrlKey || e.metaKey;
    const anchorRow = e.shiftKey ? clampIndex(selectionAnchor.row, 0, rowsCount - 1) : boundedRow;
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

    const boundedRow = clampIndex(row, 0, rowsCount - 1);
    const nextRange = buildRowSelectionRange(drag.originRow, boundedRow);
    setSel({ row: boundedRow, col: 0 });
    setSelectionRanges(drag.additive ? [...drag.baseRanges, nextRange] : [nextRange]);
  };

  const addRow = () => {
    setSheet((prev) => ({
      ...prev,
      rows: [...prev.rows, Array(prev.header.length).fill("")],
    }));
  };

  const selectedCells = selectedCellsFromRanges(selectionRanges);
  const selectionLabel = selectionRanges.length === 1
    ? rangeToAddress(selectionRanges[0], 2)
    : `${selectionRanges.length} ranges (${selectedCells.length} cells)`;

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-950">
        <Loader2 size={32} className="animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950 text-white">
      <div className="shrink-0 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2">
          <button
            onClick={() => router.push("/pinterest-gallery")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <span className="ml-1 text-sm font-semibold text-white">Pinterest Worksheet</span>
          <div className="flex-1" />
          {savedAt && !saving && (
            <span className="text-[11px] text-gray-500">Saved {new Date(savedAt).toLocaleTimeString()}</span>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-1.5">
          <span className="w-14 shrink-0 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-center font-mono text-xs text-gray-300">
            {selectionLabel}
          </span>
          <input
            value={formulaVal}
            onChange={(e) => {
              setFormulaVal(e.target.value);
              if (editKey !== null) setEditVal(e.target.value);
              else setCell(sel.row, sel.col, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (editKey !== null) commitEdit(1, 0);
                else moveSelectionBy(1, 0, false);
                gridRef.current?.focus();
              }
            }}
            className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-100 placeholder-gray-600 outline-none transition focus:border-blue-500"
            placeholder="Cell value..."
          />
          <button
            onClick={addRow}
            className="flex items-center gap-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 transition hover:bg-gray-700"
            title="Add row"
          >
            <Plus size={12} /> Row
          </button>
        </div>
      </div>

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
      >
        <table className="border-collapse" style={{ tableLayout: "fixed", minWidth: HEADER_WIDTH + colsCount * DEFAULT_COL_WIDTH }}>
          <thead>
            <tr style={{ height: HEADER_HEIGHT }}>
              <th
                className="sticky left-0 top-0 z-20 border-b border-r border-gray-700 bg-gray-800"
                style={{ width: HEADER_WIDTH, minWidth: HEADER_WIDTH }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  gridRef.current?.focus();
                  if (editKey !== null) commitEdit();
                  selectAllCells();
                  e.preventDefault();
                }}
              />
              {sheet.header.map((label, c) => (
                <th
                  key={label + c}
                  className={`sticky top-0 z-10 border-b border-r border-gray-700 bg-gray-800 px-2 text-left text-[11px] font-semibold ${
                    isSelectedCol(c) ? "text-blue-300" : "text-gray-300"
                  }`}
                  style={{ width: DEFAULT_COL_WIDTH }}
                >
                  <span className="block truncate" title={label}>{label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r} style={{ height: ROW_HEIGHT }}>
                <td
                  className={`sticky left-0 z-10 border-b border-r border-gray-700 bg-gray-800 text-center text-[11px] ${
                    isSelectedRow(r) ? "font-semibold text-blue-300" : "text-gray-500"
                  }`}
                  onMouseDown={(e) => handleRowHeaderMouseDown(e, r)}
                  onMouseEnter={(e) => handleRowHeaderMouseEnter(e, r)}
                >
                  {r + 2}
                </td>
                {row.map((value, c) => {
                  const key = `${r}_${c}`;
                  const isActiveCell = sel.row === r && sel.col === c;
                  const isSelected = isSelectedCell(r, c);
                  const isEditing = editKey === key;
                  return (
                    <td
                      key={key}
                      className={`relative border-b border-r border-gray-800 px-1.5 text-xs text-gray-100 ${
                        isActiveCell
                          ? "bg-blue-950/20 outline outline-2 outline-blue-500 outline-offset-[-1px]"
                          : isSelected
                            ? "bg-blue-950/10 outline outline-1 outline-blue-700/80 outline-offset-[-1px]"
                            : "hover:bg-gray-900/50"
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
                          onBlur={() => commitEdit()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitEdit(1, 0); }
                            else if (e.key === "Tab") { e.preventDefault(); commitEdit(0, 1); }
                            else if (e.key === "Escape") { setEditKey(null); }
                          }}
                          className="absolute inset-0 h-full w-full bg-white/5 px-1.5 text-gray-100 outline-none"
                        />
                      ) : (
                        <span className="block truncate">{value}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-gray-800 bg-gray-900 px-4 py-1 text-[11px] text-gray-500">
        {sheet.rows.length} rows x {sheet.header.length} cols
      </div>
    </div>
  );
}
