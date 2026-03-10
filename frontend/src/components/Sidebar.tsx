"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, FolderKanban, Users, LogOut, Settings, UserCircle, X } from "lucide-react";
import { clearToken, getUserRole } from "@/lib/auth";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/profile", label: "Profile", icon: UserCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const role = getUserRole();

  const baseNav = NAV.filter((n) => n.href !== "/settings" || role === "owner");
  const items = role === "owner"
    ? [...baseNav, { href: "/users", label: "Users", icon: Users }]
    : baseNav;

  return (
    <aside
      className={[
        "flex h-screen w-64 flex-col border-r border-gray-800 bg-gray-900",
        "fixed inset-y-0 left-0 z-40 transition-transform duration-300 md:static md:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
    >
      <div className="flex h-16 items-center gap-2 border-b border-gray-800 px-6">
        <div className="h-8 w-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-sm">R</div>
        <span className="text-lg font-bold text-white flex-1">Recipe Generator</span>
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
        {items.map((item) => {
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

      <div className="border-t border-gray-800 p-3">
        <button
          onClick={() => { clearToken(); router.push("/login"); }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
        >
          <LogOut size={20} />
          Logout
        </button>
      </div>
    </aside>
  );
}
