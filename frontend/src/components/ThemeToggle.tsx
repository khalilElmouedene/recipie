"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type Theme = "dark" | "light" | "system";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.classList.remove("dark");
  } else if (theme === "system") {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  } else {
    root.classList.add("dark");
  }
}

const MODES: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "system", icon: Monitor, label: "System" },
  { value: "dark", icon: Moon, label: "Dark" },
];

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem("theme") as Theme) || "dark";
    setTheme(stored);
    setMounted(true);
  }, []);

  // Re-apply when system preference changes while in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  function select(t: Theme) {
    setTheme(t);
    localStorage.setItem("theme", t);
    applyTheme(t);
  }

  if (!mounted) return null;

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-gray-700/60 bg-gray-800/60 p-0.5">
      {MODES.map(({ value, icon: Icon, label }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            onClick={() => select(value)}
            title={label}
            className={`flex items-center justify-center rounded-md p-1.5 transition-all ${
              active
                ? "bg-gray-700 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <Icon size={13} strokeWidth={active ? 2.5 : 1.8} />
          </button>
        );
      })}
    </div>
  );
}
