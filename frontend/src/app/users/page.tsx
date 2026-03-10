"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, MailCheck } from "lucide-react";
import { api, UserOut } from "@/lib/api";
import { getUserRole } from "@/lib/auth";

export default function UsersPage() {
  const router = useRouter();
  const role = getUserRole();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", role: "member" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resending, setResending] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "owner") { router.push("/"); return; }
    load();
  }, [role, router]);

  const load = () => api.getUsers().then(setUsers).catch(() => {});

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.createUser(form);
      setForm({ email: "", full_name: "", role: "member" });
      setShowCreate(false);
      load();
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    await api.updateUserRole(userId, newRole);
    load();
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Delete this user?")) return;
    try {
      await api.deleteUser(userId);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleResend = async (userId: string) => {
    setResending(userId);
    try {
      await api.resendInvite(userId);
      alert("Invitation email resent.");
    } catch (err: any) {
      alert(err.message);
    }
    setResending(null);
  };

  if (role !== "owner") return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-sm text-gray-400 mt-1">{users.length} user{users.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> <span className="hidden sm:inline">Create User</span><span className="sm:hidden">New</span>
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card mb-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2">
            <p className="text-sm text-blue-400">A welcome email with a password setup link will be sent to the user.</p>
          </div>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "Creating..." : "Create User"}
          </button>
        </form>
      )}

      {/* Desktop table */}
      <div className="hidden sm:block card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Email</th>
              <th className="px-6 py-3 font-medium">Role</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Joined</th>
              <th className="px-6 py-3 font-medium w-20"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-800/50 last:border-0">
                <td className="px-6 py-3 font-medium text-white">{u.full_name}</td>
                <td className="px-6 py-3 text-gray-400">{u.email}</td>
                <td className="px-6 py-3">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    className="bg-transparent text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 focus:border-brand-500"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                </td>
                <td className="px-6 py-3">
                  {u.has_password ? (
                    <span className="text-xs text-green-400">Active</span>
                  ) : (
                    <span className="text-xs text-amber-400">Pending</span>
                  )}
                </td>
                <td className="px-6 py-3 text-gray-500">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-3 flex items-center gap-1">
                  {!u.has_password && (
                    <button
                      onClick={() => handleResend(u.id)}
                      disabled={resending === u.id}
                      title="Resend invite email"
                      className="text-gray-500 hover:text-blue-400 p-1 disabled:opacity-50"
                    >
                      <MailCheck size={16} />
                    </button>
                  )}
                  <button onClick={() => handleDelete(u.id)} className="text-gray-500 hover:text-red-400 p-1">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="sm:hidden space-y-3">
        {users.map((u) => (
          <div key={u.id} className="card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-white truncate">{u.full_name}</p>
                  {u.has_password ? (
                    <span className="text-xs text-green-400 flex-shrink-0">Active</span>
                  ) : (
                    <span className="text-xs text-amber-400 flex-shrink-0">Pending</span>
                  )}
                </div>
                <p className="text-sm text-gray-400 truncate mt-0.5">{u.email}</p>
                <p className="text-xs text-gray-600 mt-1">{new Date(u.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {!u.has_password && (
                  <button
                    onClick={() => handleResend(u.id)}
                    disabled={resending === u.id}
                    title="Resend invite"
                    className="text-gray-500 hover:text-blue-400 p-1 disabled:opacity-50"
                  >
                    <MailCheck size={16} />
                  </button>
                )}
                <button onClick={() => handleDelete(u.id)} className="text-gray-500 hover:text-red-400 p-1">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Role</label>
              <select
                value={u.role}
                onChange={(e) => handleRoleChange(u.id, e.target.value)}
                className="bg-gray-800 text-sm px-3 py-1.5 rounded border border-gray-700 text-gray-300 focus:border-brand-500 w-full"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <p className="text-center py-8 text-gray-500 text-sm">No users yet.</p>
        )}
      </div>
    </div>
  );
}
