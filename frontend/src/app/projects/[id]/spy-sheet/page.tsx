"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Save, Download, Upload, Plus, Minus,
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  Palette, PaintBucket, Loader2, Check,
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
  v?: string;         // value
  b?: boolean;        // bold
  i?: boolean;        // italic
  u?: boolean;        // underline
  s?: boolean;        // strikethrough
  fg?: string;        // text color
  bg?: string;        // background color
  ha?: "l" | "c" | "r"; // horizontal align
  fs?: number;        // font size
}

interface SheetData {
  cells: Record<string, Cell>;   // "row_col" -> cell
  colWidths: Record<number, number>;
  rowHeights: Record<number, number>;
  rows: number;
  cols: number;
}

interface Selection {
  row: number;
  col: number;
  row2?: number; // range end (for future multi-select)
  col2?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

const emptySheet = (): SheetData => ({
  cells: {},
  colWidths: {},
  rowHeights: {},
  rows: DEFAULT_ROWS,
  cols: DEFAULT_COLS,
});

function sheetToXlsx(sheet: SheetData): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const wsData: string[][] = [];
  for (let r = 0; r < sheet.rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < sheet.cols; c++) {
      row.push(sheet.cells[cellKey(r, c)]?.v ?? "");
    }
    wsData.push(row);
  }
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

