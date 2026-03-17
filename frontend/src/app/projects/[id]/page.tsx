"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Globe, Users, Briefcase, Plus, Trash2, ArrowLeft, Download, Send, Info, X, Pencil, Minus, Settings, Key, MessageSquare, Bot, Image as ImageIcon, FileJson, Shield, Save } from "lucide-react";
import { api, ProjectOut, SiteOut, MemberOut, JobOut, UserOut, CredentialOut, PromptOut } from "@/lib/api";
import { getUserRole } from "@/lib/auth";

type Tab = "sites" | "members" | "jobs" | "settings";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const role = getUserRole();
  const [project, setProject] = useState<ProjectOut | null>(null);
  const [tab, setTab] = useState<Tab>("sites");

  useEffect(() => {
    api.getProject(id).then(setProject).catch(() => router.push("/projects"));
  }, [id, router]);

  if (!project) return <div className="text-gray-400">Loading...</div>;

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "sites", label: "Sites", icon: Globe },
    { key: "members", label: "Members", icon: Users },
    { key: "jobs", label: "Jobs", icon: Briefcase },
    ...(role === "owner" ? [{ key: "settings" as Tab, label: "Settings", icon: Settings }] : []),
  ];

  return (
    <div>
      <button onClick={() => router.push("/projects")} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4">
        <ArrowLeft size={16} /> Back to Projects
      </button>

      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">{project.name}</h1>
          {project.description && <p className="text-sm text-gray-400 mt-1">{project.description}</p>}
          <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-400">
            <span>{project.site_count} sites</span>
            <span>{project.member_count} members</span>
            <span>{project.recipe_count} recipes</span>
            <span>{project.job_count} jobs</span>
          </div>
        </div>
        <button
          onClick={() => window.open(api.getProjectExcelExportUrl(id), "_blank")}
          disabled={project.recipe_count === 0}
          className="btn-secondary flex items-center gap-2 border-green-700 text-green-400 hover:text-green-300 disabled:opacity-40 disabled:cursor-not-allowed self-start flex-shrink-0"
          title="Export all sites as Excel — same format as V1 Project"
        >
          <Download size={16} /> Export All Excel
        </button>
      </div>

      <div className="flex gap-1 border-b border-gray-800 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.key ? "border-brand-500 text-brand-400" : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "sites" && <SitesTab projectId={id} role={role} router={router} />}
      {tab === "members" && <MembersTab projectId={id} role={role} />}
      {tab === "jobs" && <JobsTab projectId={id} />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

const MAX_SITES_PER_PROJECT = 4;

const emptyWpUser = () => ({ username: "", password: "" });

function SitesTab({ projectId, role, router }: { projectId: string; role: string | null; router: ReturnType<typeof useRouter> }) {
  const [sites, setSites] = useState<SiteOut[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ domain: "", wp_url: "", wp_users: [emptyWpUser()] as { username: string; password: string }[] });
  const [loading, setLoading] = useState(false);
  const [publishingSiteId, setPublishingSiteId] = useState<string | null>(null);
  const [detailsSite, setDetailsSite] = useState<SiteOut | null>(null);
  const [editSite, setEditSite] = useState<SiteOut | null>(null);
  const [editForm, setEditForm] = useState({ domain: "", wp_url: "", wp_users: [emptyWpUser()] as { username: string; password: string }[] });
  const [editing, setEditing] = useState(false);

  const load = () => api.getSites(projectId).then(setSites).catch(() => {});
  useEffect(() => { load(); }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sites.length >= MAX_SITES_PER_PROJECT) {
      alert(`Un projet peut contenir au maximum ${MAX_SITES_PER_PROJECT} sites.`);
      return;
    }
    const validUsers = form.wp_users.filter((u) => u.username.trim() && u.password);
    if (!validUsers.length) {
      alert("Add at least one WP user with username and password.");
      return;
    }
    setLoading(true);
    try {
      await api.createSite(projectId, { ...form, wp_users: validUsers });
      setForm({ domain: "", wp_url: "", wp_users: [emptyWpUser()] });
      setShow(false);
      load();
    } catch {}
    setLoading(false);
  };

  const handlePublishToWordPress = async (siteId: string) => {
    setPublishingSiteId(siteId);
    try {
      const job = await api.startJob(projectId, { job_type: "publisher", site_id: siteId });
      router.push(`/jobs/${job.id}`);
    } catch (e: any) {
      alert(e.message || "Failed to start publish job");
    } finally {
      setPublishingSiteId(null);
    }
  };

  const handleDelete = async (siteId: string) => {
    if (!confirm("Delete this site and all its recipes?")) return;
    await api.deleteSite(siteId);
    load();
  };

  const openEdit = (s: SiteOut) => {
    setEditSite(s);
    const wpUsers = (s as any).wp_users?.length
      ? (s as any).wp_users.map((u: { username: string }) => ({ username: u.username, password: "" }))
      : [{ username: (s as any).wp_username || "", password: "" }];
    setEditForm({
      domain: s.domain,
      wp_url: s.wp_url,
      wp_users: wpUsers.length ? wpUsers : [emptyWpUser()],
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSite) return;
    const validUsers = editForm.wp_users.filter((u) => u.username.trim());
    if (!validUsers.length) {
      alert("Add at least one WP user.");
      return;
    }
    setEditing(true);
    try {
      const data: Record<string, unknown> = {
        domain: editForm.domain,
        wp_url: editForm.wp_url,
        wp_users: validUsers.map((u) => ({ username: u.username, password: u.password })),
      };
      await api.updateSite(editSite.id, data);
      setEditSite(null);
      load();
    } catch (err: any) {
      alert(err.message || "Failed to update site");
    }
    setEditing(false);
  };

  const canAddSite = (role === "owner" || role === "admin") && sites.length < MAX_SITES_PER_PROJECT;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {canAddSite && (
          <button onClick={() => setShow(!show)} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Add Site
          </button>
        )}
        {sites.length >= MAX_SITES_PER_PROJECT && (role === "owner" || role === "admin") && (
          <span className="text-sm text-amber-400">Maximum {MAX_SITES_PER_PROJECT} sites par projet</span>
        )}
        {(role === "owner" || role === "admin") && (
          <button
            onClick={() => router.push(`/projects/${projectId}/sites/all-sites-generate`)}
            disabled={sites.length === 0}
            className="btn-secondary flex items-center gap-2 border-brand-700 text-brand-400 hover:text-brand-300 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Open all-sites generation page"
          >
            <Send size={18} /> Generate All Sites
          </button>
        )}
      </div>

      {show && (
        <form onSubmit={handleCreate} className="card mb-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Domain</label>
            <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} required className="input-field" placeholder="example.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">WordPress URL</label>
            <input value={form.wp_url} onChange={(e) => setForm({ ...form, wp_url: e.target.value })} required className="input-field" placeholder="https://example.com/xmlrpc.php" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-1">WP Users (one randomly selected per publish)</label>
            <div className="space-y-2">
              {form.wp_users.map((u, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={u.username}
                    onChange={(e) => setForm({ ...form, wp_users: form.wp_users.map((x, j) => j === i ? { ...x, username: e.target.value } : x) })}
                    className="input-field flex-1"
                    placeholder="Username"
                    required
                  />
                  <input
                    type="password"
                    value={u.password}
                    onChange={(e) => setForm({ ...form, wp_users: form.wp_users.map((x, j) => j === i ? { ...x, password: e.target.value } : x) })}
                    className="input-field flex-1"
                    placeholder="Password"
                    required
                  />
                  {form.wp_users.length > 1 && (
                    <button type="button" onClick={() => setForm({ ...form, wp_users: form.wp_users.filter((_, j) => j !== i) })} className="text-gray-500 hover:text-red-400 p-2">
                      <Minus size={16} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setForm({ ...form, wp_users: [...form.wp_users, emptyWpUser()] })} className="text-sm text-brand-400 hover:text-brand-300 flex items-center gap-1">
                <Plus size={14} /> Add another user
              </button>
            </div>
          </div>
          <div className="col-span-2">
            <button type="submit" disabled={loading} className="btn-primary">{loading ? "Adding..." : "Add Site"}</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {sites.map((s) => (
          <div key={s.id} className="card flex items-center justify-between">
            <Link href={`/projects/${projectId}/sites/${s.id}`} className="flex-1 min-w-0">
              <h3 className="font-semibold text-white hover:text-brand-400 transition">{s.domain}</h3>
              <p className="text-sm text-gray-400 truncate">{s.wp_url} &middot; {(s as any).wp_users?.length || 1} user(s) &middot; {s.recipe_count} recipes</p>
            </Link>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setDetailsSite(s)}
                className="text-gray-400 hover:text-brand-400 transition p-2"
                title="Site details"
              >
                <Info size={16} />
              </button>
              {(role === "owner" || role === "admin") && (
                <button
                  onClick={() => openEdit(s)}
                  className="text-gray-400 hover:text-brand-400 transition p-2"
                  title="Edit site"
                >
                  <Pencil size={16} />
                </button>
              )}
              <button
                onClick={() => handlePublishToWordPress(s.id)}
                disabled={publishingSiteId === s.id || s.recipe_count === 0}
                className="text-gray-400 hover:text-green-400 transition p-2 disabled:opacity-40"
                title="Publish to WordPress"
              >
                <Send size={16} />
              </button>
              {(role === "owner" || role === "admin") && (
                <button onClick={() => handleDelete(s.id)} className="text-gray-500 hover:text-red-400 transition p-2">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
        {sites.length === 0 && <p className="text-center py-8 text-gray-500">No sites added yet.</p>}
      </div>

      {detailsSite && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl border border-gray-700 max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Site details</h3>
              <button onClick={() => setDetailsSite(null)} className="text-gray-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Domain</dt>
                <dd className="text-white font-medium">{detailsSite.domain}</dd>
              </div>
              <div>
                <dt className="text-gray-500">WordPress URL</dt>
                <dd className="text-gray-300 break-all">{detailsSite.wp_url}</dd>
              </div>
              <div>
                <dt className="text-gray-500">WP Users</dt>
                <dd className="text-gray-300">
                  {((detailsSite as any).wp_users?.length
                    ? (detailsSite as any).wp_users.map((u: { username: string }) => u.username).join(", ")
                    : (detailsSite as any).wp_username || "—")}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Recipes</dt>
                <dd className="text-gray-300">{detailsSite.recipe_count}</dd>
              </div>
            </dl>
            <Link
              href={`/projects/${projectId}/sites/${detailsSite.id}`}
              className="mt-4 inline-flex items-center gap-2 text-brand-400 hover:text-brand-300"
            >
              View site →
            </Link>
          </div>
        </div>
      )}

      {editSite && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl border border-gray-700 max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Edit site</h3>
              <button onClick={() => setEditSite(null)} className="text-gray-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Domain</label>
                <input
                  value={editForm.domain}
                  onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })}
                  required
                  className="input-field w-full"
                  placeholder="example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">WordPress URL</label>
                <input
                  value={editForm.wp_url}
                  onChange={(e) => setEditForm({ ...editForm, wp_url: e.target.value })}
                  required
                  className="input-field w-full"
                  placeholder="https://example.com/xmlrpc.php"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">WP Users (blank password = keep current)</label>
                <div className="space-y-2">
                  {editForm.wp_users.map((u, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        value={u.username}
                        onChange={(e) => setEditForm({ ...editForm, wp_users: editForm.wp_users.map((x, j) => j === i ? { ...x, username: e.target.value } : x) })}
                        className="input-field flex-1"
                        placeholder="Username"
                        required
                      />
                      <input
                        type="password"
                        value={u.password}
                        onChange={(e) => setEditForm({ ...editForm, wp_users: editForm.wp_users.map((x, j) => j === i ? { ...x, password: e.target.value } : x) })}
                        className="input-field flex-1"
                        placeholder="•••• leave blank to keep"
                      />
                      {editForm.wp_users.length > 1 && (
                        <button type="button" onClick={() => setEditForm({ ...editForm, wp_users: editForm.wp_users.filter((_, j) => j !== i) })} className="text-gray-500 hover:text-red-400 p-2">
                          <Minus size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setEditForm({ ...editForm, wp_users: [...editForm.wp_users, emptyWpUser()] })} className="text-sm text-brand-400 hover:text-brand-300 flex items-center gap-1">
                    <Plus size={14} /> Add another user
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditSite(null)}
                  className="flex-1 py-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editing}
                  className="flex-1 btn-primary"
                >
                  {editing ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

function MembersTab({ projectId, role }: { projectId: string; role: string | null }) {
  const [members, setMembers] = useState<MemberOut[]>([]);
  const [users, setUsers] = useState<UserOut[]>([]);
  const [selUser, setSelUser] = useState("");
  const [selRole, setSelRole] = useState("member");

  const load = () => api.getMembers(projectId).then(setMembers).catch(() => {});
  useEffect(() => {
    load();
    if (role === "owner") api.getUsers().then(setUsers).catch(() => {});
  }, [projectId, role]);

  const handleAdd = async () => {
    if (!selUser) return;
    await api.addMember(projectId, selUser, selRole);
    setSelUser("");
    load();
  };

  const handleRemove = async (userId: string) => {
    if (!confirm("Remove this member?")) return;
    await api.removeMember(projectId, userId);
    load();
  };

  return (
    <div>
      {role === "owner" && (
        <div className="card mb-4 flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-300 mb-1">User</label>
            <select value={selUser} onChange={(e) => setSelUser(e.target.value)} className="input-field">
              <option value="">Select user...</option>
              {users.filter((u) => !members.find((m) => m.user_id === u.id)).map((u) => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
            <select value={selRole} onChange={(e) => setSelRole(e.target.value)} className="input-field">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button onClick={handleAdd} className="btn-primary">Add</button>
        </div>
      )}

      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.id} className="card flex items-center justify-between">
            <div>
              <span className="font-medium text-white">{m.full_name}</span>
              <span className="text-sm text-gray-400 ml-2">{m.email}</span>
              <span className={`ml-3 text-xs px-2 py-0.5 rounded ${m.role === "admin" ? "bg-purple-600/20 text-purple-400" : "bg-gray-700 text-gray-300"}`}>
                {m.role}
              </span>
            </div>
            {role === "owner" && (
              <button onClick={() => handleRemove(m.user_id)} className="text-gray-500 hover:text-red-400 p-2">
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
        {members.length === 0 && <p className="text-center py-8 text-gray-500">No members assigned yet.</p>}
      </div>
    </div>
  );
}

function JobsTab({ projectId }: { projectId: string }) {
  const [jobs, setJobs] = useState<JobOut[]>([]);
  useEffect(() => { api.getProjectJobs(projectId).then(setJobs).catch(() => {}); }, [projectId]);

  const statusColor: Record<string, string> = {
    pending: "bg-gray-700 text-gray-300",
    running: "bg-blue-600/20 text-blue-400",
    completed: "bg-green-600/20 text-green-400",
    failed: "bg-red-600/20 text-red-400",
    stopped: "bg-yellow-600/20 text-yellow-400",
  };

  return (
    <div className="space-y-3">
      {jobs.map((j) => (
        <Link key={j.id} href={`/jobs/${j.id}`} className="card block hover:border-gray-700 transition">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium text-white capitalize">{j.job_type}</span>
              <span className={`ml-3 text-xs px-2 py-0.5 rounded ${statusColor[j.status] || ""}`}>{j.status}</span>
            </div>
            <span className="text-xs text-gray-500">{new Date(j.created_at).toLocaleString()}</span>
          </div>
          {j.error && <p className="text-xs text-red-400 mt-1">{j.error}</p>}
        </Link>
      ))}
      {jobs.length === 0 && <p className="text-center py-8 text-gray-500">No jobs yet.</p>}
    </div>
  );
}

// ── Settings Tab ─────────────────────────────────────────────────────

const KEY_GROUPS = [
  {
    title: "ChatGPT / OpenAI",
    description: "Key for article and recipe generation",
    icon: Bot,
    keys: [
      { key: "openai", label: "OpenAI API Key", placeholder: "sk-...", type: "password", help: "API key from platform.openai.com" },
    ],
  },
  {
    title: "Midjourney (Discord)",
    description: "Discord configuration for Midjourney image generation",
    icon: ImageIcon,
    keys: [
      { key: "discord_auth", label: "Discord Authorization", placeholder: "Authorization token", type: "password" },
      { key: "discord_app_id", label: "Discord Application ID", placeholder: "App ID", type: "text" },
      { key: "discord_guild", label: "Discord Guild ID", placeholder: "Server ID", type: "text" },
      { key: "discord_channel", label: "Discord Channel ID", placeholder: "Channel ID", type: "text" },
      { key: "mj_version", label: "Midjourney Version", placeholder: "e.g. 6", type: "text" },
      { key: "mj_id", label: "Midjourney ID", placeholder: "Bot ID", type: "text" },
    ],
  },
  {
    title: "Google Sheets",
    description: "Service Account for Google Sheets sync (optional)",
    icon: FileJson,
    keys: [
      { key: "google_sa_json", label: "Service Account JSON", placeholder: "Paste full JSON...", type: "textarea" },
    ],
  },
];

const PROMPT_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Article generation", keys: ["article"] },
  { label: "Full recipe", keys: ["full_recipe_system", "full_recipe_user"] },
  { label: "Recipe JSON (WP Recipe Maker)", keys: ["recipe_json_system", "recipe_json_user"] },
  { label: "Meta description (SEO)", keys: ["meta_description_system", "meta_description_user"] },
  { label: "Category", keys: ["category_system", "category_user"] },
  { label: "Pinterest Pin title", keys: ["pinterest_title_system", "pinterest_title_user"] },
  { label: "Pinterest Pin description", keys: ["pinterest_description_system", "pinterest_description_user"] },
  { label: "Pinterest Pin tags", keys: ["pinterest_tags_system", "pinterest_tags_user"] },
  { label: "Midjourney image prompt", keys: ["midjourney_imagine"] },
];

type SettingsSubTab = "credentials" | "prompts";

function SettingsTab() {
  const [subTab, setSubTab] = useState<SettingsSubTab>("credentials");

  // Credentials
  const [creds, setCreds] = useState<CredentialOut[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Prompts
  const [prompts, setPrompts] = useState<PromptOut[]>([]);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});
  const [savingPrompts, setSavingPrompts] = useState(false);

  useEffect(() => {
    api.getSettingsCredentials().then(setCreds).catch(() => {});
  }, []);

  useEffect(() => {
    if (subTab === "prompts") {
      api.getSettingsPrompts()
        .then((list) => {
          setPrompts(list);
          setPromptValues(Object.fromEntries(list.map((p) => [p.key, p.value])));
        })
        .catch(() => {});
    }
  }, [subTab]);

  const handleSave = async () => {
    const toSave = Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([key_type, value]) => ({ key_type, value }));
    if (!toSave.length) return;
    setSaving(true);
    const updated = await api.setSettingsCredentials(toSave);
    setCreds(updated);
    setValues({});
    setSaving(false);
  };

  const handleSavePrompts = async () => {
    if (!Object.keys(promptValues).length) return;
    setSavingPrompts(true);
    try {
      const updated = await api.setSettingsPrompts(promptValues);
      setPrompts(updated);
    } catch { }
    setSavingPrompts(false);
  };

  const getMasked = (key: string) => creds.find((c) => c.key_type === key)?.masked_value || "Not configured";
  const hasChanges = Object.values(values).some((v) => v.trim());
  const hasPromptChanges = prompts.some((p) => (promptValues[p.key] ?? p.value) !== p.value);

  const subTabs = [
    { key: "credentials" as SettingsSubTab, label: "API Keys", icon: Key },
    { key: "prompts" as SettingsSubTab, label: "AI Prompts", icon: MessageSquare },
  ];

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-gray-700">
        {subTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
              subTab === t.key ? "border-brand-500 text-brand-400" : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {subTab === "credentials" && (
        <>
          <div className="card mb-4 flex items-start gap-3 p-4 border-amber-800/50 bg-amber-950/20">
            <Shield size={18} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-200/90">These keys are personal and shared across all your projects.</p>
          </div>
          {hasChanges && (
            <div className="flex justify-end mb-4">
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
                <Save size={16} /> {saving ? "Saving..." : "Save"}
              </button>
            </div>
          )}
          <div className="space-y-6">
            {KEY_GROUPS.map((group) => (
              <div key={group.title} className="card">
                <div className="flex items-start gap-3 mb-4">
                  <div className="h-9 w-9 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400 flex-shrink-0">
                    <group.icon size={18} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-white">{group.title}</h2>
                    <p className="text-xs text-gray-400">{group.description}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {group.keys.map((k) => (
                    <div key={k.key} className="border border-gray-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm font-medium text-gray-300">{k.label}</label>
                        <span className="text-xs font-mono text-gray-500">{getMasked(k.key)}</span>
                      </div>
                      {k.type === "textarea" ? (
                        <textarea
                          value={values[k.key] || ""}
                          onChange={(e) => setValues({ ...values, [k.key]: e.target.value })}
                          className="input-field h-20 font-mono text-xs resize-none"
                          placeholder={k.placeholder}
                        />
                      ) : (
                        <input
                          type={k.type}
                          value={values[k.key] || ""}
                          onChange={(e) => setValues({ ...values, [k.key]: e.target.value })}
                          className="input-field font-mono text-xs"
                          placeholder={k.placeholder}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {hasChanges && (
            <div className="sticky bottom-4 flex justify-end mt-6">
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 shadow-lg">
                <Save size={16} /> {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          )}
        </>
      )}

      {subTab === "prompts" && (
        <>
          {hasPromptChanges && (
            <div className="flex justify-end mb-4">
              <button onClick={handleSavePrompts} disabled={savingPrompts} className="btn-primary flex items-center gap-2">
                <Save size={16} /> {savingPrompts ? "Saving..." : "Save prompts"}
              </button>
            </div>
          )}
          <div className="space-y-4">
            {PROMPT_GROUPS.map((group) => (
              <div key={group.label} className="card">
                <h2 className="font-semibold text-white mb-3">{group.label}</h2>
                <div className="space-y-3">
                  {group.keys.map((key) => {
                    const p = prompts.find((x) => x.key === key);
                    return (
                      <div key={key} className="border border-gray-700 rounded-lg p-3">
                        <label className="text-xs font-mono text-gray-300 block mb-1.5">{key}</label>
                        <textarea
                          value={promptValues[key] ?? p?.value ?? ""}
                          onChange={(e) => setPromptValues({ ...promptValues, [key]: e.target.value })}
                          className="input-field w-full h-20 font-mono text-xs resize-y min-h-[72px]"
                          placeholder="Prompt..."
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {hasPromptChanges && (
            <div className="sticky bottom-4 flex justify-end mt-6">
              <button onClick={handleSavePrompts} disabled={savingPrompts} className="btn-primary flex items-center gap-2 shadow-lg">
                <Save size={16} /> {savingPrompts ? "Saving..." : "Save prompts"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
