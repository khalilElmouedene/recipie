"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw, Search } from "lucide-react";
import { api, AuditLogOut } from "@/lib/api";

const ALLOWED_EMAIL = "khalil@gmail.com";
const PAGE_SIZE = 50;

export default function LogsPage() {
  const router = useRouter();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AuditLogOut[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [tableName, setTableName] = useState("");
  const [entityPk, setEntityPk] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const page = useMemo(() => Math.floor(offset / PAGE_SIZE) + 1, [offset]);
  const maxPage = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const loadLogs = async (nextOffset = offset) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAuditLogs({
        limit: PAGE_SIZE,
        offset: nextOffset,
        action: action || undefined,
        table_name: tableName.trim() || undefined,
        entity_pk: entityPk.trim() || undefined,
      });
      setLogs(res.items);
      setTotal(res.total);
      setOffset(nextOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await api.me();
        if (!active) return;
        if ((me.email || "").trim().toLowerCase() !== ALLOWED_EMAIL) {
          router.replace("/");
          return;
        }
        setCheckingAccess(false);
        await loadLogs(0);
      } catch {
        router.replace("/");
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (checkingAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={28} className="animate-spin text-brand-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-white">Application Logs</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void loadLogs(0)}
            disabled={loading}
            className="btn-secondary flex items-center gap-1.5 px-3 py-2 text-xs"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-xl border border-gray-800 bg-gray-900 p-3 md:grid-cols-4">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="input-field w-full"
        >
          <option value="">All actions</option>
          <option value="insert">insert</option>
          <option value="update">update</option>
          <option value="delete">delete</option>
        </select>
        <input
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          placeholder="Table name"
          className="input-field w-full"
        />
        <input
          value={entityPk}
          onChange={(e) => setEntityPk(e.target.value)}
          placeholder="Entity PK"
          className="input-field w-full"
        />
        <button
          onClick={() => void loadLogs(0)}
          disabled={loading}
          className="btn-primary flex items-center justify-center gap-1.5 text-sm"
        >
          <Search size={14} />
          Search
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-gray-300">Time</th>
                <th className="px-3 py-2 text-gray-300">Actor</th>
                <th className="px-3 py-2 text-gray-300">Action</th>
                <th className="px-3 py-2 text-gray-300">Table</th>
                <th className="px-3 py-2 text-gray-300">Entity</th>
                <th className="px-3 py-2 text-gray-300">Request</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const expanded = expandedId === log.id;
                return (
                  <FragmentRow
                    key={log.id}
                    log={log}
                    expanded={expanded}
                    onToggle={() => setExpandedId(expanded ? null : log.id)}
                  />
                );
              })}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-500">
                    No logs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-800 px-3 py-2 text-xs text-gray-400">
          <span>Total: {total}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={offset === 0 || loading}
              onClick={() => void loadLogs(Math.max(0, offset - PAGE_SIZE))}
              className="rounded border border-gray-700 px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span>Page {page} / {maxPage}</span>
            <button
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => void loadLogs(offset + PAGE_SIZE)}
              className="rounded border border-gray-700 px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({
  log,
  expanded,
  onToggle,
}: {
  log: AuditLogOut;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-gray-800 hover:bg-gray-800/50"
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-gray-200">{new Date(log.occurred_at).toLocaleString()}</td>
        <td className="px-3 py-2 text-gray-300">{log.actor_email || "system"}</td>
        <td className="px-3 py-2">
          <span className="rounded bg-gray-800 px-2 py-0.5 text-gray-300">{log.action}</span>
        </td>
        <td className="px-3 py-2 text-gray-300">{log.table_name}</td>
        <td className="px-3 py-2 text-gray-400">{log.entity_pk || "-"}</td>
        <td className="px-3 py-2 text-gray-400">
          {log.request_method || "-"} {log.request_path || ""}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-gray-800 bg-gray-950/50">
          <td colSpan={6} className="px-3 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold text-gray-400">Old Values</p>
                <pre className="max-h-64 overflow-auto rounded bg-gray-950 p-2 text-[11px] text-gray-300">
                  {JSON.stringify(log.old_values ?? {}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold text-gray-400">New Values</p>
                <pre className="max-h-64 overflow-auto rounded bg-gray-950 p-2 text-[11px] text-gray-300">
                  {JSON.stringify(log.new_values ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
