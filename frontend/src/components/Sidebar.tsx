"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, FolderKanban, Users, LogOut, X, Settings, LayoutTemplate, MessageCircle, ScrollText } from "lucide-react";
import { clearToken, getUserEmail, getUserRole } from "@/lib/auth";
import { api } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";

const PinterestIcon = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} className="fill-current shrink-0" aria-hidden>
    <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
  </svg>
);

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/threads", label: "Threads", icon: MessageCircle },
  { href: "/pinterest-gallery", label: "Pinterest", icon: PinterestIcon },
  { href: "/pin-designer-templates", label: "Own Templates", icon: LayoutTemplate },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const role = getUserRole();
  const email = (getUserEmail() || "").trim().toLowerCase();
  const isAuditViewer = email === "khalil@gmail.com";
  const baseItems = role === "owner"
    ? [...NAV, { href: "/users", label: "Users", icon: Users }, { href: "/settings", label: "Settings", icon: Settings }]
    : [...NAV, { href: "/settings", label: "Settings", icon: Settings }];
  const allItems = isAuditViewer
    ? [...baseItems, { href: "/logs", label: "Logs", icon: ScrollText }]
    : baseItems;

  return (
    <aside
      className={[
        "flex h-screen w-64 flex-col border-r border-gray-800 bg-gray-900",
        "fixed inset-y-0 left-0 z-40 transition-transform duration-300 md:static md:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
    >
      <div className="flex h-16 items-center gap-2.5 border-b border-gray-800 px-4">
        <Image
          src="/template images/logo (2).svg"
          alt="Logo"
          width={40}
          height={40}
          className="object-contain shrink-0"
          priority
        />
        <span className="text-base font-bold text-white leading-tight">
          Article<br />
          <span className="text-brand-400 text-sm font-semibold">Generator</span>
        </span>
        {/* Close button — mobile only */}
        <button
          onClick={onClose}
          className="md:hidden rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {allItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-brand-600/10 text-brand-400"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              <item.icon size={20} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-800 p-3 space-y-2">
        {/* Theme toggle — temporarily disabled
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-gray-500">Theme</span>
          <ThemeToggle />
        </div>
        */}
        <button
          onClick={async () => {
            try { await api.logout(); } catch {}
            clearToken();
            router.push("/login");
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
        >
          <LogOut size={20} />
          Logout
        </button>
      </div>
    </aside>
  );
}
