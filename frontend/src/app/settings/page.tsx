"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Trash2, Save } from "lucide-react";
import { api, getApiBaseUrl, ProjectOut, type MidjourneyTimersOut, type CleanupConfigOut } from "@/lib/api";

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  has_password: boolean;
}

type SettingsTab = "profile" | "cleanup" | "midjourney";

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const initialTab = useMemo<SettingsTab>(() => {
    const raw = searchParams.get("tab");
    if (raw === "cleanup") return "cleanup";
    if (raw === "midjourney") return "midjourney";
    return "profile";
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

  // Cleanup config
  const [cleanupConfig, setCleanupConfig] = useState<CleanupConfigOut | null>(null);
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [cleanupIntervalDays, setCleanupIntervalDays] = useState(7);
  const [cleanupSaving, setCleanupSaving] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupError, setCleanupError] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [mjTimers, setMjTimers] = useState<MidjourneyTimersOut | null>(null);
  const [mjLoading, setMjLoading] = useState(false);
  const [mjSaving, setMjSaving] = useState(false);
  const [mjMessage, setMjMessage] = useState("");
  const [mjError, setMjError] = useState("");

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
    api.getProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab !== "cleanup") return;
    api.getCleanupConfig()
      .then((cfg) => {
        setCleanupConfig(cfg);
        setCleanupEnabled(cfg.enabled);
        setCleanupIntervalDays(cfg.interval_days);
      })
      .catch(() => {});
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "midjourney") return;
    setMjLoading(true);
    setMjError("");
    api
      .getMidjourneyTimers()
      .then((data) => {
        setMjTimers(data);
        setMjMessage("");
      })
      .catch((e) => setMjError(e instanceof Error ? e.message : "Failed to load Midjourney settings."))
      .finally(() => setMjLoading(false));
  }, [activeTab]);

  const saveMjGridWait = async () => {
    if (!mjTimers) return;
    setMjSaving(true);
    setMjError("");
    setMjMessage("");
    try {
      const updated = await api.setMidjourneyGridWait({ grid_wait_seconds: mjTimers.grid_wait_seconds });
      setMjTimers(updated);
      setMjMessage("Grid wait saved.");
    } catch (e) {
      setMjError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setMjSaving(false);
    }
  };

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

  const saveCleanupConfig = async () => {
    if (cleanupIntervalDays < 1) {
      setCleanupError("Interval must be greater than 0.");
      return;
    }
    setCleanupSaving(true);
    setCleanupError("");
    setCleanupMessage("");
    try {
      const updated = await api.setCleanupConfig({ enabled: cleanupEnabled, interval_days: cleanupIntervalDays });
      setCleanupConfig(updated);
      setCleanupMessage("Settings saved.");
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setCleanupSaving(false);
    }
  };

  const executeDeleteAll = async () => {
    setCleanupRunning(true);
    setCleanupError("");
    setCleanupMessage("");
    try {
      const result = await api.runCleanupNow();
      setCleanupMessage(`Done. Deleted ${result.recipes_deleted} recipe(s) and ${result.files_deleted} file(s).`);
      // Refresh last_run_at
      const cfg = await api.getCleanupConfig();
      setCleanupConfig(cfg);
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : "Cleanup failed.");
    } finally {
      setCleanupRunning(false);
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
        <p className="text-sm text-gray-400 mt-1">
          Manage your account, image cleanup, and Midjourney grid wait.
        </p>
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
        <button
          type="button"
          onClick={() => setActiveTab("midjourney")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            activeTab === "midjourney" ? "bg-brand-600 text-white" : "text-gray-300 hover:text-white"
          }`}
        >
          Midjourney timers
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

      {activeTab === "midjourney" && (
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-white">Midjourney timers</h2>
          <p className="text-sm text-gray-400">
            How long to wait after /imagine before reading the grid from Discord.
          </p>

          {mjLoading && <p className="text-sm text-gray-400">Loading…</p>}

          {!mjLoading && mjTimers && (
            <div className="max-w-md space-y-1">
              <label className="block text-sm font-medium text-gray-300 mb-1">Grid wait (seconds)</label>
              <input
                type="number"
                min={30}
                max={600}
                value={mjTimers.grid_wait_seconds}
                onChange={(e) =>
                  setMjTimers({ ...mjTimers, grid_wait_seconds: Number(e.target.value) || 30 })
                }
                disabled={profile.role !== "owner"}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-gray-500">After sending /imagine, wait before reading the grid (30–600).</p>
            </div>
          )}

          {profile.role === "owner" && !mjLoading && mjTimers && (
            <button
              type="button"
              onClick={saveMjGridWait}
              disabled={mjSaving}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {mjSaving ? "Saving…" : "Save grid wait"}
            </button>
          )}

          {profile.role !== "owner" && (
            <p className="text-xs text-gray-500">Grid wait is controlled by your workspace owner.</p>
          )}

          {mjError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-sm text-red-400">{mjError}</p>
            </div>
          )}
          {mjMessage && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2">
              <p className="text-sm text-green-400">{mjMessage}</p>
            </div>
          )}
        </section>
      )}

      {activeTab === "cleanup" && (
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white">Automatic Cleanup</h2>
            <p className="text-sm text-gray-400 mt-1">
              When enabled, the background service automatically deletes all published recipes and their
              local images after the configured interval.
            </p>
          </div>

          {/* Enable toggle */}
          <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-200">Enable Automatic Cleanup</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {cleanupEnabled ? "Service is active — will run every " + cleanupIntervalDays + " day(s)." : "Service is disabled — no automatic deletion will occur."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCleanupEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${cleanupEnabled ? "bg-brand-600" : "bg-gray-600"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${cleanupEnabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>

          {/* Interval input */}
          <div className="max-w-xs">
            <label className="block text-sm font-medium text-gray-300 mb-1">Cleanup Interval (Days)</label>
            <input
              type="number"
              min={1}
              value={cleanupIntervalDays}
              onChange={(e) => setCleanupIntervalDays(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              How often the cleanup runs. Must be greater than 0.{" "}
              {cleanupConfig?.last_run_at && (
                <span>Last run: {new Date(cleanupConfig.last_run_at).toLocaleString()}.</span>
              )}
            </p>
          </div>

          {/* Save button */}
          <button
            type="button"
            onClick={saveCleanupConfig}
            disabled={cleanupSaving}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <Save size={15} />
            {cleanupSaving ? "Saving..." : "Save Settings"}
          </button>

          <hr className="border-gray-700" />

          {/* Manual delete */}
          <div>
            <h3 className="text-sm font-semibold text-gray-200 mb-1">Manual Deletion</h3>
            <p className="text-xs text-gray-500 mb-3">
              Immediately deletes all published recipes and their local images across all projects. This action cannot be undone.
            </p>
            <button
              type="button"
              onClick={() => { setConfirmDeleteOpen(true); setCleanupMessage(""); setCleanupError(""); }}
              disabled={cleanupRunning}
              className="flex items-center gap-2 rounded-lg bg-red-900/70 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <Trash2 size={15} />
              {cleanupRunning ? "Deleting..." : "Delete All Recipes Now"}
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
            <h3 className="text-lg font-semibold text-white">Confirm deletion</h3>
            <p className="text-sm text-gray-300">
              Are you sure you want to delete all published recipes and their images? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={cleanupRunning}
                onClick={async () => {
                  setConfirmDeleteOpen(false);
                  await executeDeleteAll();
                }}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Yes, Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