function xlsxToSheet(buffer: ArrayBuffer): SheetData {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows2d: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
  const sheet = emptySheet();
  const numRows = Math.max(DEFAULT_ROWS, rows2d.length);
  const numCols = Math.max(DEFAULT_COLS, Math.max(...rows2d.map((r) => r.length), 0));
  sheet.rows = numRows;
  sheet.cols = numCols;
  rows2d.forEach((row, r) => {
    row.forEach((val, c) => {
      if (val !== "" && val != null) {
        sheet.cells[cellKey(r, c)] = { v: String(val) };
      }
    });
  });
  return sheet;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SpySheetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [sheet, setSheet] = useState<SheetData>(emptySheet());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({ row: 0, col: 0 });
  const [editKey, setEditKey] = useState<string | null>(null); // currently editing cell key
  const [editVal, setEditVal] = useState("");
  const [formulaVal, setFormulaVal] = useState(""); // formula bar content
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // ── Load ──
  useEffect(() => {
    api.getSpySheet(id)
      .then((res) => {
        if (res.data) {
          try { setSheet(JSON.parse(res.data)); } catch { setSheet(emptySheet()); }
        }
        if (res.updated_at) setSavedAt(res.updated_at);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Keep formula bar in sync with selection
  useEffect(() => {
    if (editKey === null) {
      const cell = sheet.cells[cellKey(sel.row, sel.col)];
      setFormulaVal(cell?.v ?? "");
    }
  }, [sel, sheet, editKey]);

  // ── Auto-save (debounced 2s after last change) ──
  const scheduleAutoSave = useCallback((s: SheetData) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      api.saveSpySheet(id, JSON.stringify(s))
        .then((res) => { if (res.updated_at) setSavedAt(res.updated_at); })
        .catch(() => {});
    }, 2000);
  }, [id]);

  const updateSheet = useCallback((updater: (prev: SheetData) => SheetData) => {
    setSheet((prev) => {
      const next = updater(prev);
      scheduleAutoSave(next);
      return next;
    });
  }, [scheduleAutoSave]);

  // ── Manual save ──
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.saveSpySheet(id, JSON.stringify(sheet));
      if (res.updated_at) setSavedAt(res.updated_at);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    } catch {}
    setSaving(false);
  };

  // ── Cell helpers ──
  const getCell = (r: number, c: number): Cell =>
    sheet.cells[cellKey(r, c)] ?? {};

  const setCell = (r: number, c: number, patch: Partial<Cell>) => {
    updateSheet((prev) => {
      const key = cellKey(r, c);
      const existing = prev.cells[key] ?? {};
      const merged = { ...existing, ...patch };
      // Clean empty values
      if (merged.v === "") delete merged.v;
      if (Object.keys(merged).length === 0) {
        const { [key]: _, ...rest } = prev.cells;
        return { ...prev, cells: rest };
      }
      return { ...prev, cells: { ...prev.cells, [key]: merged } };
    });
  };

  // ── Start editing ──
  const startEdit = (r: number, c: number, initialChar?: string) => {
    const key = cellKey(r, c);
    const val = initialChar !== undefined ? initialChar : (sheet.cells[key]?.v ?? "");
    setEditKey(key);
    setEditVal(val);
    setFormulaVal(val);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  // ── Commit edit ──
  const commitEdit = useCallback((moveRow = 0, moveCol = 0) => {
    if (editKey === null) return;
    const [rStr, cStr] = editKey.split("_");
    const r = parseInt(rStr);
    const c = parseInt(cStr);
    setCell(r, c, { v: editVal });
    setEditKey(null);
    const newRow = Math.max(0, Math.min(sheet.rows - 1, r + moveRow));
    const newCol = Math.max(0, Math.min(sheet.cols - 1, c + moveCol));
    setSel({ row: newRow, col: newCol });
  }, [editKey, editVal, sheet.rows, sheet.cols]); // eslint-disable-line

  // ── Formatting ──
  const toggleProp = (prop: keyof Cell) => {
    const cell = getCell(sel.row, sel.col);
    setCell(sel.row, sel.col, { [prop]: !cell[prop as "b"] });
  };
  const setProp = (prop: keyof Cell, val: unknown) => {
    setCell(sel.row, sel.col, { [prop]: val } as Partial<Cell>);
  };

  // ── Keyboard handling on grid ──
  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (editKey !== null) return; // handled by input

    const { row, col } = sel;
    if (e.key === "ArrowUp") { e.preventDefault(); setSel({ row: Math.max(0, row - 1), col }); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel({ row: Math.min(sheet.rows - 1, row + 1), col }); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setSel({ row, col: Math.max(0, col - 1) }); }
    else if (e.key === "ArrowRight" || e.key === "Tab") { e.preventDefault(); setSel({ row, col: Math.min(sheet.cols - 1, col + 1) }); }
    else if (e.key === "Enter") { startEdit(row, col); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      setCell(row, col, { v: "" });
    } else if (e.key === "F2") { e.preventDefault(); startEdit(row, col); }
    else if (e.ctrlKey && e.key === "b") { e.preventDefault(); toggleProp("b"); }
    else if (e.ctrlKey && e.key === "i") { e.preventDefault(); toggleProp("i"); }
    else if (e.ctrlKey && e.key === "u") { e.preventDefault(); toggleProp("u"); }
    else if (e.ctrlKey && e.key === "s") { e.preventDefault(); void handleSave(); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      startEdit(row, col, e.key);
    }
  };

  // ── Input keyboard (inside cell) ──
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(0, 1); }
    else if (e.key === "Escape") { setEditKey(null); setSel(sel); }
    else if (e.key === "ArrowUp") { commitEdit(-1, 0); }
    else if (e.key === "ArrowDown") { commitEdit(1, 0); }
  };

  // ── Add / remove rows / cols ──
  const addRow = () => updateSheet((p) => ({ ...p, rows: p.rows + 10 }));
  const addCol = () => updateSheet((p) => ({ ...p, cols: p.cols + 1 }));
  const removeRow = () => updateSheet((p) => ({ ...p, rows: Math.max(10, p.rows - 10) }));

  // ── Excel import ──
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buf = ev.target?.result as ArrayBuffer;
      const imported = xlsxToSheet(buf);
      setSheet(imported);
      scheduleAutoSave(imported);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  // ── Excel export ──
  const handleExport = () => {
    const buf = sheetToXlsx(sheet);
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

          {/* Saved indicator */}
          {savedAt && !saving && (
            <span className="flex items-center gap-1 text-[11px] text-gray-500">
              <Check size={11} className="text-green-500" />
              Saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}

          {/* Import */}
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 transition">
            <Upload size={13} /> Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          </label>

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 transition"
          >
            <Download size={13} /> Export Excel
          </button>

          {/* Save */}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50 transition"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {/* Row 2: formatting toolbar */}
        <div className="flex items-center gap-0.5 px-3 py-1.5 overflow-x-auto">

          {/* Bold / Italic / Underline / Strikethrough */}
          <ToolbarGroup>
            <FmtBtn active={!!selCell.b} title="Bold (Ctrl+B)" onClick={() => toggleProp("b")}><Bold size={14} /></FmtBtn>
            <FmtBtn active={!!selCell.i} title="Italic (Ctrl+I)" onClick={() => toggleProp("i")}><Italic size={14} /></FmtBtn>
            <FmtBtn active={!!selCell.u} title="Underline (Ctrl+U)" onClick={() => toggleProp("u")}><Underline size={14} /></FmtBtn>
            <FmtBtn active={!!selCell.s} title="Strikethrough" onClick={() => toggleProp("s")}><Strikethrough size={14} /></FmtBtn>
          </ToolbarGroup>

          <Sep />

          {/* Font size */}
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

          {/* Alignment */}
          <ToolbarGroup>
            <FmtBtn active={selCell.ha === "l" || !selCell.ha} title="Align Left" onClick={() => setProp("ha", "l")}><AlignLeft size={14} /></FmtBtn>
            <FmtBtn active={selCell.ha === "c"} title="Align Center" onClick={() => setProp("ha", "c")}><AlignCenter size={14} /></FmtBtn>
            <FmtBtn active={selCell.ha === "r"} title="Align Right" onClick={() => setProp("ha", "r")}><AlignRight size={14} /></FmtBtn>
          </ToolbarGroup>

          <Sep />

          {/* Text color */}
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

          {/* Add/remove rows & cols */}
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
              else {
                setCell(sel.row, sel.col, { v: e.target.value });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEdit(1, 0);
                gridRef.current?.focus();
              }
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
        style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      >
        <table
          className="border-collapse"
          style={{ tableLayout: "fixed", minWidth: HEADER_WIDTH + sheet.cols * DEFAULT_COL_WIDTH }}
        >
          {/* Column header row */}
          <thead>
            <tr style={{ height: HEADER_HEIGHT }}>
              {/* corner cell */}
              <th
                style={{ width: HEADER_WIDTH, minWidth: HEADER_WIDTH }}
                className="sticky top-0 left-0 z-20 border-b border-r border-gray-700 bg-gray-800"
              />
              {Array.from({ length: sheet.cols }, (_, c) => (
                <th
                  key={c}
                  style={{ width: sheet.colWidths[c] ?? DEFAULT_COL_WIDTH }}
                  className={`sticky top-0 z-10 border-b border-r border-gray-700 bg-gray-800 text-center text-[11px] font-semibold text-gray-400 ${sel.col === c ? "bg-purple-900/30 text-purple-300" : ""}`}
                  onClick={() => setSel({ row: sel.row, col: c })}
                >
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {Array.from({ length: sheet.rows }, (_, r) => (
              <tr key={r} style={{ height: sheet.rowHeights[r] ?? DEFAULT_ROW_HEIGHT }}>
                {/* Row header */}
                <td
                  className={`sticky left-0 z-10 border-b border-r border-gray-700 bg-gray-800 text-center text-[11px] text-gray-500 select-none ${sel.row === r ? "bg-purple-900/30 text-purple-300 font-semibold" : ""}`}
                  onClick={() => setSel({ row: r, col: sel.col })}
                >
                  {r + 1}
                </td>

                {/* Data cells */}
                {Array.from({ length: sheet.cols }, (_, c) => {
                  const key = cellKey(r, c);
                  const cell = sheet.cells[key] ?? {};
                  const isSelected = sel.row === r && sel.col === c;
                  const isEditing = editKey === key;

                  const alignMap: Record<string, React.CSSProperties["textAlign"]> = { l: "left", c: "center", r: "right" };
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
                        isSelected
                          ? "outline outline-2 outline-purple-500 outline-offset-[-1px] bg-purple-950/20"
                          : "hover:bg-gray-800/40"
                      }`}
                      onClick={() => {
                        if (editKey !== null) commitEdit();
                        setSel({ row: r, col: c });
                        gridRef.current?.focus();
                      }}
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
                          style={{
                            fontSize: cell.fs ? `${cell.fs}px` : "13px",
                            fontWeight: cell.b ? "bold" : undefined,
                            fontStyle: cell.i ? "italic" : undefined,
                            textAlign: alignMap[cell.ha ?? "l"] ?? "left",
                            zIndex: 5,
                          }}
                        />
                      ) : (
                        <span style={cellStyle} className="block truncate">
                          {cell.v ?? ""}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Status bar ── */}
      <div className="shrink-0 flex items-center justify-between border-t border-gray-800 bg-gray-900 px-4 py-1">
        <span className="text-[11px] text-gray-500">
          {sheet.rows} rows × {sheet.cols} cols
        </span>
        <span className="text-[11px] text-gray-500">
          {Object.keys(sheet.cells).length} cells used
        </span>
        <span className="text-[11px] text-gray-500">
          {selAddr} {selCell.v ? `= ${selCell.v}` : ""}
        </span>
      </div>
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

function FmtBtn({
  active, title, onClick, children,
}: {
  active?: boolean;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex items-center gap-0.5 h-7 min-w-7 px-1.5 rounded text-xs transition ${
        active
          ? "bg-purple-600/30 text-purple-300"
          : "text-gray-400 hover:bg-gray-700 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
