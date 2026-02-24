"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Play, Image, FileText, Download, Eye, X, ChevronDown, ChevronUp } from "lucide-react";
import { api, SiteOut, RecipeOut } from "@/lib/api";
import { getUserRole } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function SiteDetailPage() {
  const { id: projectId, siteId } = useParams<{ id: string; siteId: string }>();
  const router = useRouter();
  const role = getUserRole();

  const [site, setSite] = useState<SiteOut | null>(null);
  const [recipes, setRecipes] = useState<RecipeOut[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [recipeText, setRecipeText] = useState("");
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"article" | "recipe" | "seo" | "images">("article");

  const loadRecipes = () => api.getRecipes(siteId).then(setRecipes).catch(() => {});

  useEffect(() => {
    api.getSites(projectId).then((sites) => {
      const found = sites.find((s) => s.id === siteId);
      if (found) setSite(found);
      else router.push(`/projects/${projectId}`);
    });
    loadRecipes();
  }, [projectId, siteId, router]);

  const handleAddRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await api.createRecipe(siteId, { image_url: imageUrl, recipe_text: recipeText });
      setImageUrl("");
      setRecipeText("");
      loadRecipes();
    } catch {}
    setAdding(false);
  };

  const handleDelete = async (recipeId: string) => {
    if (!confirm("Delete this recipe?")) return;
    await api.deleteRecipe(recipeId);
    if (expandedId === recipeId) setExpandedId(null);
    loadRecipes();
  };

  const handleRunJob = async (type: "articles" | "publisher") => {
    setStarting(true);
    try {
      const job = await api.startJob(projectId, { job_type: type, site_id: siteId });
      router.push(`/jobs/${job.id}`);
    } catch (err: any) {
      alert(err.message || "Failed to start job");
    }
    setStarting(false);
  };

  const handleExport = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
    window.open(`${API_URL}/api/sites/${siteId}/recipes/export`, "_blank");
  };

  const statusColor: Record<string, string> = {
    pending: "bg-gray-700 text-gray-300",
    generating: "bg-blue-600/20 text-blue-400",
    generated: "bg-cyan-600/20 text-cyan-400",
    publishing: "bg-purple-600/20 text-purple-400",
    published: "bg-green-600/20 text-green-400",
    failed: "bg-red-600/20 text-red-400",
  };

  const pendingCount = recipes.filter((r) => r.status === "pending").length;
  const generatedCount = recipes.filter((r) => r.status === "generated").length;
  const publishedCount = recipes.filter((r) => r.status === "published").length;

  if (!site) return <div className="text-gray-400">Loading...</div>;

  return (
    <div>
      <button onClick={() => router.push(`/projects/${projectId}`)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4">
        <ArrowLeft size={16} /> Back to Project
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{site.domain}</h1>
          <p className="text-sm text-gray-400 mt-1">{recipes.length} recipes &middot; {pendingCount} pending &middot; {generatedCount} generated &middot; {publishedCount} published</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={() => handleRunJob("articles")} disabled={starting || pendingCount === 0} className="btn-primary flex items-center gap-2">
            <Play size={16} /> Generate ({pendingCount})
          </button>
          <button onClick={() => handleRunJob("publisher")} disabled={starting || generatedCount === 0} className="btn-secondary flex items-center gap-2">
            <Play size={16} /> Publish ({generatedCount})
          </button>
        </div>
      </div>

      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Add Recipe</h2>
        <form onSubmit={handleAddRecipe} className="space-y-4">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-1">
              <Image size={14} /> Image URL
            </label>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              required
              className="input-field"
              placeholder="https://example.com/image.jpg"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-1">
              <FileText size={14} /> Recipe Text
            </label>
            <textarea
              value={recipeText}
              onChange={(e) => setRecipeText(e.target.value)}
              required
              rows={4}
              className="input-field"
              placeholder="Enter recipe name and details..."
            />
          </div>
          <button type="submit" disabled={adding} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> {adding ? "Adding..." : "Add Recipe"}
          </button>
        </form>
      </div>

      <h2 className="text-lg font-semibold text-white mb-3">Recipes</h2>
      <div className="space-y-2">
        {recipes.map((r) => (
          <div key={r.id} className="card p-0 overflow-hidden">
            <div
              className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-800/50 transition"
              onClick={() => { setExpandedId(expandedId === r.id ? null : r.id); setDetailTab("article"); }}
            >
              {r.image_url && (
                <img src={r.image_url} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{r.recipe_text.split("\n")[0]}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded ${statusColor[r.status] || ""}`}>{r.status}</span>
                  {r.focus_keyword && <span className="text-xs text-gray-500">{r.focus_keyword}</span>}
                  {r.category && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{r.category}</span>}
                  {r.wp_permalink && <a href={r.wp_permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-400 hover:underline" onClick={(e) => e.stopPropagation()}>View post</a>}
                </div>
                {r.error_message && <p className="text-xs text-red-400 mt-1">{r.error_message}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }} className="text-gray-500 hover:text-red-400 p-1">
                  <Trash2 size={16} />
                </button>
                {expandedId === r.id ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
              </div>
            </div>

            {expandedId === r.id && (
              <div className="border-t border-gray-800">
                <div className="flex gap-1 px-4 pt-3 border-b border-gray-800">
                  {(["article", "recipe", "seo", "images"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setDetailTab(tab)}
                      className={`px-3 py-2 text-xs font-medium border-b-2 transition capitalize ${
                        detailTab === tab ? "border-brand-500 text-brand-400" : "border-transparent text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {tab === "seo" ? "SEO" : tab}
                    </button>
                  ))}
                </div>
                <div className="p-4 max-h-96 overflow-y-auto">
                  {detailTab === "article" && (
                    <div>
                      {r.generated_article ? (
                        <div className="prose prose-invert prose-sm max-w-none text-sm text-gray-300" dangerouslySetInnerHTML={{ __html: r.generated_article }} />
                      ) : (
                        <p className="text-gray-500 text-sm">No article generated yet. Click "Generate" to create content.</p>
                      )}
                    </div>
                  )}
                  {detailTab === "recipe" && (
                    <div>
                      {r.generated_full_recipe && (
                        <div className="mb-4">
                          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Full Recipe</h4>
                          <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-950 rounded-lg p-3">{r.generated_full_recipe}</pre>
                        </div>
                      )}
                      {r.generated_json ? (
                        <div>
                          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">WP Recipe JSON</h4>
                          <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-950 rounded-lg p-3 font-mono">{r.generated_json}</pre>
                        </div>
                      ) : (
                        <p className="text-gray-500 text-sm">No recipe JSON generated yet.</p>
                      )}
                    </div>
                  )}
                  {detailTab === "seo" && (
                    <div className="space-y-3">
                      <div>
                        <span className="text-xs font-semibold text-gray-400 uppercase">Focus Keyword</span>
                        <p className="text-sm text-gray-300 mt-1">{r.focus_keyword || "—"}</p>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-gray-400 uppercase">Meta Description</span>
                        <p className="text-sm text-gray-300 mt-1">{r.meta_description || "—"}</p>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-gray-400 uppercase">Category</span>
                        <p className="text-sm text-gray-300 mt-1">{r.category || "—"}</p>
                      </div>
                      {r.wp_post_id && (
                        <div>
                          <span className="text-xs font-semibold text-gray-400 uppercase">WordPress Post</span>
                          <p className="text-sm text-gray-300 mt-1">ID: {r.wp_post_id} — <a href={r.wp_permalink || ""} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">{r.wp_permalink}</a></p>
                        </div>
                      )}
                    </div>
                  )}
                  {detailTab === "images" && (
                    <div>
                      <div className="mb-3">
                        <span className="text-xs font-semibold text-gray-400 uppercase">Source Image</span>
                        {r.image_url && <img src={r.image_url} alt="Source" className="mt-2 max-w-xs rounded-lg" />}
                      </div>
                      {r.generated_images ? (
                        <div>
                          <span className="text-xs font-semibold text-gray-400 uppercase">Generated Images (Midjourney)</span>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {(() => {
                              try {
                                const imgs = JSON.parse(r.generated_images);
                                return imgs.map((url: string, i: number) => (
                                  <img key={i} src={url} alt={`Generated ${i + 1}`} className="rounded-lg w-full" />
                                ));
                              } catch {
                                return <p className="text-gray-500 text-sm">Could not parse images.</p>;
                              }
                            })()}
                          </div>
                        </div>
                      ) : (
                        <p className="text-gray-500 text-sm">No generated images. Midjourney credentials may not be configured.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {recipes.length === 0 && <p className="text-center py-8 text-gray-500">No recipes yet. Add one above.</p>}
      </div>
    </div>
  );
}
