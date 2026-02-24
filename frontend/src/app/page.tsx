"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, Globe, ChefHat, Briefcase } from "lucide-react";
import { api, DashboardStats } from "@/lib/api";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    api.getDashboard().then(setStats).catch(() => {});
  }, []);

  if (!stats) return <div className="text-gray-400">Loading dashboard...</div>;

  const cards = [
    { label: "Projects", value: stats.total_projects, icon: FolderKanban, color: "text-brand-400 bg-brand-600/20" },
    { label: "Sites", value: stats.total_sites, icon: Globe, color: "text-cyan-400 bg-cyan-600/20" },
    { label: "Recipes", value: stats.total_recipes, icon: ChefHat, color: "text-green-400 bg-green-600/20" },
    { label: "Jobs", value: stats.total_jobs, icon: Briefcase, color: "text-purple-400 bg-purple-600/20" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${c.color}`}>
                <c.icon size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{c.value}</p>
                <p className="text-xs text-gray-400">{c.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-semibold text-white mb-4">Your Projects</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="card hover:border-gray-700 transition group">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-lg bg-brand-600/20 flex items-center justify-center text-brand-400">
                <FolderKanban size={20} />
              </div>
              <h3 className="font-semibold text-white group-hover:text-brand-400 transition">{p.name}</h3>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-bold text-white">{p.site_count}</p>
                <p className="text-xs text-gray-500">Sites</p>
              </div>
              <div>
                <p className="text-lg font-bold text-white">{p.recipe_count}</p>
                <p className="text-xs text-gray-500">Recipes</p>
              </div>
              <div>
                <p className="text-lg font-bold text-white">{p.job_count}</p>
                <p className="text-xs text-gray-500">Jobs</p>
              </div>
            </div>
          </Link>
        ))}
        {stats.projects.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-500">
            No projects yet. Go to <Link href="/projects" className="text-brand-400 hover:underline">Projects</Link> to create one.
          </div>
        )}
      </div>
    </div>
  );
}
