"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Shield } from "lucide-react";
import { api, UserOut } from "@/lib/api";
import { getUserRole } from "@/lib/auth";

export default function UsersPage() {
  const router = useRouter();
  const role = getUserRole();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", full_name: "", role: "member" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      setForm({ email: "", password: "", full_name: "", role: "member" });
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

  if (role !== "owner") return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-sm text-gray-400 mt-1">{users.length} user{users.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Create User
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card mb-6 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          {error && <p className="col-span-2 text-sm text-red-400">{error}</p>}
          <div className="col-span-2">
            <button type="submit" disabled={loading} className="btn-primary">{loading ? "Creating..." : "Create User"}</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Email</th>
              <th className="px-6 py-3 font-medium">Role</th>
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
                <td className="px-6 py-3 text-gray-500">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-3">
                  <button onClick={() => handleDelete(u.id)} className="text-gray-500 hover:text-red-400 p-1">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
