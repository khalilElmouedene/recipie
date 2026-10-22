"use client";

import { useEffect, useState } from "react";
import { Cloud, CheckCircle, ExternalLink, Loader2, Save, FlaskConical } from "lucide-react";
import { api, ProjectOut } from "@/lib/api";
import AllSitesGenerator from "@/components/AllSitesGenerator";

export default function CloudflareArticlesPage() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectOut[]>([]);
  const [projectId, setProjectId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [savedAccountId, setSavedAccountId] = useState("");
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [testImage, setTestImage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await api.me();
        if (me.email.trim().toLowerCase() !== "khalil@gmail.com") {
          throw new Error("This page is only available to khalil@gmail.com.");
        }
        // Server checks the account independently before returning configuration.
        const [config, availableProjects] = await Promise.all([api.getCloudflareConfig(), api.getProjects()]);
        if (cancelled) return;
        setAuthorized(true);
        setProjects(availableProjects);
        setProjectId(availableProjects[0]?.id || "");
        setAccountId(config.account_id);
        setSavedAccountId(config.account_id);
        setConfigured(config.token_configured);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load Cloudflare settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const unsaved = accountId.trim() !== savedAccountId || Boolean(token.trim());
  const ready = configured && Boolean(savedAccountId);

  async function save() {
    if (busy) return;
    setBusy("save"); setError(""); setMessage(""); setTestImage("");
    try {
      const config = await api.setCloudflareConfig({ account_id: accountId.trim(), api_token: token.trim() });
      setSavedAccountId(config.account_id);
      setConfigured(config.token_configured);
      setToken("");
      setMessage("Cloudflare settings saved. Generate a test image to verify the connection.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save settings.");
    } finally { setBusy(null); }
  }

  async function test() {
    if (busy || unsaved) return;
    setBusy("test"); setError(""); setMessage(""); setTestImage("");
    try {
      const result = await api.testCloudflare();
      setTestImage(result.image_url);
      setMessage("Connection verified. Cloudflare generated and saved the test image.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cloudflare test failed.");
    } finally { setBusy(null); }
  }

  if (loading) return <div className="flex items-center gap-2 text-gray-400 p-8"><Loader2 className="animate-spin" size={18} /> Loading Cloudflare workspace…</div>;
  if (!authorized) return <div role="alert" className="card text-red-300">{error || "Access denied."}</div>;

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-orange-400/25 bg-gray-900 overflow-hidden">
        <div className="border-b border-orange-400/15 px-5 py-5 sm:px-7 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="rounded-xl bg-orange-400/10 p-3 text-orange-300 shrink-0"><Cloud size={28} /></div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-orange-300 mb-1">Private workspace · Khalil</p>
            <h1 className="text-2xl font-bold text-white">Your articles. Cloudflare images.</h1>
            <p className="text-sm text-gray-400 mt-1">FLUX.1 Schnell replaces Midjourney. Your text prompts, SEO, recipes and publishing settings stay the same.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-7 p-5 sm:p-7 lg:grid-cols-2">
          <div className="space-y-4 min-w-0">
            <h2 className="font-semibold text-white">1. Connect Workers AI</h2>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-400">
              <li>Open Cloudflare → Workers AI → Use REST API.</li>
              <li>Create a Workers AI API token with Read and Edit permissions for your account.</li>
              <li>Copy the Account ID and token below, save, then generate a test image.</li>
            </ol>
            <a href="https://developers.cloudflare.com/workers-ai/get-started/rest-api/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-orange-300 hover:underline">Cloudflare setup guide <ExternalLink size={13} /></a>
            <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 text-sm text-gray-400 space-y-2">
              <p><strong className="text-gray-200">10,000 free Neurons per day</strong>, shared across your Cloudflare account. Each recipe requests four images. The test requests one image and also uses the quota.</p>
              <p>The Free plan stops generation at the daily limit. A paid plan can charge for additional usage. Article text still uses your existing OpenAI key.</p>
              <a href="https://developers.cloudflare.com/workers-ai/platform/pricing/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-orange-300 hover:underline">Current quotas and pricing <ExternalLink size={13} /></a>
            </div>
          </div>

          <div className="space-y-4 min-w-0">
            <label className="block text-sm text-gray-300">Cloudflare Account ID
              <input value={accountId} onChange={(e) => setAccountId(e.target.value)} maxLength={32} autoComplete="off" spellCheck={false} className="input-field mt-2" placeholder="32-character account ID" />
            </label>
            <label className="block text-sm text-gray-300">Workers AI API token
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" className="input-field mt-2" placeholder={configured ? "Token saved · leave blank to keep it" : "Paste your Cloudflare API token"} />
            </label>
            <p className="text-xs text-gray-500">The token is encrypted on the server and is never returned to the browser.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={save} disabled={!!busy || !/^[a-fA-F0-9]{32}$/.test(accountId.trim()) || (!configured && !token.trim())} className="btn-primary flex items-center gap-2">{busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save settings</button>
              <button onClick={test} disabled={!!busy || !ready || unsaved} className="btn-secondary flex items-center gap-2">{busy === "test" ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />} Generate test image</button>
            </div>
            {unsaved && <p className="text-xs text-amber-300">Save your changes before testing the connection.</p>}
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            {message && <p role="status" className="text-sm text-emerald-300 flex items-start gap-2"><CheckCircle size={16} className="shrink-0 mt-0.5" />{message}</p>}
            {testImage && <img src={testImage} alt="Test image generated by Cloudflare: tomato soup" className="h-44 w-44 rounded-xl object-cover border border-gray-700" />}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <label className="block text-sm font-semibold text-gray-200">2. Choose your existing project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input-field sm:max-w-md mt-2">
            {!projects.length && <option value="">No projects available</option>}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <p className="text-sm text-gray-400">Use the same recipe inputs, Excel import, history, previews and WordPress publishing. FLUX creates images from the recipe text; the source image is kept with the input but is not an image reference for FLUX.</p>
        {ready && projectId ? <AllSitesGenerator key={projectId} projectId={projectId} imageProvider="cloudflare" /> : <div className="card text-gray-400">{!ready ? "Save your Cloudflare credentials above to open article generation." : "Create a project with at least one site to start generating articles."}</div>}
      </section>
    </div>
  );
}
