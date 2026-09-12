"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Activity, Loader2, Pause } from "lucide-react";
import { api, PinterestPublisherOut, PinterestPublishingLogOut } from "@/lib/api";
import { getUserEmail } from "@/lib/auth";

function LogsPage() {
  const siteId = useSearchParams().get("site_id") || "";
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [publisher, setPublisher] = useState<PinterestPublisherOut | null>(null);
  const [logs, setLogs] = useState<PinterestPublishingLogOut[]>([]);
  const [beforeId, setBeforeId] = useState<number | undefined>();
  const [nextId, setNextId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState("");
  useEffect(() => { setAllowed(getUserEmail()?.trim().toLowerCase() === "khalil@gmail.com"); }, []);
  useEffect(() => { setBeforeId(undefined); setPublisher(null); setLogs([]); }, [siteId]);
  useEffect(() => {
    if (!allowed || !siteId) return;
    let disposed = false;
    let loading = false;
    setLogs([]); setNextId(null); setUpdated("");
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const [status, page] = await Promise.all([api.getPinterestPublisher(siteId), api.getPinterestPublishingLogs(siteId, beforeId)]);
        if (!disposed) { setPublisher(status); setLogs(page.items); setNextId(page.next_before_id); setError(""); setUpdated(new Date().toLocaleTimeString()); }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : "Could not load publishing logs"); }
      finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [allowed, siteId, beforeId]);

  if (allowed === null) return <div className="p-8"><Loader2 className="animate-spin" /></div>;
  if (!allowed || !siteId) return <div className="p-10 text-center"><h1 className="text-xl font-semibold">{allowed ? "Select a website first" : "Publishing is unavailable"}</h1><Link href="/pinterest-gallery" className="mt-5 inline-block text-red-400">Back to Pinterest</Link></div>;
  const settingsUrl = `/pinterest-gallery/publishing?site_id=${siteId}`;
  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <Link href={settingsUrl} className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft size={16} /> Publishing settings & queue</Link>
    <header className="mt-6 flex flex-wrap items-end justify-between gap-5 border-b border-gray-800 pb-7">
      <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-400">Pinterest / Activity</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">Publishing logs</h1><p className="mt-3 text-gray-400">{publisher?.domain || "Loading website…"}</p></div>
      <div className="flex items-center gap-4"><span className={`text-sm ${publisher?.enabled ? "text-emerald-400" : "text-gray-400"}`}>{publisher?.enabled ? "Automatic publishing is on" : "Automatic publishing is off"}</span>
        {publisher?.enabled && <button disabled={busy} onClick={async () => {
          setBusy(true);
          try { setPublisher(await api.savePinterestPublishingSettings(siteId, { daily_limit: publisher.daily_limit, interval_minutes: publisher.interval_minutes, enabled: false })); }
          catch (e) { setError(e instanceof Error ? e.message : "Could not stop publishing"); }
          finally { setBusy(false); }
        }} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm disabled:opacity-40"><Pause size={15} /> Stop publishing</button>}
      </div>
    </header>
    {error && <p role="alert" className="mt-5 rounded-lg bg-amber-950/30 p-4 text-sm text-amber-200">{error}</p>}
    {publisher && <section className="my-6 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-gray-800 p-5"><p className="text-xs text-gray-500">Today / daily limit · UTC</p><p className="mt-2 text-2xl tabular-nums">{publisher.daily_usage} <span className="text-gray-500">/ {publisher.daily_limit}</span></p><p className="mt-2 text-xs text-gray-500">Includes pins awaiting confirmation</p></div>
      <div className="rounded-xl border border-gray-800 p-5"><p className="text-xs text-gray-500">Interval / queue</p><p className="mt-2 text-2xl">{publisher.interval_minutes} <span className="text-sm text-gray-500">minutes</span></p><p className="mt-2 text-xs text-gray-400">{publisher.counts.pending} pending · {publisher.counts.publishing} publishing · {publisher.counts.failed} failed</p></div>
      <div className="rounded-xl border border-gray-800 p-5"><p className="text-xs text-gray-500">Next eligible publication</p><p className="mt-2 text-sm text-gray-200">{publisher.enabled && publisher.next_publication_at ? new Date(publisher.next_publication_at).toLocaleString() : "Publishing stopped"}</p><p className="mt-2 text-xs leading-5 text-gray-500">Requires a ready item. Worker checks every 30 seconds; failed items may have a later retry time.</p></div>
    </section>}
    {publisher?.last_error && <p className="mb-5 rounded-lg border border-amber-900 p-4 text-sm text-amber-200">{publisher.last_error} <Link href={settingsUrl} className="underline">Review queue and connection</Link></p>}
    <section className="mt-6 overflow-hidden rounded-2xl border border-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 bg-gray-900/50 p-5"><h2 className="flex items-center gap-2 font-medium"><Activity size={18} className="text-red-400" /> {beforeId ? "Earlier activity" : "Latest activity"}</h2><span role="status" className="text-xs text-gray-500">{updated ? `Updated ${updated} · refreshes every 3 seconds` : "Loading activity…"}</span></div>
      {logs.length === 0 ? <p className="p-10 text-center text-sm text-gray-500">{updated ? "No events recorded yet. Start publishing from the settings page to follow its progress here." : "Loading logs…"}</p> : <ol className="divide-y divide-gray-800">{logs.map((log) => <li key={log.id} className="grid gap-3 p-5 sm:grid-cols-[170px_1fr]">
        <time className="text-xs leading-6 tabular-nums text-gray-500" dateTime={log.created_at}>{new Date(log.created_at).toLocaleString()}</time>
        <div><p className={`text-xs font-medium uppercase tracking-wider ${log.level === "error" ? "text-amber-400" : log.event === "pin_published" ? "text-emerald-400" : "text-gray-400"}`}>{log.event.replaceAll("_", " ")}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-200">{log.message}</p>{log.publication_id && <p className="mt-2 break-all text-xs text-gray-600">Item {log.publication_id}</p>}</div>
      </li>)}</ol>}
      <div className="flex items-center justify-between border-t border-gray-800 p-5 text-sm"><button disabled={!beforeId} onClick={() => setBeforeId(undefined)} className="text-gray-300 disabled:opacity-30">Back to latest</button><button disabled={!nextId} onClick={() => { if (nextId) setBeforeId(nextId); }} className="text-red-400 disabled:opacity-30">Older activity</button></div>
    </section>
    <p className="mt-4 text-xs text-gray-500">Activity is saved for this website. You can close this page while the backend publishes. Pins already sent may finish after stopping.</p>
  </main>;
}

export default function Page() {
  return <Suspense fallback={<div className="p-8"><Loader2 className="animate-spin" /></div>}><LogsPage /></Suspense>;
}
