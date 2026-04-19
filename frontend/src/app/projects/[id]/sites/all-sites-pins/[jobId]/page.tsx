"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ImageIcon } from "lucide-react";
import { api, GeneratedJobRecipeOut } from "@/lib/api";

function isRecipePublished(recipe: GeneratedJobRecipeOut): boolean {
  return recipe.status === "published" || Boolean(recipe.wp_permalink);
}

export default function AllSitesJobPinsPage() {
  const params = useParams<{ id: string; jobId: string }>();
  const router = useRouter();
  const { id: projectId, jobId } = params;
  const [recipes, setRecipes] = useState<GeneratedJobRecipeOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getJobGeneratedRecipes(jobId)
      .then(setRecipes)
      .catch(() => setRecipes([]))
      .finally(() => setLoading(false));
  }, [jobId]);

  const bySite = useMemo(() => {
    const m = new Map<string, { siteId: string; domain: string; items: GeneratedJobRecipeOut[] }>();
    for (const r of recipes) {
      const key = r.site_id;
      if (!m.has(key)) {
        m.set(key, { siteId: r.site_id, domain: r.site_domain, items: [] });
      }
      m.get(key)!.items.push(r);
    }
    return Array.from(m.values())
      .map((group) => ({
        ...group,
        publishedCount: group.items.filter(isRecipePublished).length,
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }, [recipes]);

  const fullyPublishedSites = bySite.filter(
    (g) => g.items.length > 0 && g.publishedCount === g.items.length
  ).length;
  const publishedRecipes = bySite.reduce((sum, g) => sum + g.publishedCount, 0);

  if (loading) {
    return <div className="text-gray-400 p-6">Loading…</div>;
  }

  return (
    <div>
      <button
        onClick={() => router.push(`/projects/${projectId}/sites/all-sites-generate`)}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4"
      >
        <ArrowLeft size={16} /> Back to All Sites
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ImageIcon className="text-brand-400" size={28} />
          Pin designer — all recipes from this run
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Open the designer per website to create pins for every recipe generated in this job ({recipes.length} recipes).
        </p>
        {recipes.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Published so far: {publishedRecipes}/{recipes.length} recipes • {fullyPublishedSites}/{bySite.length} website(s) complete.
          </p>
        )}
      </div>

      {bySite.length === 0 ? (
        <div className="card text-gray-500 text-sm">No recipes linked to this job.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {bySite.map((g) => (
            <div key={g.siteId} className="card border border-gray-700">
              <h2 className="font-semibold text-white truncate" title={g.domain}>
                {g.domain}
              </h2>
              <p className="text-xs text-gray-500 mt-1">{g.items.length} recipe(s)</p>
              {g.publishedCount === g.items.length && g.items.length > 0 ? (
                <p className="text-xs text-emerald-400 mt-1">All recipes published</p>
              ) : g.publishedCount > 0 ? (
                <p className="text-xs text-amber-300 mt-1">
                  {g.publishedCount}/{g.items.length} published
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">Not published yet</p>
              )}
              <button
                onClick={() =>
                  router.push(`/projects/${projectId}/sites/${g.siteId}/designer?job=${jobId}`)
                }
                className="btn-primary w-full mt-4 flex items-center justify-center gap-2"
              >
                <ImageIcon size={18} /> Open Pin Designer
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
