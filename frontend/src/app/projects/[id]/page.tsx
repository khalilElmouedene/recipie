"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Globe, Key, Users, Briefcase, Plus, Trash2, ArrowLeft } from "lucide-react";
import { api, ProjectOut, SiteOut, CredentialOut, MemberOut, JobOut, UserOut } from "@/lib/api";
import { getUserRole } from "@/lib/auth";

type Tab = "sites" | "credentials" | "members" | "jobs";

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
    { key: "credentials", label: "Credentials", icon: Key },
    { key: "members", label: "Members", icon: Users },
    { key: "jobs", label: "Jobs", icon: Briefcase },
  ];

  return (
    <div>
      <button onClick={() => router.push("/projects")} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4">
        <ArrowLeft size={16} /> Back to Projects
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{project.name}</h1>
        {project.description && <p className="text-sm text-gray-400 mt-1">{project.description}</p>}
        <div className="flex gap-6 mt-3 text-sm text-gray-400">
          <span>{project.site_count} sites</span>
          <span>{project.member_count} members</span>
          <span>{project.recipe_count} recipes</span>
          <span>{project.job_count} jobs</span>
        </div>
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

      {tab === "sites" && <SitesTab projectId={id} role={role} />}
      {tab === "credentials" && <CredentialsTab projectId={id} role={role} />}
      {tab === "members" && <MembersTab projectId={id} role={role} />}
      {tab === "jobs" && <JobsTab projectId={id} />}
    </div>
  );
}

function SitesTab({ projectId, role }: { projectId: string; role: string | null }) {
  const [sites, setSites] = useState<SiteOut[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ domain: "", wp_url: "", wp_username: "", wp_password: "", sheet_name: "", spreadsheet_id: "" });
  const [loading, setLoading] = useState(false);

  const load = () => api.getSites(projectId).then(setSites).catch(() => {});
  useEffect(() => { load(); }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.createSite(projectId, form);
      setForm({ domain: "", wp_url: "", wp_username: "", wp_password: "", sheet_name: "", spreadsheet_id: "" });
      setShow(false);
      load();
    } catch {}
    setLoading(false);
  };

  const handleDelete = async (siteId: string) => {
    if (!confirm("Delete this site and all its recipes?")) return;
    await api.deleteSite(siteId);
    load();
  };

  return (
    <div>
      {(role === "owner" || role === "admin") && (
        <button onClick={() => setShow(!show)} className="btn-primary flex items-center gap-2 mb-4">
          <Plus size={18} /> Add Site
        </button>
      )}

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
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">WP Username</label>
            <input value={form.wp_username} onChange={(e) => setForm({ ...form, wp_username: e.target.value })} required className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">WP Password</label>
            <input type="password" value={form.wp_password} onChange={(e) => setForm({ ...form, wp_password: e.target.value })} required className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Sheet Name</label>
            <input value={form.sheet_name} onChange={(e) => setForm({ ...form, sheet_name: e.target.value })} className="input-field" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Spreadsheet ID</label>
            <input value={form.spreadsheet_id} onChange={(e) => setForm({ ...form, spreadsheet_id: e.target.value })} className="input-field" placeholder="Optional" />
          </div>
          <div className="col-span-2">
            <button type="submit" disabled={loading} className="btn-primary">{loading ? "Adding..." : "Add Site"}</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {sites.map((s) => (
          <div key={s.id} className="card flex items-center justify-between">
            <Link href={`/projects/${projectId}/sites/${s.id}`} className="flex-1">
              <h3 className="font-semibold text-white hover:text-brand-400 transition">{s.domain}</h3>
              <p className="text-sm text-gray-400">{s.wp_url} &middot; {s.recipe_count} recipes</p>
            </Link>
            {(role === "owner" || role === "admin") && (
              <button onClick={() => handleDelete(s.id)} className="text-gray-500 hover:text-red-400 transition p-2">
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
        {sites.length === 0 && <p className="text-center py-8 text-gray-500">No sites added yet.</p>}
      </div>
    </div>
  );
}

const CRED_TYPES = [
  { key: "openai", label: "OpenAI API Key" },
  { key: "discord_auth", label: "Discord Authorization" },
  { key: "discord_app_id", label: "Discord Application ID" },
  { key: "discord_guild", label: "Discord Guild ID" },
  { key: "discord_channel", label: "Discord Channel ID" },
  { key: "mj_version", label: "Midjourney Version" },
  { key: "mj_id", label: "Midjourney ID" },
  { key: "google_sa_json", label: "Google Service Account JSON" },
];

function CredentialsTab({ projectId, role }: { projectId: string; role: string | null }) {
  const [creds, setCreds] = useState<CredentialOut[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getCredentials(projectId).then(setCreds).catch(() => {});
  }, [projectId]);

  const handleSave = async () => {
    setSaving(true);
    const toSave = Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([key_type, value]) => ({ key_type, value }));
    if (toSave.length) {
      const updated = await api.setCredentials(projectId, toSave);
      setCreds(updated);
      setValues({});
    }
    setSaving(false);
  };

  const getMasked = (key: string) => creds.find((c) => c.key_type === key)?.masked_value || "Not set";

  if (role !== "owner" && role !== "admin") {
    return <p className="text-gray-400">You don&apos;t have permission to view credentials.</p>;
  }

  return (
    <div className="space-y-4">
      {CRED_TYPES.map((ct) => (
        <div key={ct.key} className="card">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-300">{ct.label}</label>
            <span className="text-xs text-gray-500 font-mono">{getMasked(ct.key)}</span>
          </div>
          {ct.key === "google_sa_json" ? (
            <textarea
              value={values[ct.key] || ""}
              onChange={(e) => setValues({ ...values, [ct.key]: e.target.value })}
              className="input-field h-24 font-mono text-xs"
              placeholder="Paste JSON here to update..."
            />
          ) : (
            <input
              value={values[ct.key] || ""}
              onChange={(e) => setValues({ ...values, [ct.key]: e.target.value })}
              className="input-field font-mono text-xs"
              placeholder="Enter new value to update..."
            />
          )}
        </div>
      ))}
      <button onClick={handleSave} disabled={saving} className="btn-primary">
        {saving ? "Saving..." : "Save Credentials"}
      </button>
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
