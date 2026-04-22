"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, X, ShieldAlert } from "lucide-react";
import { clearToken, setAuthUser } from "@/lib/auth";
import { api } from "@/lib/api";
import Sidebar from "./Sidebar";
import { ToastProvider } from "@/contexts/ToastContext";
import { ConfirmProvider } from "@/components/ConfirmModal";
import Link from "next/link";

const PUBLIC = ["/login", "/register", "/auth/google/callback", "/setup-password", "/forgot-password", "/reset-password"];

function NoPasswordBanner({ userId, onDismiss }: { userId: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 text-sm">
      <ShieldAlert size={16} className="shrink-0 text-amber-400" />
      <p className="flex-1 text-amber-300">
        Your account uses Google sign-in only.{" "}
        <Link href="/settings" className="font-semibold underline underline-offset-2 hover:text-amber-200">
          Set a password
        </Link>{" "}
        so you can also log in with your email.
      </p>
      <button
        onClick={() => {
          localStorage.setItem(`pw_banner_dismissed_${userId}`, "1");
          onDismiss();
        }}
        className="shrink-0 rounded p-0.5 text-amber-400 hover:bg-amber-500/20 transition"
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNoPwBanner, setShowNoPwBanner] = useState(false);
  const [userId, setUserId] = useState("");

  const isMobileViewport = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

  useEffect(() => {
    if (PUBLIC.includes(pathname)) {
      setReady(true);
      return;
    }
    let mounted = true;
    api.me()
      .then((me) => {
        if (!mounted) return;
        setAuthUser({ id: me.id, email: me.email, role: me.role });
        setUserId(String(me.id));
        const dismissed = localStorage.getItem(`pw_banner_dismissed_${me.id}`) === "1";
        if (!me.has_password && !dismissed) {
          setShowNoPwBanner(true);
        }
        setReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        clearToken();
        router.replace("/login");
      });
    return () => {
      mounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hide banner once user sets a password (navigates to settings and comes back)
  useEffect(() => {
    if (!showNoPwBanner) return;
    api.me().then((me) => {
      if (me.has_password) setShowNoPwBanner(false);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Close sidebar only on mobile route changes.
  useEffect(() => {
    if (isMobileViewport()) {
      setSidebarOpen(false);
    }
  }, [pathname]);

  if (!ready) return null;

  if (PUBLIC.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <ToastProvider>
    <ConfirmProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Mobile top bar */}
          <div className="flex h-14 items-center border-b border-gray-800 bg-gray-900 px-4 md:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
          </div>

          {showNoPwBanner && (
            <NoPasswordBanner userId={userId} onDismiss={() => setShowNoPwBanner(false)} />
          )}

          <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
        </div>
      </div>
    </ConfirmProvider>
    </ToastProvider>
  );
}
