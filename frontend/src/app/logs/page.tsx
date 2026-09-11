"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Globe2, Loader2, RefreshCcw, Search } from "lucide-react";
import { api, AuditLogOut, AuditLogSiteOut } from "@/lib/api";

const ALLOWED_EMAIL = "khalil@gmail.com";
const PAGE_SIZE = 50;

export default function LogsPage() {
  const router = useRouter();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AuditLogOut[]>([]);
  const [sites, setSites] = useState<AuditLogSiteOut[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [tableName, setTableName] = useState("");
  const [entityPk, setEntityPk] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = total === 0 ? 0 : pageStart + logs.length - 1;
  const pageNumbers = useMemo(() => {
    if (totalPages <= 1) return [1];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    const values: number[] = [];
    for (let current = adjustedStart; current <= end; current += 1) {
      values.push(current);
    }
    return values;
  }, [page, totalPages]);

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) || null,
    [selectedSiteId, sites],
  );

  const loadSites = useCallback(async () => {
    setSitesLoading(true);
    try {
      setSites(await api.getAuditLogSites());
    } finally {
      setSitesLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async (
    targetPage: number = page,
    options?: { siteId?: string; entityPk?: string },
  ) => {
    setLoading(true);
    setError(null);
    try {
      const safePage = Math.max(1, targetPage);
      const activeSiteId = options?.siteId ?? selectedSiteId;
      const activeEntityPk = options?.entityPk ?? entityPk;
      const res = await api.getAuditLogs({
        limit: PAGE_SIZE,
        offset: (safePage - 1) * PAGE_SIZE,
        action: action || undefined,
        table_name: tableName.trim() || undefined,
        entity_pk: activeEntityPk.trim() || undefined,
        site_id: activeSiteId || undefined,
      });
      setLogs(res.items);
      setTotal(res.total);
      setPage(safePage);
      setExpandedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [action, entityPk, page, selectedSiteId, tableName]);

  const handleSelectSite = useCallback((siteId: string) => {
    setSelectedSiteId(siteId);
    setEntityPk("");
    void loadLogs(1, { siteId, entityPk: "" });
  }, [loadLogs]);

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
        await Promise.all([loadSites(), loadLogs(1)]);
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
            onClick={() => void loadLogs(page)}
            disabled={loading}
            className="btn-secondary flex items-center gap-1.5 px-3 py-2 text-xs"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <Globe2 size={14} className="text-brand-400" />
          Websites
          {sitesLoading && <Loader2 size={13} className="animate-spin text-brand-400" />}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => handleSelectSite("")}
            disabled={loading}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm transition ${
              selectedSiteId === ""
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
            } disabled:opacity-50`}
          >
            All Websites
          </button>
          {sites.map((site) => (
            <button
              key={site.id}
              onClick={() => handleSelectSite(site.id)}
              disabled={loading}
              title={`${site.project_name} - ${site.domain}`}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left transition ${
                selectedSiteId === site.id
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
              } disabled:opacity-50`}
            >
              <span className="block max-w-56 truncate text-sm font-medium">{site.domain}</span>
              <span className={`block max-w-56 truncate text-[11px] ${
                selectedSiteId === site.id ? "text-blue-100" : "text-gray-500"
              }`}>
                {site.project_name}
                {site.recipe_count > 0 ? ` - ${site.recipe_count} recipes` : ""}
              </span>
            </button>
          ))}
          {!sitesLoading && sites.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-700 px-3 py-2 text-sm text-gray-500">
              No websites found
            </div>
          )}
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
          placeholder={selectedSite ? `Entity PK in ${selectedSite.domain}` : "Entity PK"}
          className="input-field w-full"
        />
        <button
          onClick={() => void loadLogs(1)}
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
        <div className="max-h-[70vh] overflow-auto">
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-800 px-3 py-2 text-xs text-gray-400">
          <span>Showing {pageStart}-{pageEnd} of {total}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadLogs(page - 1)}
              disabled={loading || page <= 1}
              className="btn-secondary flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-40"
            >
              <ChevronLeft size={12} />
              Prev
            </button>
            <div className="flex items-center gap-1">
              {pageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  onClick={() => void loadLogs(pageNumber)}
                  disabled={loading}
                  className={`min-w-8 rounded-md px-2 py-1 text-xs ${
                    pageNumber === page
                      ? "bg-brand-500 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  } disabled:opacity-40`}
                >
                  {pageNumber}
                </button>
              ))}
            </div>
            <button
              onClick={() => void loadLogs(page + 1)}
              disabled={loading || page >= totalPages}
              className="btn-secondary flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-40"
            >
              Next
              <ChevronRight size={12} />
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
