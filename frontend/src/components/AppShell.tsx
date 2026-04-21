"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { clearToken, setAuthUser } from "@/lib/auth";
import { api } from "@/lib/api";
import Sidebar from "./Sidebar";
import { ToastProvider } from "@/contexts/ToastContext";
import { ConfirmProvider } from "@/components/ConfirmModal";

const PUBLIC = ["/login", "/register", "/auth/google/callback", "/setup-password"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobileViewport = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

  useEffect(() => {
    if (PUBLIC.includes(pathname)) {
      setReady(true);
      return;
    }
    setReady(false);
    let mounted = true;
    api.me()
      .then((me) => {
        if (!mounted) return;
        setAuthUser({ id: me.id, email: me.email, role: me.role });
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
  }, [pathname, router]);

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

          <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
        </div>
      </div>
    </ConfirmProvider>
    </ToastProvider>
  );
}
