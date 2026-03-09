"use client";
import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { getApiBaseUrl } from "@/lib/api";

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  has_password: boolean;
}

export default function ProfilePage() {
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

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    fetch(`${getApiBaseUrl()}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setProfile(data);
        setFullName(data.full_name);
      });
  }, []);

  async function handleInfoSave(e: React.FormEvent) {
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
      const updated = await res.json();
      setProfile(updated);
      setInfoSuccess("Profile updated successfully.");
    } else {
      const data = await res.json().catch(() => ({}));
      setInfoError(data.detail || "Failed to update profile.");
    }
  }

  async function handlePasswordSave(e: React.FormEvent) {
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
      const data = await res.json().catch(() => ({}));
      setPwError(data.detail || "Failed to change password.");
    }
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-4 space-y-8">
      <h1 className="text-2xl font-bold text-white">My Profile</h1>

      {/* Personal Info */}
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
              onChange={(e) => { setFullName(e.target.value); setInfoError(""); setInfoSuccess(""); }}
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

      {/* Change Password */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Change Password</h2>

        <form onSubmit={handlePasswordSave} className="space-y-4">
          {!profile.has_password && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2">
              <p className="text-sm text-blue-400">You signed up with Google and have no password yet. Set one below to also enable email login.</p>
            </div>
          )}

          {profile.has_password && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Current Password</label>
              <div className="relative">
                <input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setPwError(""); setPwSuccess(""); }}
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
                onChange={(e) => { setNewPassword(e.target.value); setPwError(""); setPwSuccess(""); }}
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
                onChange={(e) => { setConfirmPassword(e.target.value); setPwError(""); setPwSuccess(""); }}
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
  );
}
