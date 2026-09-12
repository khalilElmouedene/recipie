"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock3, ExternalLink, Globe2, Loader2, Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { api, PinterestPublisherOut, PinterestPublicationOut, PinterestPublicationStatus } from "@/lib/api";
import { getUserEmail } from "@/lib/auth";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";

const labels: Record<PinterestPublicationStatus, string> = { pending: "Pending", publishing: "Publishing", published: "Published", failed: "Failed" };
const colors: Record<PinterestPublicationStatus, string> = {
  pending: "bg-gray-800 text-gray-300", publishing: "bg-blue-500/15 text-blue-300",
  published: "bg-emerald-500/15 text-emerald-300", failed: "bg-amber-500/15 text-amber-300",
};
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const safeUrl = (url: string) => /^https?:\/\//i.test(url);

function PublishingPage() {
  const params = useSearchParams();
  const siteId = params.get("site_id") || "";
  const toast = useToast();
  const confirm = useConfirm();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [publisher, setPublisher] = useState<PinterestPublisherOut | null>(null);
  const [items, setItems] = useState<PinterestPublicationOut[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [daily, setDaily] = useState(10);
  const [interval, setInterval] = useState(60);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pinIds, setPinIds] = useState<Record<string, string>>({});
  const initialized = useRef(false);
  const requestId = useRef(0);

  useEffect(() => { setAllowed(getUserEmail()?.trim().toLowerCase() === "khalil@gmail.com"); }, []);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const [settings, page] = await Promise.all([
      api.getPinterestPublisher(siteId), api.getPinterestPublishingItems(siteId, filter, offset),
    ]);
    if (id !== requestId.current) return;
    setPublisher(settings);
    setItems(page.items);
    setTotal(page.total);
    if (!initialized.current) {
      setDaily(settings.daily_limit);
      setInterval(settings.interval_minutes);
      initialized.current = true;
    }
    setError("");
  }, [siteId, filter, offset]);

  useEffect(() => {
    initialized.current = false;
    setPublisher(null);
    setItems([]);
    setOffset(0);
    setFilter("");
  }, [siteId]);

  useEffect(() => {
    if (!allowed || !siteId) { setLoading(false); return; }
    let disposed = false;
    setLoading(true);
    const refresh = async () => {
      try { await load(); }
      catch (e) { if (!disposed) setError(e instanceof Error ? e.message : "Could not load publishing"); }
      finally { if (!disposed) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => { disposed = true; requestId.current++; window.clearInterval(timer); };
  }, [allowed, siteId, load]);

  useEffect(() => {
    if (!allowed || !siteId) return;
    let disposed = false;
    void api.syncPinterestPublishingItems(siteId).then(() => { if (!disposed) return load(); })
      .catch((e) => { if (!disposed) setError(e instanceof Error ? e.message : "Could not sync worksheet items"); });
    return () => { disposed = true; };
    // Queue sync is per website; filters only reload the displayed page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, siteId]);

  const act = async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try { await operation(); await load(); if (success) toast.success(success); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Operation failed"); }
    finally { setBusy(false); }
  };

  const connect = () => act(async () => {
    const result = await api.getPinterestPublishingAuthUrl(siteId);
    sessionStorage.setItem(`pinterest_publishing_oauth:${result.state}`, siteId);
    window.location.assign(result.url);
  });
  const save = (enabled: boolean) => act(async () => {
    if (!Number.isInteger(daily) || daily < 1 || daily > 1000 || !Number.isInteger(interval) || interval < 1 || interval > 10080) {
      throw new Error("Use 1–1,000 pins per day and an interval of 1–10,080 minutes.");
    }
    await api.savePinterestPublishingSettings(siteId, { daily_limit: daily, interval_minutes: interval, enabled });
  }, enabled ? "Publishing settings saved. Automatic publishing is running." : "Publishing settings saved. Automatic publishing is stopped.");

  const retry = async (item: PinterestPublicationOut) => {
    if (!item.retry_safe && !await confirm({ title: "Verify this pin on Pinterest first", message:
      "Pinterest may already have created this pin. If it exists, cancel and save its Pin ID below. Retry only after checking the board and confirming that no pin was created.",
      confirmLabel: "I checked — no pin exists", danger: true })) return;
    await act(() => api.retryPinterestPublication(siteId, item.id, !item.retry_safe), "Item returned to the queue. Daily limits and publication intervals still apply.");
  };

  if (allowed === null) return <div className="p-8"><Loader2 className="animate-spin" /></div>;
  if (!allowed || !siteId) return <div className="mx-auto max-w-xl p-10 text-center">
    <Globe2 size={36} className="mx-auto mb-4 text-gray-500" />
    <h1 className="text-xl font-semibold">{allowed ? "Select a website first" : "Publishing is unavailable"}</h1>
    <p className="mt-3 text-gray-400">{allowed ? "Choose the website you want to work with on the Pinterest page." : "This account does not have access to automatic Pinterest publishing."}</p>
    <Link className="mt-6 inline-block text-red-400 hover:underline" href="/pinterest-gallery">Back to Pinterest</Link>
  </div>;
  const gallery = publisher ? `/pinterest-gallery?project_id=${publisher.project_id}&site_id=${siteId}` : "/pinterest-gallery";

  return <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-8">
    <Link href={gallery} className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft size={15} /> Pinterest gallery</Link>
    <header className="mt-6 flex flex-wrap items-end justify-between gap-5 border-b border-gray-800 pb-7">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-red-400">Pinterest / Publishing</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">A steady rhythm for your pins.</h1>
        <p className="mt-3 flex items-center gap-2 text-gray-400"><Globe2 size={16} />{publisher?.domain || "Loading website…"}</p>
      </div>
      {publisher && <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm ${publisher.enabled ? colors.published : colors.pending}`}>
        <span className={`h-2 w-2 rounded-full ${publisher.enabled ? "bg-emerald-400" : "bg-gray-500"}`} />{publisher.enabled ? "Automatic publishing is on" : "Automatic publishing is off"}
      </span>}
    </header>
    {error && <div role="alert" className="mt-6 rounded-xl border border-amber-700/50 bg-amber-950/30 p-4 text-sm text-amber-200">{error}
      <button className="ml-4 underline" onClick={() => void act(load)}>Try again</button></div>}
    {loading && !publisher && <div className="flex items-center gap-3 py-16 text-gray-400"><Loader2 className="animate-spin" /> Loading publishing settings…</div>}
    {publisher && <>
      <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_1.5fr]">
        <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6">
          <p className="text-xs font-medium uppercase tracking-widest text-gray-500">01 / Account</p>
          <h2 className="mt-4 text-xl font-semibold">{publisher.connected ? `@${publisher.username}` : "Connect your Pinterest"}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">{publisher.connected ? `Connected for ${publisher.domain}. This website has its own queue and publishing settings.` : "Authorize your Pinterest account to publish the pin images and article links from this website."}</p>
          {!publisher.configured && <p className="mt-3 text-sm text-amber-300">Pinterest connection is not available yet. The server needs its Pinterest app credentials.</p>}
          <div className="mt-5 flex flex-wrap gap-3">
            <button disabled={busy || !publisher.configured} onClick={() => void connect()} className="rounded-lg bg-[#E60023] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c90020] disabled:opacity-40">{publisher.connected ? "Reconnect Pinterest" : "Connect Pinterest account"}</button>
            {publisher.connected && <button disabled={busy} onClick={() => void act(() => api.disconnectPinterestPublisher(siteId), "Pinterest disconnected. Publishing history is preserved.")} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 disabled:opacity-40">Disconnect</button>}
          </div>
          <p className="mt-5 flex items-center gap-2 text-xs text-gray-500"><ShieldCheck size={15} /> Secure account connection</p>
        </section>
        <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6">
          <p className="text-xs font-medium uppercase tracking-widest text-gray-500">02 / Publishing rhythm</p>
          <form onSubmit={(e) => { e.preventDefault(); void save(publisher.enabled); }}>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <label className="text-sm text-gray-300">Pins per day<input type="number" min={1} max={1000} step={1} required value={Number.isNaN(daily) ? "" : daily} onChange={(e) => setDaily(e.target.valueAsNumber)} className="mt-2 block w-full rounded-xl border-gray-700 bg-gray-950 px-4 py-3 text-xl text-white" /></label>
              <label className="text-sm text-gray-300">Interval between pins (minutes)<input type="number" min={1} max={10080} step={1} required value={Number.isNaN(interval) ? "" : interval} onChange={(e) => setInterval(e.target.valueAsNumber)} className="mt-2 block w-full rounded-xl border-gray-700 bg-gray-950 px-4 py-3 text-xl text-white" /></label>
            </div>
            <p className="mt-3 text-xs leading-5 text-gray-500">Daily limits reset at midnight UTC. The interval still applies across midnight. Publishing continues when you close this page.</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button disabled={busy} type="submit" className="rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-200 disabled:opacity-40">Save settings</button>
              <button disabled={busy || !publisher.connected} type="button" onClick={() => {
                if (publisher.enabled) void act(() => api.savePinterestPublishingSettings(siteId, { daily_limit: publisher.daily_limit, interval_minutes: publisher.interval_minutes, enabled: false }), "Automatic publishing stopped. Any pin already sent to Pinterest will finish.");
                else void save(true);
              }} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-gray-950 disabled:opacity-40">
                {busy ? <Loader2 size={16} className="animate-spin" /> : publisher.enabled ? <Pause size={16} /> : <Play size={16} />}{publisher.enabled ? "Stop publishing" : "Start publishing"}
              </button>
            </div>
          </form>
        </section>
      </div>
      {publisher.last_error && <p role="status" className="mt-5 rounded-xl border border-amber-800/50 bg-amber-950/20 p-4 text-sm text-amber-200">{publisher.last_error}</p>}
      {publisher.connected && <>
        <div className="my-7 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {(Object.keys(labels) as PinterestPublicationStatus[]).map((status) => <button key={status} onClick={() => { setFilter(filter === status ? "" : status); setOffset(0); }} className={`rounded-xl border p-4 text-left transition ${filter === status ? "border-red-500 bg-red-500/5" : "border-gray-800 hover:border-gray-600"}`}>
            <p className="text-2xl font-semibold tabular-nums">{publisher.counts[status]}</p><p className="mt-1 text-xs text-gray-400">{labels[status]}</p>
          </button>)}
          <div className="rounded-xl border border-gray-800 p-4"><p className="text-2xl font-semibold tabular-nums">{publisher.daily_usage}<span className="text-base text-gray-500"> / {publisher.daily_limit}</span></p><p className="mt-1 text-xs text-gray-400">Today · includes unconfirmed pins</p></div>
        </div>
        <section className="overflow-hidden rounded-2xl border border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-800 p-5">
            <div><h2 className="text-lg font-semibold">Worksheet items <span className="ml-2 text-sm font-normal text-gray-500">{total}</span></h2><p className="mt-1 text-xs text-gray-500">The same pin content as this website’s Pinterest gallery. Published items stay in your history.</p></div>
            <div className="flex items-center gap-3"><select aria-label="Filter publishing status" value={filter} onChange={(e) => { setFilter(e.target.value); setOffset(0); }} className="rounded-lg border-gray-700 bg-gray-900 text-sm"><option value="">All statuses</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <button disabled={busy} onClick={() => void act(() => api.syncPinterestPublishingItems(siteId))} className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white disabled:opacity-40"><RefreshCw size={15} /> Refresh</button></div>
          </div>
          {items.length === 0 ? <div className="p-12 text-center"><CheckCircle2 className="mx-auto mb-3 text-gray-600" size={32} /><p className="text-gray-300">{filter ? `No ${filter} items.` : "Your queue is ready for its first pin."}</p><p className="mt-2 text-sm text-gray-500">Create pin content for this website in the Pinterest gallery.</p></div> :
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-gray-900/60 text-xs text-gray-500"><tr>{["Pin", "Board / destination", "Status", "Publication"].map((label) => <th key={label} className="px-5 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-800">{items.map((item) => <tr key={item.id} className="align-top hover:bg-gray-900/30">
                <td className="max-w-md p-5"><div className="flex gap-4">{(safeUrl(item.image_url) || /^data:image\/(png|jpeg);base64,/.test(item.image_url)) ? <img src={item.image_url} alt="" loading="lazy" className="h-24 w-16 shrink-0 rounded-lg bg-gray-800 object-cover" /> : <div className="flex h-24 w-16 shrink-0 items-center rounded-lg bg-gray-800 p-2 text-center text-xs text-gray-500">No pin image</div>}
                  <div><p className="font-medium text-gray-200">{item.title || "Untitled pin"}</p><p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-500">{item.description || "No description"}</p>{item.keywords && <p className="mt-2 text-xs text-gray-400">{item.keywords}</p>}</div></div></td>
                <td className="max-w-[230px] p-5"><p className="text-gray-300">{item.board_name || "Board name needed"}</p>{safeUrl(item.article_url) ? <a href={item.article_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-red-400 hover:underline">View article <ExternalLink size={12} /></a> : <p className="mt-3 text-xs text-amber-400">Article URL needed</p>}</td>
                <td className="max-w-xs p-5"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${colors[item.status]}`}>{labels[item.status]}</span>
                  {item.error && <p className="mt-3 text-xs leading-5 text-amber-300">{item.error}</p>}{item.next_retry_at && <p className="mt-2 text-xs text-gray-500">Retry after {date(item.next_retry_at)}</p>}
                  {item.status === "failed" && <div className="mt-3 space-y-3"><button disabled={busy} onClick={() => void retry(item)} className="text-xs text-gray-300 underline disabled:opacity-40">{item.retry_safe ? "Retry item" : "Verify before retrying"}</button>
                    {!item.retry_safe && <div><label className="text-xs text-gray-400">Already on Pinterest? Save its Pin ID<input aria-label={`Existing Pin ID for ${item.title}`} value={pinIds[item.id] || ""} onChange={(e) => setPinIds((old) => ({ ...old, [item.id]: e.target.value }))} inputMode="numeric" className="mt-2 w-full rounded-lg border-gray-700 bg-gray-950 text-xs" /></label>
                      <button disabled={busy || !/^\d+$/.test(pinIds[item.id] || "")} onClick={() => void act(() => api.reconcilePinterestPublication(siteId, item.id, pinIds[item.id]), "Published pin verified and saved.")} className="mt-2 text-xs text-red-400 disabled:opacity-40">Verify & save Pin ID</button></div>}
                  </div>}
                </td>
                <td className="p-5 text-xs text-gray-500">{item.pin_id ? <><a href={`https://www.pinterest.com/pin/${encodeURIComponent(item.pin_id)}/`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-400 hover:underline">View pin <ExternalLink size={12} /></a><p className="mt-2">ID {item.pin_id}</p><p className="mt-2">{date(item.published_at)}</p></> : <><p>{item.attempt_count} attempts</p>{item.attempted_at && <p className="mt-2">Last attempt {date(item.attempted_at)}</p>}</>}</td>
              </tr>)}</tbody></table></div>}
          <div className="flex items-center justify-between border-t border-gray-800 px-5 py-4 text-xs text-gray-500"><span>{total ? `${offset + 1}–${Math.min(offset + 50, total)} of ${total}` : "0 items"}</span><div className="flex gap-4"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="disabled:opacity-30">Previous</button><button disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)} className="disabled:opacity-30">Next</button></div></div>
        </section>
        {publisher.enabled && <p className="mt-4 flex items-center gap-2 text-xs text-gray-500"><Clock3 size={14} />Next eligible publication: {date(publisher.next_publication_at)}. Requires a ready item; checks run every 30 seconds.</p>}
      </>}
    </>}
  </div>;
}

export default function Page() {
  return <Suspense fallback={<div className="p-8"><Loader2 className="animate-spin" /></div>}><PublishingPage /></Suspense>;
}
