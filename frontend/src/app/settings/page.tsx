"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { api, getApiBaseUrl, ProjectOut } from "@/lib/api";

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  has_password: boolean;
}

type SettingsTab = "profile" | "cleanup";

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const initialTab = useMemo<SettingsTab>(() => {
    const raw = searchParams.get("tab");
    return raw === "cleanup" ? "cleanup" : "profile";
  }, [searchParams]);

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [infoSuccess, setInfoSuccess] = useState("");
  const [infoError, setInfoError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [pwError, setPwError] = useState("");
  const [infoLoading, setInfoLoading] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [projects, setProjects] = useState<ProjectOut[]>([]);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupError, setCleanupError] = useState("");
  const [retentionDays, setRetentionDays] = useState(4);
  const [publishedOnly, setPublishedOnly] = useState(true);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteInput, setConfirmDeleteInput] = useState("");

  useEffect(() => {
    api
      .me()
      .then((data) => {
        setProfile(data as unknown as UserProfile);
        setFullName((data as unknown as UserProfile).full_name || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .getProjects()
      .then(setProjects)
      .catch(() => {});
  }, []);

  async function handleInfoSave(e: FormEvent) {
    e.preventDefault();
    setInfoError("");
    setInfoSuccess("");
    if (!fullName.trim()) {
      setInfoError("Full name cannot be empty.");
      return;
    }
    setInfoLoading(true);
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const res = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ full_name: fullName.trim() }),
    });
    setInfoLoading(false);
    if (res.ok) {
      const updated = (await res.json()) as UserProfile;
      setProfile(updated);
      setInfoSuccess("Profile updated successfully.");
    } else {
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      setInfoError(data.detail || "Failed to update profile.");
    }
  }

  async function handlePasswordSave(e: FormEvent) {
    e.preventDefault();
    setPwError("");
    setPwSuccess("");
    if (profile?.has_password && !currentPassword) {
      setPwError("Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setPwError("New password must contain at least one uppercase letter.");
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setPwError("New password must contain at least one number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("Passwords do not match.");
      return;
    }
    setPwLoading(true);
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const res = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    setPwLoading(false);
    if (res.ok) {
      setPwSuccess("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      setPwError(data.detail || "Failed to change password.");
    }
  }

  const saveRetention = async () => {
    if (projects.length === 0) {
      setCleanupError("No projects found.");
      return;
    }
    setScheduleSaving(true);
    setCleanupError("");
    setCleanupMessage("");
    try {
      let updated = 0;
      let failed = 0;
      const nextDays = Math.max(1, retentionDays);
      for (const project of projects) {
        try {
          const current = await api.getPublishSchedule(project.id);
          await api.setPublishSchedule(project.id, {
            enabled: current.enabled,
            interval_minutes: current.interval_minutes,
            image_retention_days: nextDays,
          });
          updated += 1;
        } catch {
          failed += 1;
        }
      }
      if (updated === 0) {
        setCleanupError("Could not update cleanup settings for any project.");
      } else if (failed > 0) {
        setCleanupMessage(`Cleanup settings updated for ${updated} project(s). Failed: ${failed}.`);
      } else {
        setCleanupMessage(`Cleanup settings updated for all ${updated} project(s).`);
      }
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : "Failed to save cleanup settings.");
    } finally {
      setScheduleSaving(false);
    }
  };

  const runCleanup = async (mode: "retention" | "all_published") => {
    if (projects.length === 0) {
      setCleanupError("No projects found.");
      return;
    }
    if (mode === "all_published") {
      setConfirmDeleteOpen(true);
      setConfirmDeleteInput("");
      return;
    }
    await executeCleanup(mode);
  };

  const executeCleanup = async (mode: "retention" | "all_published") => {
    setCleanupLoading(true);
    setCleanupError("");
    setCleanupMessage("");
    try {
      let totalRecipesUpdated = 0;
      let totalRecipesDeleted = 0;
      let totalFilesDeleted = 0;
      let failed = 0;
      for (const project of projects) {
        try {
          const result = await api.runProjectImageCleanup(project.id, {
            delete_all_published: mode === "all_published",
            published_only: mode === "all_published" ? true : publishedOnly,
            retention_days: mode === "retention" ? Math.max(1, retentionDays) : undefined,
          });
          totalRecipesUpdated += result.recipes_updated;
          totalRecipesDeleted += result.recipes_deleted || 0;
          totalFilesDeleted += result.files_deleted;
        } catch {
          failed += 1;
        }
      }
      setCleanupMessage(
        `Cleanup complete (${mode}). Updated recipes: ${totalRecipesUpdated}. Deleted recipes: ${totalRecipesDeleted}. Deleted files: ${totalFilesDeleted}.${failed > 0 ? ` Failed projects: ${failed}.` : ""}`
      );
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : "Cleanup failed.");
    } finally {
      setCleanupLoading(false);
    }
  };

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your account and image cleanup controls.</p>
      </div>

      <div className="inline-flex rounded-xl border border-gray-700 bg-gray-900 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            activeTab === "profile" ? "bg-brand-600 text-white" : "text-gray-300 hover:text-white"
          }`}
        >
          Update Profile & Password
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("cleanup")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            activeTab === "cleanup" ? "bg-brand-600 text-white" : "text-gray-300 hover:text-white"
          }`}
        >
          Image Cleanup
        </button>
      </div>

      {activeTab === "profile" && (
        <div className="space-y-6">
          <section className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Personal Information</h2>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={profile.email}
                readOnly
                className="w-full rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm text-gray-400 cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-gray-500">Email cannot be changed.</p>
            </div>

            <form onSubmit={handleInfoSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    setInfoError("");
                    setInfoSuccess("");
                  }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {infoError && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2">
                  <p className="text-sm text-red-400">{infoError}</p>
                </div>
              )}
              {infoSuccess && (
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2">
                  <p className="text-sm text-green-400">{infoSuccess}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={infoLoading}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {infoLoading ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Change Password</h2>

            <form onSubmit={handlePasswordSave} className="space-y-4">
              {!profile.has_password && (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2">
                  <p className="text-sm text-blue-400">
                    You signed up with Google and have no password yet. Set one below to also enable email login.
                  </p>
                </div>
              )}

              {profile.has_password && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Current Password</label>
                  <div className="relative">
                    <input
                      type={showCurrent ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => {
                        setCurrentPassword(e.target.value);
                        setPwError("");
                        setPwSuccess("");
                      }}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 pr-10 text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-200"
                    >
                      {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setPwError("");
                      setPwSuccess("");
                    }}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 pr-10 text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-200"
                  >
                    {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">Min 8 chars, one uppercase, one number.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setPwError("");
                      setPwSuccess("");
                    }}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 pr-10 text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-200"
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {pwError && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2">
                  <p className="text-sm text-red-400">{pwError}</p>
                </div>
              )}
              {pwSuccess && (
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2">
                  <p className="text-sm text-green-400">{pwSuccess}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={pwLoading}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {pwLoading ? "Updating..." : "Update Password"}
              </button>
            </form>
          </section>
        </div>
      )}

      {activeTab === "cleanup" && (
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-white">Image Cleanup Controls</h2>
          <p className="text-sm text-gray-400">
            Actions below apply to all your accessible projects ({projects.length}).
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Retention days</label>
              <input
                type="number"
                min={1}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value || 1))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-gray-500">Delete generated images older than this number of days.</p>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={saveRetention}
                disabled={projects.length === 0 || scheduleSaving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {scheduleSaving ? "Saving..." : "Save Cleanup Settings"}
              </button>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={publishedOnly}
              onChange={(e) => setPublishedOnly(e.target.checked)}
              className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-brand-600 focus:ring-brand-500"
            />
            Retention cleanup applies to published recipes only
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => runCleanup("retention")}
              disabled={projects.length === 0 || cleanupLoading}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {cleanupLoading ? "Running..." : "Run Retention Cleanup Now"}
            </button>
            <button
              type="button"
              onClick={() => runCleanup("all_published")}
              disabled={projects.length === 0 || cleanupLoading}
              className="rounded-lg bg-red-900/70 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <Trash2 size={15} />
              {cleanupLoading ? "Running..." : "Delete ALL Published Images + Recipes Now"}
            </button>
          </div>

          {cleanupError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-sm text-red-400">{cleanupError}</p>
            </div>
          )}
          {cleanupMessage && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2">
              <p className="text-sm text-green-400">{cleanupMessage}</p>
            </div>
          )}
        </section>
      )}

      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-red-800/60 bg-gray-900 p-5 space-y-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Confirm destructive delete</h3>
            <p className="text-sm text-gray-300">
              This will delete ALL published recipes and their generated images across all your projects.
            </p>
            <p className="text-xs text-red-300">
              Type <span className="font-bold">DELETE</span> to continue.
            </p>
            <input
              value={confirmDeleteInput}
              onChange={(e) => setConfirmDeleteInput(e.target.value)}
              placeholder="Type DELETE"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (cleanupLoading) return;
                  setConfirmDeleteOpen(false);
                  setConfirmDeleteInput("");
                }}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={cleanupLoading || confirmDeleteInput !== "DELETE"}
                onClick={async () => {
                  setConfirmDeleteOpen(false);
                  setConfirmDeleteInput("");
                  await executeCleanup("all_published");
                }}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cleanupLoading ? "Running..." : "Delete Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
