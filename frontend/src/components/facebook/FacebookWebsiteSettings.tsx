"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Save,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { api, SiteOut } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";

type WpUser = { username: string; password: string };
type WebsiteForm = {
  domain: string;
  wp_url: string;
  pinterest_url: string;
  image_mode: string;
  embed_pin_in_article: boolean;
  generate_recipe_json: boolean;
  wp_users: WpUser[];
};

const emptyForm = (): WebsiteForm => ({
  domain: "",
  wp_url: "",
  pinterest_url: "",
  image_mode: "featured_and_top",
  embed_pin_in_article: false,
  generate_recipe_json: true,
  wp_users: [{ username: "", password: "" }],
});

export default function FacebookWebsiteSettings({
  contentProjectId,
  onChanged,
}: {
  contentProjectId: string;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [site, setSite] = useState<SiteOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [form, setForm] = useState<WebsiteForm>(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const sites = await api.getSites(contentProjectId);
      const first = sites[0] || null;
      setSite(first);
      if (first) {
        setForm({
          domain: first.domain,
          wp_url: first.wp_url,
          pinterest_url: first.pinterest_url || "",
          image_mode: first.image_mode || "featured_and_top",
          embed_pin_in_article: first.embed_pin_in_article,
          generate_recipe_json: first.generate_recipe_json,
          wp_users: first.wp_users.length
            ? first.wp_users.map((user) => ({ username: user.username, password: "" }))
            : [{ username: "", password: "" }],
        });
      } else {
        setForm(emptyForm());
        setEditing(true);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load website");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [contentProjectId]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const users = form.wp_users.filter((item) => item.username.trim() && (site || item.password));
    if (!users.length) {
      toast.warning("Add at least one WordPress user.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        domain: form.domain.trim(),
        wp_url: form.wp_url.trim(),
        pinterest_url: form.pinterest_url.trim(),
        image_mode: form.image_mode,
        embed_pin_in_article: form.embed_pin_in_article,
        generate_recipe_json: form.generate_recipe_json,
        wp_users: users.map((item) => ({
          username: item.username.trim(),
          password: item.password,
        })),
      };
      const updated = site
        ? await api.updateSite(site.id, payload)
        : await api.createSite(contentProjectId, payload);
      setSite(updated);
      setEditing(false);
      setTestResult(null);
      onChanged?.();
      toast.success(site ? "Website settings saved" : "Website connected");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save website");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!site) return;
    const accepted = await confirm({
      message: "Remove this website and its generated recipe records?",
      confirmLabel: "Remove website",
      danger: true,
    });
    if (!accepted) return;
    await api.deleteSite(site.id);
    setSite(null);
    setForm(emptyForm());
    setEditing(true);
    onChanged?.();
  };

  const test = async () => {
    if (!site) return;
    setTesting(true);
    try {
      setTestResult(await api.testConnection(site.id));
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : "Connection failed" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-48 place-items-center rounded-2xl border border-slate-800 bg-[#101827]">
        <Loader2 className="animate-spin text-[#68a8ff]" />
      </div>
    );
  }

  if (site && !editing) {
    return (
      <div className="overflow-hidden rounded-[20px] border border-slate-800 bg-[#101827]">
        <div className="flex flex-col gap-4 border-b border-slate-800 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-400">
              <Globe2 size={22} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white">{site.domain}</h3>
                <CheckCircle2 size={15} className="text-emerald-400" />
              </div>
              <p className="mt-1 text-sm text-slate-500">{site.wp_url}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={test} disabled={testing} className="btn-secondary inline-flex items-center gap-2">
              {testing ? <Loader2 size={15} className="animate-spin" /> : <Wifi size={15} />}
              Test connection
            </button>
            <button onClick={() => setEditing(true)} className="btn-secondary inline-flex items-center gap-2">
              <Pencil size={15} /> Edit
            </button>
            <button onClick={remove} className="rounded-lg border border-red-900/50 p-2.5 text-red-400 transition hover:bg-red-500/10">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        {testResult && (
          <div className={`border-b px-5 py-3 text-sm ${testResult.ok ? "border-emerald-900/30 bg-emerald-950/20 text-emerald-300" : "border-red-900/30 bg-red-950/20 text-red-300"}`}>
            {testResult.message}
          </div>
        )}
        <div className="grid gap-px bg-slate-800 md:grid-cols-3">
          <div className="bg-[#101827] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Article image</p>
            <p className="mt-2 text-sm text-slate-300">
              {site.image_mode === "featured_only" ? "Featured only" : "Featured + article top"}
            </p>
          </div>
          <div className="bg-[#101827] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Recipe JSON</p>
            <p className="mt-2 text-sm text-slate-300">{site.generate_recipe_json ? "Enabled" : "Disabled"}</p>
          </div>
          <div className="bg-[#101827] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">WordPress users</p>
            <p className="mt-2 text-sm text-slate-300">{site.wp_users.length} configured</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="overflow-hidden rounded-[20px] border border-slate-800 bg-[#101827]">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <div>
          <h3 className="font-semibold text-white">{site ? "Edit website" : "Connect your website"}</h3>
          <p className="mt-1 text-xs text-slate-500">The article is published here before the Facebook post goes live.</p>
        </div>
        {site && (
          <button type="button" onClick={() => setEditing(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white">
            <X size={17} />
          </button>
        )}
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-300">Domain</label>
          <input value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} required className="input-field" placeholder="example.com" />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-300">WordPress URL</label>
          <input value={form.wp_url} onChange={(event) => setForm({ ...form, wp_url: event.target.value })} required className="input-field" placeholder="https://example.com" />
        </div>
        <div className="md:col-span-2">
          <label className="mb-2 block text-sm font-medium text-slate-300">Pinterest Account URL</label>
          <input value={form.pinterest_url} onChange={(event) => setForm({ ...form, pinterest_url: event.target.value })} className="input-field" placeholder="https://www.pinterest.com/youraccount/" />
        </div>
        <div className="md:col-span-2">
          <label className="mb-2 block text-sm font-medium text-slate-300">Article Image Mode</label>
          <select value={form.image_mode} onChange={(event) => setForm({ ...form, image_mode: event.target.value })} className="input-field">
            <option value="featured_and_top">Featured image + top image in article</option>
            <option value="featured_only">Featured image only (clean article body)</option>
          </select>
        </div>

        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-slate-950/30 p-4">
          <span>
            <span className="block text-sm font-medium text-slate-300">Embed pin image in article</span>
            <span className="mt-1 block text-xs text-slate-600">Insert the Pin Designer image in article content.</span>
          </span>
          <input type="checkbox" checked={form.embed_pin_in_article} onChange={(event) => setForm({ ...form, embed_pin_in_article: event.target.checked })} className="rounded border-slate-600 bg-slate-900 text-[#1877f2]" />
        </label>
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-slate-950/30 p-4">
          <span>
            <span className="block text-sm font-medium text-slate-300">Generate WP Recipe JSON</span>
            <span className="mt-1 block text-xs text-slate-600">Create WordPress Recipe Maker data.</span>
          </span>
          <input type="checkbox" checked={form.generate_recipe_json} onChange={(event) => setForm({ ...form, generate_recipe_json: event.target.checked })} className="rounded border-slate-600 bg-slate-900 text-[#1877f2]" />
        </label>

        <div className="md:col-span-2">
          <label className="mb-2 block text-sm font-medium text-slate-300">WP Users</label>
          <div className="space-y-2">
            {form.wp_users.map((wpUser, index) => (
              <div key={index} className="flex gap-2">
                <input
                  value={wpUser.username}
                  onChange={(event) => setForm({ ...form, wp_users: form.wp_users.map((item, itemIndex) => itemIndex === index ? { ...item, username: event.target.value } : item) })}
                  required
                  className="input-field"
                  placeholder="Username"
                />
                <input
                  type="password"
                  value={wpUser.password}
                  onChange={(event) => setForm({ ...form, wp_users: form.wp_users.map((item, itemIndex) => itemIndex === index ? { ...item, password: event.target.value } : item) })}
                  required={!site}
                  className="input-field"
                  placeholder={site ? "Leave blank to keep current" : "Application password"}
                />
                {form.wp_users.length > 1 && (
                  <button type="button" onClick={() => setForm({ ...form, wp_users: form.wp_users.filter((_, itemIndex) => itemIndex !== index) })} className="rounded-lg border border-slate-700 p-3 text-slate-500 hover:text-red-400">
                    <Minus size={16} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setForm({ ...form, wp_users: [...form.wp_users, { username: "", password: "" }] })} className="inline-flex items-center gap-2 text-sm text-[#68a8ff] hover:text-white">
              <Plus size={15} /> Add another user
            </button>
          </div>
        </div>
      </div>
      <div className="flex justify-end border-t border-slate-800 bg-slate-950/20 px-5 py-4">
        <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2f86f6] disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? "Saving…" : site ? "Save website" : "Connect website"}
        </button>
      </div>
    </form>
  );
}
