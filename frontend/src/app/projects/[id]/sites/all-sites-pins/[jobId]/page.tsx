"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ImageIcon } from "lucide-react";
import { api, GeneratedJobSiteSummaryOut } from "@/lib/api";

export default function AllSitesJobPinsPage() {
  const params = useParams<{ id: string; jobId: string }>();
  const router = useRouter();
  const { id: projectId, jobId } = params;
  const [sites, setSites] = useState<GeneratedJobSiteSummaryOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getJobGeneratedSitesSummary(jobId)
      .then((items) => {
        if (!active) return;
        setSites(items);
      })
      .catch(() => {
        if (!active) return;
        setSites([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  const sortedSites = useMemo(
    () => [...sites].sort((a, b) => a.site_domain.localeCompare(b.site_domain)),
    [sites],
  );
  const totalRecipeCount = sortedSites.reduce((sum, site) => sum + site.recipe_count, 0);
  const publishedRecipes = sortedSites.reduce((sum, site) => sum + site.published_count, 0);
  const fullyPublishedSites = sortedSites.filter(
    (site) => site.recipe_count > 0 && site.published_count === site.recipe_count,
  ).length;

  if (loading) {
    return <div className="p-6 text-gray-400">Loading...</div>;
  }

  return (
    <div>
      <button
        onClick={() => router.push(`/projects/${projectId}/sites/all-sites-generate`)}
        className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={16} /> Back to All Sites
      </button>

      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
          <ImageIcon className="text-brand-400" size={28} />
          Pin designer - all recipes from this run
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Open the designer per website to create pins for every recipe generated in this job.
          {sortedSites.length > 0 && ` ${sortedSites.length} website(s) and ${totalRecipeCount} recipe(s).`}
        </p>
        {sortedSites.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">
            Published so far: {publishedRecipes}/{totalRecipeCount} recipes - {fullyPublishedSites}/{sortedSites.length} website(s) complete.
          </p>
        )}
      </div>

      {sortedSites.length === 0 ? (
        <div className="card text-sm text-gray-500">No recipes linked to this job.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sortedSites.map((site) => (
            <div key={site.site_id} className="card border border-gray-700">
              <h2 className="truncate font-semibold text-white" title={site.site_domain}>
                {site.site_domain}
              </h2>
              <p className="mt-1 text-xs text-gray-500">{site.recipe_count} recipe(s)</p>
              {site.published_count === site.recipe_count && site.recipe_count > 0 ? (
                <p className="mt-1 text-xs text-emerald-400">All recipes published</p>
              ) : site.published_count > 0 ? (
                <p className="mt-1 text-xs text-amber-300">
                  {site.published_count}/{site.recipe_count} published
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">Not published yet</p>
              )}
              <button
                onClick={() =>
                  router.push(`/projects/${projectId}/sites/${site.site_id}/designer?job=${jobId}`)
                }
                className="btn-primary mt-4 flex w-full items-center justify-center gap-2"
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
