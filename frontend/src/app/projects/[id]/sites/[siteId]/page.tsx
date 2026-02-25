"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Play, Image, FileText, Download, Eye, X, ChevronDown, ChevronUp, Pencil, Check, ExternalLink, RefreshCw, LayoutGrid, Sparkles } from "lucide-react";
import { api, SiteOut, RecipeOut, PinterestBoard, PinterestBulkResponse, PinTemplate, BulkGeneratePinsResponse, BulkPinItem } from "@/lib/api";
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
  const [detailTab, setDetailTab] = useState<"article" | "recipe" | "seo" | "images" | "pinterest">("article");

  // Title editing
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  // Image replacement
  const [editingImageIdx, setEditingImageIdx] = useState<{ recipeId: string; idx: number } | null>(null);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [savingImage, setSavingImage] = useState(false);

  // Pinterest
  const [pinterestOpen, setPinterestOpen] = useState<string | null>(null);
  const [boards, setBoards] = useState<PinterestBoard[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState("");
  const [pinTitle, setPinTitle] = useState("");
  const [pinDescription, setPinDescription] = useState("");
  const [pinLink, setPinLink] = useState("");
  const [pinning, setPinning] = useState(false);
  const [pinResult, setPinResult] = useState<PinterestBulkResponse | null>(null);

  // Pin Designer (per-recipe)
  const [pinTemplates, setPinTemplates] = useState<PinTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [designTitle, setDesignTitle] = useState("");
  const [designIngredients, setDesignIngredients] = useState("");
  const [designWebsite, setDesignWebsite] = useState("");
  const [generatingPin, setGeneratingPin] = useState(false);
  const [pinPreview, setPinPreview] = useState<string | null>(null);

  // Bulk Pin Generator (site-level)
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTemplate, setBulkTemplate] = useState("");
  const [bulkWebsite, setBulkWebsite] = useState("");
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkGeneratePinsResponse | null>(null);

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
    window.open(`${API_URL}/api/sites/${siteId}/recipes/export`, "_blank");
  };

  const handleTitleEdit = (recipe: RecipeOut) => {
    setEditingTitleId(recipe.id);
    setEditTitleValue(recipe.recipe_text);
  };

  const handleTitleSave = async (recipeId: string) => {
    setSavingTitle(true);
    try {
      await api.updateRecipe(recipeId, { recipe_text: editTitleValue });
      setEditingTitleId(null);
      loadRecipes();
    } catch (err: any) {
      alert(err.message || "Failed to update title");
    }
    setSavingTitle(false);
  };

  const handleImageReplace = async (recipeId: string, imageIdx: number, recipe: RecipeOut) => {
    if (!newImageUrl.trim()) return;
    setSavingImage(true);
    try {
      const currentImages: string[] = recipe.generated_images ? JSON.parse(recipe.generated_images) : [];
      currentImages[imageIdx] = newImageUrl.trim();
      await api.updateRecipe(recipeId, { generated_images: JSON.stringify(currentImages) });
      setEditingImageIdx(null);
      setNewImageUrl("");
      loadRecipes();
    } catch (err: any) {
      alert(err.message || "Failed to update image");
    }
    setSavingImage(false);
  };

  const handleOpenPinterest = async (recipe: RecipeOut) => {
    setPinterestOpen(recipe.id);
    setPinResult(null);
    setPinTitle(recipe.recipe_text.split("\n")[0] || "");
    setPinDescription(recipe.meta_description || recipe.recipe_text.split("\n")[0] || "");
    setPinLink(recipe.wp_permalink || "");
    setSelectedBoard("");

    if (boards.length === 0) {
      setBoardsLoading(true);
      try {
        const b = await api.getPinterestBoards(projectId);
        setBoards(b);
        if (b.length > 0) setSelectedBoard(b[0].id);
      } catch (err: any) {
        alert(err.message || "Failed to load Pinterest boards. Check your Pinterest credentials.");
      }
      setBoardsLoading(false);
    }
  };

  const loadTemplates = async () => {
    if (pinTemplates.length > 0) return;
    try {
      const t = await api.getPinTemplates();
      setPinTemplates(t);
      if (t.length > 0) {
        setSelectedTemplate(t[0].id);
        setBulkTemplate(t[0].id);
      }
    } catch {}
  };

  const handleOpenDesigner = (recipe: RecipeOut) => {
    loadTemplates();
    setDesignTitle(recipe.recipe_text.split("\n")[0] || "");
    setDesignIngredients("");
    setDesignWebsite(site?.domain || "");
    setPinPreview(null);
  };

  const handleGeneratePin = async (recipeId: string) => {
    if (!selectedTemplate) return;
    setGeneratingPin(true);
    setPinPreview(null);
    try {
      const res = await api.generatePin(recipeId, {
        template_id: selectedTemplate,
        title: designTitle || undefined,
        ingredients: designIngredients || undefined,
        website: designWebsite || undefined,
      });
      setPinPreview(res.image_base64);
    } catch (err: any) {
      alert(err.message || "Failed to generate pin image");
    }
    setGeneratingPin(false);
  };

  const handleDownloadPin = () => {
    if (!pinPreview) return;
    const link = document.createElement("a");
    link.href = pinPreview;
    link.download = `pin-${Date.now()}.jpg`;
    link.click();
  };

  const handleOpenBulk = () => {
    loadTemplates();
    setBulkOpen(true);
    setBulkResult(null);
    setBulkWebsite(site?.domain || "");
  };

  const handleBulkGenerate = async () => {
    if (!bulkTemplate) return;
    setBulkGenerating(true);
    setBulkResult(null);
    try {
      const res = await api.bulkGeneratePins(siteId, {
        template_id: bulkTemplate,
        website: bulkWebsite || undefined,
      });
      setBulkResult(res);
    } catch (err: any) {
      alert(err.message || "Failed to generate bulk pins");
    }
    setBulkGenerating(false);
  };

  const handleBulkDownloadAll = () => {
    if (!bulkResult) return;
    bulkResult.pins.forEach((pin, i) => {
      if (pin.image_base64) {
        setTimeout(() => {
          const link = document.createElement("a");
          link.href = pin.image_base64!;
          link.download = `pin-${pin.recipe_title.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}.jpg`;
          link.click();
        }, i * 200);
      }
    });
  };

  const handleCreatePins = async (recipeId: string) => {
    if (!selectedBoard) {
      alert("Please select a board");
      return;
    }
    setPinning(true);
    setPinResult(null);
    try {
      const result = await api.createPinterestPins(recipeId, {
        board_id: selectedBoard,
        title: pinTitle,
        description: pinDescription,
        link: pinLink || undefined,
      });
      setPinResult(result);
    } catch (err: any) {
      alert(err.message || "Failed to create Pinterest pins");
    }
    setPinning(false);
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
          <button
            onClick={handleOpenBulk}
            disabled={recipes.filter((r) => r.generated_images).length === 0}
            className="btn-secondary flex items-center gap-2"
          >
            <LayoutGrid size={16} /> Bulk Pins ({recipes.filter((r) => r.generated_images).length})
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
                {editingTitleId === r.id ? (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      value={editTitleValue}
                      onChange={(e) => setEditTitleValue(e.target.value)}
                      className="input-field text-sm py-1 flex-1"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleTitleSave(r.id); if (e.key === "Escape") setEditingTitleId(null); }}
                    />
                    <button onClick={() => handleTitleSave(r.id)} disabled={savingTitle} className="text-green-400 hover:text-green-300 p-1">
                      <Check size={16} />
                    </button>
                    <button onClick={() => setEditingTitleId(null)} className="text-gray-500 hover:text-gray-300 p-1">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm text-white font-medium truncate">{r.recipe_text.split("\n")[0]}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTitleEdit(r); }}
                      className="text-gray-600 hover:text-gray-300 p-0.5 flex-shrink-0"
                      title="Edit title"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
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
                  {(["article", "recipe", "seo", "images", "pinterest"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => {
                        setDetailTab(tab);
                        if (tab === "pinterest") handleOpenDesigner(r);
                      }}
                      className={`px-3 py-2 text-xs font-medium border-b-2 transition capitalize ${
                        detailTab === tab ? "border-brand-500 text-brand-400" : "border-transparent text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {tab === "seo" ? "SEO" : tab}
                    </button>
                  ))}
                </div>
                <div className="p-4 max-h-[600px] overflow-y-auto">
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
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase">Generated Images (Midjourney)</span>
                            <button
                              onClick={() => handleOpenPinterest(r)}
                              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                            >
                              <ExternalLink size={12} /> Create Pinterest Pins
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-3 mt-2">
                            {(() => {
                              try {
                                const imgs: string[] = JSON.parse(r.generated_images);
                                return imgs.map((url: string, i: number) => (
                                  <div key={i} className="relative group">
                                    <img src={url} alt={`Generated ${i + 1}`} className="rounded-lg w-full" />
                                    {editingImageIdx?.recipeId === r.id && editingImageIdx?.idx === i ? (
                                      <div className="mt-2 space-y-2">
                                        <input
                                          value={newImageUrl}
                                          onChange={(e) => setNewImageUrl(e.target.value)}
                                          placeholder="New image URL..."
                                          className="input-field text-xs py-1.5"
                                          autoFocus
                                        />
                                        <div className="flex gap-1">
                                          <button
                                            onClick={() => handleImageReplace(r.id, i, r)}
                                            disabled={savingImage}
                                            className="btn-primary text-xs px-2 py-1 flex items-center gap-1"
                                          >
                                            <Check size={12} /> {savingImage ? "Saving..." : "Save"}
                                          </button>
                                          <button
                                            onClick={() => { setEditingImageIdx(null); setNewImageUrl(""); }}
                                            className="btn-secondary text-xs px-2 py-1"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => { setEditingImageIdx({ recipeId: r.id, idx: i }); setNewImageUrl(""); }}
                                        className="absolute top-2 right-2 bg-gray-900/80 hover:bg-gray-800 text-gray-300 hover:text-white rounded-lg p-1.5 opacity-0 group-hover:opacity-100 transition"
                                        title="Replace image"
                                      >
                                        <RefreshCw size={14} />
                                      </button>
                                    )}
                                  </div>
                                ));
                              } catch {
                                return <p className="text-gray-500 text-sm">Could not parse images.</p>;
                              }
                            })()}
                          </div>

                          {/* Pinterest Modal */}
                          {pinterestOpen === r.id && (
                            <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-white">Create Pinterest Pins</h4>
                                <button onClick={() => { setPinterestOpen(null); setPinResult(null); }} className="text-gray-500 hover:text-gray-300">
                                  <X size={16} />
                                </button>
                              </div>

                              {boardsLoading ? (
                                <p className="text-gray-400 text-sm">Loading boards...</p>
                              ) : boards.length === 0 ? (
                                <p className="text-gray-500 text-sm">No Pinterest boards found. Make sure your Pinterest token is set in project Credentials.</p>
                              ) : (
                                <>
                                  <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Board</label>
                                    <select
                                      value={selectedBoard}
                                      onChange={(e) => setSelectedBoard(e.target.value)}
                                      className="input-field text-sm"
                                    >
                                      {boards.map((b) => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Pin Title</label>
                                    <input
                                      value={pinTitle}
                                      onChange={(e) => setPinTitle(e.target.value)}
                                      className="input-field text-sm"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Description</label>
                                    <textarea
                                      value={pinDescription}
                                      onChange={(e) => setPinDescription(e.target.value)}
                                      rows={2}
                                      className="input-field text-sm"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Link (optional)</label>
                                    <input
                                      value={pinLink}
                                      onChange={(e) => setPinLink(e.target.value)}
                                      className="input-field text-sm"
                                      placeholder="https://..."
                                    />
                                  </div>
                                  <button
                                    onClick={() => handleCreatePins(r.id)}
                                    disabled={pinning}
                                    className="btn-primary text-sm w-full flex items-center justify-center gap-2"
                                  >
                                    {pinning ? "Creating pins..." : `Create ${(() => { try { return JSON.parse(r.generated_images!).length; } catch { return 0; } })()} Pins`}
                                  </button>
                                </>
                              )}

                              {pinResult && (
                                <div className="mt-3 space-y-2">
                                  <p className="text-sm text-gray-300">
                                    Created <span className="text-green-400 font-semibold">{pinResult.created}</span> / {pinResult.total} pins
                                    {pinResult.failed > 0 && <span className="text-red-400 ml-1">({pinResult.failed} failed)</span>}
                                  </p>
                                  {pinResult.pins.map((pin, pi) => (
                                    <div key={pi} className="flex items-center gap-2 text-xs">
                                      <img src={pin.image_url} alt="" className="w-8 h-8 rounded object-cover" />
                                      {pin.pin_url ? (
                                        <a href={pin.pin_url} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline truncate">
                                          {pin.pin_url}
                                        </a>
                                      ) : (
                                        <span className="text-red-400">{pin.error || "Failed"}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-gray-500 text-sm">No generated images. Midjourney credentials may not be configured.</p>
                      )}
                    </div>
                  )}
                  {detailTab === "pinterest" && (
                    <div>
                      {!r.generated_images ? (
                        <p className="text-gray-500 text-sm">No generated images yet. Generate content first before creating pins.</p>
                      ) : (
                        <div className="space-y-4">
                          {/* Template selector */}
                          <div>
                            <label className="text-xs font-semibold text-gray-400 uppercase mb-2 block">Select Template</label>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {pinTemplates.map((t) => (
                                <button
                                  key={t.id}
                                  onClick={() => setSelectedTemplate(t.id)}
                                  className={`rounded-lg border-2 p-2 text-left transition ${
                                    selectedTemplate === t.id
                                      ? "border-brand-500 bg-brand-500/10"
                                      : "border-gray-700 hover:border-gray-500"
                                  }`}
                                >
                                  <div className="flex gap-1 mb-1.5">
                                    {t.colors.map((c, ci) => (
                                      <div key={ci} className="w-4 h-4 rounded-sm" style={{ backgroundColor: c }} />
                                    ))}
                                  </div>
                                  <p className="text-xs font-medium text-white">{t.name}</p>
                                  <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{t.description}</p>
                                  <p className="text-[10px] text-gray-600 mt-0.5">{t.image_count} image{t.image_count > 1 ? "s" : ""}</p>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Customization */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-400 mb-1 block">Pin Title</label>
                              <input
                                value={designTitle}
                                onChange={(e) => setDesignTitle(e.target.value)}
                                className="input-field text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-400 mb-1 block">Website</label>
                              <input
                                value={designWebsite}
                                onChange={(e) => setDesignWebsite(e.target.value)}
                                className="input-field text-sm"
                                placeholder="mysite.com"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-gray-400 mb-1 block">Ingredients (one per line, auto-filled from recipe if empty)</label>
                            <textarea
                              value={designIngredients}
                              onChange={(e) => setDesignIngredients(e.target.value)}
                              rows={4}
                              className="input-field text-sm"
                              placeholder="Leave empty to auto-extract from recipe data..."
                            />
                          </div>

                          <button
                            onClick={() => handleGeneratePin(r.id)}
                            disabled={generatingPin || !selectedTemplate}
                            className="btn-primary flex items-center gap-2"
                          >
                            <Sparkles size={16} />
                            {generatingPin ? "Generating pin image..." : "Generate Pin Preview"}
                          </button>

                          {/* Preview */}
                          {pinPreview && (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-400 uppercase">Preview</span>
                                <button onClick={handleDownloadPin} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
                                  <Download size={12} /> Download
                                </button>
                              </div>
                              <div className="flex justify-center">
                                <img
                                  src={pinPreview}
                                  alt="Pin preview"
                                  className="rounded-lg shadow-lg max-h-[500px] w-auto"
                                />
                              </div>
                            </div>
                          )}
                        </div>
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

      {/* Bulk Pin Generator */}
      {bulkOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl border border-gray-700 max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <LayoutGrid size={20} /> Bulk Pinterest Pin Generator
              </h3>
              <button onClick={() => setBulkOpen(false)} className="text-gray-500 hover:text-gray-300">
                <X size={20} />
              </button>
            </div>

            {!bulkResult ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  Generate Pinterest pin images for all recipes with generated images using a single template.
                </p>

                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase mb-2 block">Template</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {pinTemplates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setBulkTemplate(t.id)}
                        className={`rounded-lg border-2 p-2 text-left transition ${
                          bulkTemplate === t.id
                            ? "border-brand-500 bg-brand-500/10"
                            : "border-gray-700 hover:border-gray-500"
                        }`}
                      >
                        <div className="flex gap-1 mb-1.5">
                          {t.colors.map((c, ci) => (
                            <div key={ci} className="w-4 h-4 rounded-sm" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <p className="text-xs font-medium text-white">{t.name}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">{t.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Website URL on pin</label>
                  <input
                    value={bulkWebsite}
                    onChange={(e) => setBulkWebsite(e.target.value)}
                    className="input-field text-sm"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm text-gray-500">
                    {recipes.filter((r) => r.generated_images).length} recipes with images will be processed
                  </p>
                  <button
                    onClick={handleBulkGenerate}
                    disabled={bulkGenerating || !bulkTemplate}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Sparkles size={16} />
                    {bulkGenerating ? "Generating..." : "Generate All Pins"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-300">
                    Generated <span className="text-green-400 font-semibold">{bulkResult.generated}</span> / {bulkResult.total} pins
                    {bulkResult.failed > 0 && <span className="text-red-400 ml-1">({bulkResult.failed} failed)</span>}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={handleBulkDownloadAll} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
                      <Download size={12} /> Download All
                    </button>
                    <button onClick={() => setBulkResult(null)} className="btn-secondary text-xs px-3 py-1.5">
                      Back
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {bulkResult.pins.map((pin, pi) => (
                    <div key={pi} className="rounded-lg overflow-hidden bg-gray-800">
                      {pin.image_base64 ? (
                        <>
                          <img src={pin.image_base64} alt={pin.recipe_title} className="w-full" />
                          <div className="p-2">
                            <p className="text-[11px] text-gray-300 truncate">{pin.recipe_title}</p>
                            <button
                              onClick={() => {
                                const link = document.createElement("a");
                                link.href = pin.image_base64!;
                                link.download = `pin-${pin.recipe_title.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}.jpg`;
                                link.click();
                              }}
                              className="text-[10px] text-brand-400 hover:underline mt-1"
                            >
                              Download
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="p-3">
                          <p className="text-[11px] text-gray-300 truncate">{pin.recipe_title}</p>
                          <p className="text-[10px] text-red-400 mt-1">{pin.error}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
