"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Play, Image, FileText, Download, Eye, X, ChevronDown, ChevronUp, Pencil, Check, ExternalLink, RefreshCw, LayoutGrid, Sparkles, Globe, Square, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { api, getApiBaseUrl, SiteOut, RecipeOut, PinterestBoard, PinterestBulkResponse, PinTemplate, BulkGeneratePinsResponse, BulkPinItem, JobOut, getWsUrl } from "@/lib/api";
import { getUserRole } from "@/lib/auth";
import { sanitizeHtml } from "@/lib/sanitize";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";

const API_URL = getApiBaseUrl();
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "stopped"]);
const DETAILED_PRESERVE_FIELDS: (keyof RecipeOut)[] = [
  "generated_article",
  "generated_json",
  "generated_full_recipe",
  "meta_description",
  "pin_url",
  "pin_board",
  "pin_tags",
  "seo_title",
  "wp_tags",
];

export default function SiteDetailPage() {
  const { id: projectId, siteId } = useParams<{ id: string; siteId: string }>();
  const router = useRouter();
  const role = getUserRole();
  const toast = useToast();
  const openConfirm = useConfirm();

  const [site, setSite] = useState<SiteOut | null>(null);
  const [recipes, setRecipes] = useState<RecipeOut[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [recipeText, setRecipeText] = useState("");
  const [imageSourceMode, setImageSourceMode] = useState<"url" | "upload">("url");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
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

  // Pin Designer (bulk generator only - per-recipe uses same designer page)
  const [pinTemplates, setPinTemplates] = useState<PinTemplate[]>([]);

  // WordPress publish (full article - per recipe)
  const [wpPublishingId, setWpPublishingId] = useState<string | null>(null);

  // Saved pin design form (Pinterest tab)
  const [pinDesignTitle, setPinDesignTitle] = useState("");
  const [pinDesignDesc, setPinDesignDesc] = useState("");
  const [pinDesignBoard, setPinDesignBoard] = useState("");
  const [pinDesignLink, setPinDesignLink] = useState("");
  const [pinDesignPinUrl, setPinDesignPinUrl] = useState("");
  const [pinDesignSaving, setPinDesignSaving] = useState(false);

  // Bulk Pin Generator (site-level)
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTemplate, setBulkTemplate] = useState("");
  const [bulkWebsite, setBulkWebsite] = useState("");
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkGeneratePinsResponse | null>(null);
  const [recipeJobMap, setRecipeJobMap] = useState<Record<string, string>>({});

  // Inline job monitoring
  const [activeJob, setActiveJob] = useState<JobOut | null>(null);
  const [activeJobLastLog, setActiveJobLastLog] = useState<string>("");
  const activeJobWsRef = useRef<WebSocket | null>(null);
  const activeJobStatusByIdRef = useRef<Map<string, string>>(new Map());
  const notifiedTerminalJobStatesRef = useRef<Set<string>>(new Set());
  const [jobToast, setJobToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const detailsLoadedRef = useRef<Set<string>>(new Set());
  const deletingIdsRef = useRef<Set<string>>(new Set());
  const recentlyAddedRef = useRef<Map<string, RecipeOut>>(new Map());
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  // Idempotency refs: block re-entry between click and React re-render (same-frame double-clicks)
  const jobStartingRef = useRef(false);
  const generatingIdsRef = useRef<Set<string>>(new Set());

  const loadRecipes = useCallback(
    () =>
      api.getRecipes(siteId, true)
        .then((rows) => {
          const serverIds = new Set(rows.map((r) => r.id));
          deletingIdsRef.current.forEach((id) => {
            if (!serverIds.has(id)) deletingIdsRef.current.delete(id);
          });
          recentlyAddedRef.current.forEach((_, id) => {
            if (serverIds.has(id)) recentlyAddedRef.current.delete(id);
          });
          const filtered = rows.filter((r) => !deletingIdsRef.current.has(r.id));
          const incomingIds = new Set(filtered.map((r) => r.id));

          setRecipes((prev) => {
            const prevById = new Map(prev.map((r) => [r.id, r]));
            const serverMerged = filtered.map((row) => {
              const previous = prevById.get(row.id);
              if (!previous || !detailsLoadedRef.current.has(row.id)) return row;

              const merged: RecipeOut = { ...previous, ...row };
              for (const field of DETAILED_PRESERVE_FIELDS) {
                const incomingVal = row[field];
                const previousVal = previous[field];
                if (incomingVal == null && previousVal != null) {
                  (merged as any)[field] = previousVal;
                }
              }
              return merged;
            });

            // Preserve locally-added recipes not yet confirmed by server
            const pendingNew = Array.from(recentlyAddedRef.current.values()).filter(
              (r) => !incomingIds.has(r.id)
            );
            return [...pendingNew, ...serverMerged];
          });

          const keptDetailed = new Set<string>();
          detailsLoadedRef.current.forEach((id) => {
            if (incomingIds.has(id)) keptDetailed.add(id);
          });
          detailsLoadedRef.current = keptDetailed;

          setRecipeJobMap((prev) => {
            const next: Record<string, string> = {};
            for (const [rid, jid] of Object.entries(prev)) {
              if (incomingIds.has(rid)) next[rid] = jid;
            }
            return next;
          });

          setExpandedId((current) => (current && !incomingIds.has(current) ? null : current));
        })
        .catch(() => {}),
    [siteId]
  );

  const ensureRecipeDetails = useCallback(async (recipeId: string) => {
    if (detailsLoadedRef.current.has(recipeId)) return;
    setLoadingDetailId(recipeId);
    try {
      const full = await api.getRecipe(recipeId);
      setRecipes((prev) => prev.map((r) => (r.id === recipeId ? full : r)));
      detailsLoadedRef.current.add(recipeId);
    } catch {
      // Keep summary row if details fail
    } finally {
      setLoadingDetailId((cur) => (cur === recipeId ? null : cur));
    }
  }, []);

  // Request notification permission
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Fire notification when active job finishes
  useEffect(() => {
    if (!activeJob) return;
    const prevStatus = activeJobStatusByIdRef.current.get(activeJob.id);
    activeJobStatusByIdRef.current.set(activeJob.id, activeJob.status);

    const isTerminal = TERMINAL_JOB_STATUSES.has(activeJob.status);
    const wasActive = !!prevStatus && !TERMINAL_JOB_STATUSES.has(prevStatus);
    const notificationKey = `${activeJob.id}:${activeJob.status}`;
    if (!isTerminal || !wasActive || notifiedTerminalJobStatesRef.current.has(notificationKey)) return;

    notifiedTerminalJobStatesRef.current.add(notificationKey);
    const isSuccess = activeJob.status === "completed";
    const msg = isSuccess
      ? "Generation completed successfully!"
      : activeJob.status === "failed"
        ? "Generation failed."
        : "Generation stopped.";
    setJobToast({ message: msg, type: isSuccess ? "success" : activeJob.status === "failed" ? "error" : "info" });
    setTimeout(() => setJobToast(null), 6000);

    if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(`Job ${activeJob.status}`, { body: msg, icon: "/favicon.ico" });
    }
  }, [activeJob?.id, activeJob?.status]);

  // Sync pin design form when expanded recipe changes (auto-fill from generated data)
  useEffect(() => {
    if (!expandedId) return;
    const r = recipes.find((rec) => rec.id === expandedId);
    if (r) {
      const recipeTitle = r.recipe_text?.split("\n")[0]?.trim() || "";
      setPinDesignTitle(r.pin_title || recipeTitle);
      setPinDesignDesc(r.pin_description || r.meta_description || recipeTitle);
      setPinDesignBoard(r.pin_board || "");
      setPinDesignLink(r.pin_blog_link || r.wp_permalink || "");
      setPinDesignPinUrl(r.pin_url || "");
    }
  }, [expandedId, recipes]);

  useEffect(() => {
    api.getSites(projectId).then((sites) => {
      const found = sites.find((s) => s.id === siteId);
      if (found) setSite(found);
      else router.replace("/");
    }).catch(() => router.replace("/"));
    loadRecipes();
  }, [projectId, siteId, router, loadRecipes]);

  // Passive collaborative sync: keep recipe list fresh for add/delete/status changes
  // made by other members, even when no generation job is currently active locally.
  useEffect(() => {
    const hasActiveJob = !!activeJob && (activeJob.status === "running" || activeJob.status === "pending");
    if (hasActiveJob) return;

    const syncNow = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      loadRecipes();
    };

    syncNow();
    const t = setInterval(syncNow, 5000);
    const onFocus = () => syncNow();
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeJob?.status, loadRecipes]);

  // Load boards from pinterest_boards_list prompt setting (already stored per-project, no OAuth needed)
  const [pinterestNotConnected, setPinterestNotConnected] = useState(false);
  useEffect(() => {
    if (detailTab !== "pinterest" || boards.length > 0 || boardsLoading) return;
    setBoardsLoading(true);
    api.getSettingsPrompts(projectId)
      .then((prompts) => {
        const entry = prompts.find((p) => p.key === "pinterest_boards_list");
        const raw = entry?.value || "";
        const boardNames = raw.split("\n").map((s: string) => s.trim()).filter(Boolean);
        if (boardNames.length > 0) {
          setBoards(boardNames.map((name: string) => ({ id: name, name })));
          setPinterestNotConnected(false);
        } else {
          setPinterestNotConnected(true);
        }
      })
      .catch(() => {
        // Network/permission failures should not be shown as "no boards configured".
        setPinterestNotConnected(false);
      })
      .finally(() => setBoardsLoading(false));
  }, [detailTab, boards.length, boardsLoading, projectId]);

  const handleConnectPinterest = () => {
    fetch(`${API_URL}/pinterest/auth-url?project_id=${projectId}`, {
      credentials: "include",
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        localStorage.setItem("pinterest_oauth_project_id", projectId);
        localStorage.setItem("pinterest_oauth_state", data.state);
        window.location.href = data.url;
      })
      .catch(() => {});
  };

  const handleRecipeImageFile = async (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) {
      setImageUploadError(file ? "Only image files are allowed" : "");
      return;
    }
    setImageUploading(true);
    setImageUploadError("");
    try {
      const { url } = await api.uploadRecipeImage(siteId, file);
      setImageUrl(url);
    } catch (err) {
      setImageUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImageUploading(false);
    }
  };

  // Global paste listener — Ctrl+V anywhere on the page uploads an image (upload mode only)
  useEffect(() => {
    if (imageSourceMode !== "upload") return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void handleRecipeImageFile(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, imageSourceMode]);

  const handleAddRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl.trim()) {
      setImageUploadError("Enter an image URL or paste an image (Ctrl+V)");
      return;
    }
    setAdding(true);
    try {
      const newRecipe = await api.createRecipe(siteId, { image_url: imageUrl.trim(), recipe_text: recipeText });
      setImageUrl("");
      setRecipeText("");
      setImageSourceMode("url");
      setImageUploadError("");
      recentlyAddedRef.current.set(newRecipe.id, newRecipe);
      setRecipes((prev) => [newRecipe, ...prev]);
    } catch (err: any) {
      toast.error(err.message || "Failed to add recipe");
    }
    setAdding(false);
  };

  const handleDelete = async (recipeId: string) => {
    if (!await openConfirm({ message: "Delete this recipe?", danger: true, confirmLabel: "Delete" })) return;
    deletingIdsRef.current.add(recipeId);
    setRecipes((prev) => prev.filter((r) => r.id !== recipeId));
    if (expandedId === recipeId) setExpandedId(null);
    try {
      await api.deleteRecipe(recipeId);
      // deletingIdsRef is cleared by loadRecipes once the server confirms the recipe is absent
    } catch (err: any) {
      deletingIdsRef.current.delete(recipeId);
      toast.error(err.message || "Failed to delete recipe");
    }
  };

  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const pollRecipeStatus = useCallback(
    (recipeId: string) => {
      let successAttempts = 0;
      const maxSuccessAttempts = 200;
      const interval = setInterval(async () => {
        try {
          const r = await api.getRecipe(recipeId);
          setRecipes((prev) => prev.map((old) => (old.id === recipeId ? r : old)));
          if (r.status !== "generating") {
            clearInterval(interval);
            return;
          }
          successAttempts++;
          if (successAttempts >= maxSuccessAttempts) {
            clearInterval(interval);
            try {
              const jobs = projectId ? await api.getProjectJobs(projectId) : [];
              const stillRunning = jobs.some((j) => j.job_type === "articles" && j.status === "running");
              if (!stillRunning) {
                const rr = await api.getRecipe(recipeId);
                setRecipes((prev) => prev.map((old) => (old.id === recipeId ? rr : old)));
              } else {
                loadRecipes();
              }
            } catch {
              loadRecipes();
            }
          }
        } catch {
          // Network blip — keep polling until status changes or success cap (long runs / Midjourney).
        }
      }, 5000);
    },
    [projectId, loadRecipes]
  );

  // Live WebSocket stream for active job
  useEffect(() => {
    if (!activeJob || activeJob.status !== "running") return;
    const trackedJobId = activeJob.id;
    const ws = new WebSocket(getWsUrl(trackedJobId));
    activeJobWsRef.current = ws;
    ws.onmessage = (e) => {
      if (!e.data) return;
      setActiveJobLastLog(e.data);
      if (
        e.data.includes("Job completed successfully") ||
        e.data.includes("Job stopped") ||
        e.data.includes("Job failed")
      ) {
        setTimeout(() => {
          api.getJob(trackedJobId).then((j) => {
            // Ignore late updates from a job that is no longer the actively tracked one.
            setActiveJob((prev) => (prev && prev.id === trackedJobId ? j : prev));
            if (j.status !== "running") loadRecipes();
          }).catch(() => {});
        }, 800);
      }
    };
    ws.onclose = () => {
      const poll = (attempts: number) => {
        api.getJob(trackedJobId).then((j) => {
          // A finished older job must not overwrite a newer running job in the UI.
          setActiveJob((prev) => (prev && prev.id === trackedJobId ? j : prev));
          if (j.status !== "running") { loadRecipes(); return; }
          if (attempts > 0) setTimeout(() => poll(attempts - 1), 1500);
        }).catch(() => {});
      };
      poll(3);
    };
    return () => ws.close();
  }, [activeJob?.id, activeJob?.status]);

  // Poll active job status every 3s while pending/running.
  useEffect(() => {
    if (!activeJob || (activeJob.status !== "running" && activeJob.status !== "pending")) return;
    const trackedJobId = activeJob.id;
    const t = setInterval(() => {
      api.getJob(trackedJobId).then((j) => {
        setActiveJob((prev) => (prev && prev.id === trackedJobId ? j : prev));
        if (j.status !== "running" && j.status !== "pending") {
          loadRecipes();
        }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [activeJob?.id, activeJob?.status, loadRecipes]);

  // Cross-user real-time sync: discover active generation jobs started by other members.
  // This runs even when the local recipe list is stale (still "pending"), then the WS/poll
  // pipeline takes over and updates status/logs for everyone without page refresh.
  useEffect(() => {
    if (activeJob?.status === "running") return;
    let cancelled = false;
    const syncExternal = () =>
      api.getProjectJobs(projectId)
        .then((jobs) => {
          if (cancelled) return;
          const activeArticleJob = jobs.find(
            (j) => j.job_type === "articles" && (j.status === "running" || j.status === "pending")
          );
          if (!activeArticleJob) return;
          if (!activeJob || activeJob.id !== activeArticleJob.id) {
            setActiveJobLastLog("");
          }
          setActiveJob((prev) => {
            if (!prev) return activeArticleJob;
            if (prev.id !== activeArticleJob.id) return activeArticleJob;
            if (prev.status !== activeArticleJob.status) return activeArticleJob;
            if (prev.current_row !== activeArticleJob.current_row) return activeArticleJob;
            if (prev.total_rows !== activeArticleJob.total_rows) return activeArticleJob;
            if (prev.error !== activeArticleJob.error) return activeArticleJob;
            return prev;
          });
          loadRecipes();
        })
        .catch(() => {});

    syncExternal();
    const t = setInterval(syncExternal, 3000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activeJob?.id, activeJob?.status, projectId, loadRecipes]);

  const openRecipeLogs = async (recipeId: string) => {
    const knownJobId = recipeJobMap[recipeId];
    if (knownJobId) {
      router.push(`/jobs/${knownJobId}`);
      return;
    }
    if (activeJob && (activeJob.job_type === "articles" || activeJob.job_type === "articles_all_sites")) {
      router.push(`/jobs/${activeJob.id}`);
      return;
    }

    try {
      const jobs = await api.getProjectJobs(projectId);
      const latestArticleJob =
        jobs.find((j) => j.job_type === "articles" && (j.status === "running" || j.status === "pending")) ||
        jobs.find((j) => j.job_type === "articles");
      if (latestArticleJob) {
        router.push(`/jobs/${latestArticleJob.id}`);
        return;
      }
      toast.info("No generation logs found yet for this recipe.");
    } catch (err: any) {
      toast.error(err.message || "Failed to load job logs");
    }
  };

  const handleGenerateSingle = async (recipeId: string) => {
    if (generatingIdsRef.current.has(recipeId)) return;
    generatingIdsRef.current.add(recipeId);
    setGeneratingId(recipeId);
    try {
      const job = await api.startJob(projectId, {
        job_type: "articles",
        site_id: siteId,
        recipe_id: recipeId,
      });
      setRecipeJobMap((prev) => ({ ...prev, [recipeId]: job.id }));
      setActiveJob(job);
      setActiveJobLastLog("");
      if (job.status !== "running" && job.status !== "pending") {
        if (job.error) toast.error(job.error);
        await loadRecipes();
        return;
      }
      setRecipes((prev) =>
        prev.map((r) => (r.id === recipeId ? { ...r, status: "generating", error_message: null } : r))
      );
      pollRecipeStatus(recipeId);
    } catch (err: any) {
      toast.error(err.message || "Failed to start generation");
      await loadRecipes();
    } finally {
      generatingIdsRef.current.delete(recipeId);
      setGeneratingId(null);
    }
  };

  const handleRunJob = async (type: "articles" | "publisher") => {
    if (jobStartingRef.current) return;
    jobStartingRef.current = true;
    setStarting(true);
    try {
      const job = await api.startJob(projectId, { job_type: type, site_id: siteId });
      setActiveJob(job);
      setActiveJobLastLog("");
    } catch (err: any) {
      toast.error(err.message || "Failed to start job");
    }
    jobStartingRef.current = false;
    setStarting(false);
  };

  const handleExport = () => {
    window.open(`${API_URL}/api/sites/${siteId}/recipes/export`, "_blank");
  };

  const handleExportExcel = () => {
    api.downloadSiteExcel(siteId, site?.domain || siteId);
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
      toast.error(err.message || "Failed to update title");
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
      toast.error(err.message || "Failed to update image");
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

    const aiBoard = recipe.pin_board?.trim().toLowerCase() ?? "";

    const _pickBoard = (boardList: typeof boards) => {
      if (boardList.length === 0) return;
      const matched = aiBoard ? boardList.find((b) => b.name.trim().toLowerCase() === aiBoard) : null;
      setSelectedBoard(matched ? matched.id : boardList[0].id);
    };

    if (boards.length === 0) {
      setBoardsLoading(true);
      try {
        const prompts = await api.getSettingsPrompts(projectId);
        const entry = prompts.find((p) => p.key === "pinterest_boards_list");
        const raw = entry?.value || "";
        const boardNames = raw.split("\n").map((s: string) => s.trim()).filter(Boolean);
        const b = boardNames.map((name: string) => ({ id: name, name }));
        setBoards(b);
        _pickBoard(b);
      } catch {
        // ignore
      }
      setBoardsLoading(false);
    } else {
      _pickBoard(boards);
    }
  };

  const loadTemplates = async () => {
    if (pinTemplates.length > 0) return;
    try {
      const t = await api.getPinTemplates();
      setPinTemplates(t);
      if (t.length > 0) setBulkTemplate(t[0].id);
    } catch {}
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
      toast.error(err.message || "Failed to generate bulk pins");
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

  const getRecipeImageUrl = (r: RecipeOut): string | null => {
    if (r.generated_images) {
      try {
        const imgs: string[] = JSON.parse(r.generated_images);
        if (imgs?.[0]) return imgs[0];
      } catch {}
    }
    return r.image_url || null;
  };

  const handlePublishArticleToWordPress = async (r: RecipeOut) => {
    if (!r.generated_article) {
      toast.warning("No article generated. Generate content first.");
      return;
    }
    setWpPublishingId(r.id);
    try {
      const data = await api.publishRecipeArticle(r.id);
      toast.success(`Published to WordPress! Post: ${data.wp_permalink}`);
      loadRecipes();
    } catch (err: any) {
      // The request may have timed out (Cloudflare proxy timeout) while the backend
      // was still uploading images / creating the post. Refresh the recipe to check
      // whether it was actually published despite the timeout error.
      try {
        const refreshed = await api.getRecipe(r.id);
        if (refreshed.wp_post_id) {
          loadRecipes();
          toast.success(`Published to WordPress! Post: ${refreshed.wp_permalink || ""}`);
          setWpPublishingId(null);
          return;
        }
      } catch { /* ignore */ }
      toast.error(err.message || "Failed to publish to WordPress");
    }
    setWpPublishingId(null);
  };

  const handleSavePinDesign = async (recipeId: string) => {
    setPinDesignSaving(true);
    try {
      await api.updateRecipe(recipeId, {
        pin_title: pinDesignTitle || undefined,
        pin_description: pinDesignDesc || undefined,
        pin_board: pinDesignBoard || undefined,
        pin_blog_link: pinDesignLink || undefined,
        pin_url: pinDesignPinUrl || undefined,
      });
      loadRecipes();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    }
    setPinDesignSaving(false);
  };

  const handleCreatePins = async (recipeId: string) => {
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
      toast.error(err.message || "Failed to create Pinterest pins");
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
  const failedCount = recipes.filter((r) => r.status === "failed").length;

  if (!site) return null;

  return (
    <div className="relative">
      {/* Job completion toast */}
      {jobToast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border backdrop-blur-sm transition-all duration-300 ${
          jobToast.type === "success" ? "bg-green-950/90 border-green-700/50 text-green-200" :
          jobToast.type === "error" ? "bg-red-950/90 border-red-700/50 text-red-200" :
          "bg-blue-950/90 border-blue-700/50 text-blue-200"
        }`}>
          {jobToast.type === "success" && <CheckCircle size={18} className="text-green-400 flex-shrink-0" />}
          {jobToast.type === "error" && <XCircle size={18} className="text-red-400 flex-shrink-0" />}
          {jobToast.type === "info" && <Loader2 size={18} className="text-blue-400 flex-shrink-0" />}
          <span className="text-sm font-medium">{jobToast.message}</span>
          <button onClick={() => setJobToast(null)} className="ml-2 text-gray-400 hover:text-white transition">
            <X size={14} />
          </button>
        </div>
      )}
      <button onClick={() => router.push(`/projects/${projectId}`)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4">
        <ArrowLeft size={16} /> Back to Project
      </button>

      {/* ── Inline Job Monitor ──────────────────────────── */}
      {activeJob && (
        <div className={`rounded-lg border p-4 mb-4 ${
          activeJob.status === "running"   ? "bg-blue-950/30 border-blue-800/40" :
          activeJob.status === "completed" ? "bg-green-950/30 border-green-800/40" :
          activeJob.status === "failed"    ? "bg-red-950/30 border-red-800/40" :
                                             "bg-gray-800/30 border-gray-700/40"
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              {activeJob.status === "running"   && <Loader2 size={18} className="text-blue-400 animate-spin mt-0.5 flex-shrink-0"/>}
              {activeJob.status === "completed" && <CheckCircle size={18} className="text-green-400 mt-0.5 flex-shrink-0"/>}
              {activeJob.status === "failed"    && <XCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0"/>}
              {activeJob.status === "stopped"   && <Square size={18} className="text-yellow-400 mt-0.5 flex-shrink-0"/>}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {activeJob.job_type === "articles" ? "Content Generation" : "Publishing"}&nbsp;
                  <span className={`text-xs font-normal px-1.5 py-0.5 rounded ${
                    activeJob.status === "running" ? "bg-blue-600/30 text-blue-300" :
                    activeJob.status === "completed" ? "bg-green-600/30 text-green-300" :
                    activeJob.status === "failed" ? "bg-red-600/30 text-red-300" : "bg-gray-700 text-gray-300"
                  }`}>{activeJob.status}</span>
                </p>
                {activeJob.status === "running" && activeJob.total_rows != null && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-40 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-500"
                           style={{ width: `${Math.min(100, ((activeJob.current_row ?? 0) / activeJob.total_rows) * 100)}%` }}/>
                    </div>
                    <span className="text-xs text-gray-400">{activeJob.current_row ?? 0} / {activeJob.total_rows} recipes</span>
                  </div>
                )}
                {activeJobLastLog && activeJob.status === "running" && (
                  <p className="text-xs text-gray-400 mt-1.5 truncate max-w-xl font-mono">{activeJobLastLog}</p>
                )}
                {activeJob.status === "completed" && (
                  <p className="text-xs text-green-400 mt-1">All recipes processed — refreshing list...</p>
                )}
                {activeJob.error && (
                  <p className="text-xs text-red-400 mt-1">{activeJob.error}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {activeJob.status === "running" && (
                <button
                  onClick={() => api.stopJob(activeJob.id).then((j) => setActiveJob(j)).catch(() => {})}
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 border border-red-800/40 px-2 py-1 rounded"
                >
                  <Square size={11}/> Stop
                </button>
              )}
              <button
                onClick={() => router.push(`/jobs/${activeJob.id}`)}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 border border-blue-800/40 px-2 py-1 rounded"
              >
                Full logs <ExternalLink size={11}/>
              </button>
              {activeJob.status !== "running" && (
                <button onClick={() => setActiveJob(null)} className="text-gray-500 hover:text-gray-300 ml-1">
                  <X size={14}/>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white truncate">{site.domain}</h1>
          <p className="text-sm text-gray-400 mt-1">
            {recipes.length} recipes &middot; {pendingCount} pending &middot; {generatedCount} generated &middot; {publishedCount} published
            {failedCount > 0 && <span className="text-red-400"> &middot; {failedCount} failed</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 flex-shrink-0">
          <button onClick={handleExportExcel} className="btn-secondary flex items-center gap-2 border-green-700 text-green-400 hover:text-green-300">
            <Download size={16} /> Excel
          </button>
          <button
            onClick={() => router.push(`/projects/${projectId}/sites/${siteId}/designer`)}
            className="btn-secondary flex items-center gap-2 border-green-700 text-green-400 hover:text-green-300"
          >
            <LayoutGrid size={16} /> Pin Designer
          </button>
          <button
            onClick={() => handleRunJob("articles")}
            disabled={starting || pendingCount === 0}
            className="btn-primary flex items-center gap-2"
          >
            <Play size={16} /> Generate ({pendingCount})
          </button>
          <button onClick={() => handleRunJob("publisher")} disabled={starting || generatedCount === 0} className="btn-secondary flex items-center gap-2">
            <Play size={16} /> Publish ({generatedCount})
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800/60 overflow-hidden">
        {/* Card header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800/80">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-600/20 text-brand-400">
            <Plus size={16} />
          </div>
          <h2 className="text-base font-semibold text-white">Add Recipe</h2>
        </div>

        <form onSubmit={handleAddRecipe} className="p-6">
          <div className="flex flex-col gap-5">

            {/* Left: Source Image */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Source Image</span>
                {imageUploading && <span className="flex items-center gap-1.5 text-xs text-brand-400"><Loader2 size={12} className="animate-spin" /> Uploading…</span>}
              </div>

              {/* Mode toggle */}
              <div className="flex gap-1 p-1 bg-gray-800/80 rounded-xl w-fit border border-gray-700/50">
                <button
                  type="button"
                  onClick={() => { setImageSourceMode("url"); setImageUrl(""); setImageUploadError(""); }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${imageSourceMode === "url" ? "bg-gray-700 text-white shadow-sm" : "text-gray-500 hover:text-gray-300"}`}
                >
                  External URL
                </button>
                <button
                  type="button"
                  onClick={() => { setImageSourceMode("upload"); setImageUrl(""); setImageUploadError(""); }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${imageSourceMode === "upload" ? "bg-gray-700 text-white shadow-sm" : "text-gray-500 hover:text-gray-300"}`}
                >
                  Upload / Paste
                </button>
              </div>

              {imageSourceMode === "upload" && !imageUrl ? (
                <div
                  className="relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-700 hover:border-brand-600/60 bg-gray-800/30 hover:bg-brand-600/5 transition-all cursor-pointer py-8 px-4 text-center"
                  onClick={() => document.getElementById("recipe-file-input")?.click()}
                >
                  <input
                    id="recipe-file-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleRecipeImageFile(e.target.files?.[0] ?? null)}
                  />
                  <div className="w-10 h-10 rounded-full bg-gray-700/60 flex items-center justify-center">
                    <Image size={18} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-300">Click to upload or press <kbd className="px-1.5 py-0.5 text-[10px] rounded bg-gray-700 text-gray-300 font-mono">Ctrl+V</kbd></p>
                    <p className="text-xs text-gray-500 mt-0.5">PNG, JPG, WEBP supported</p>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={imageUrl}
                    onChange={(e) => { setImageUrl(e.target.value); setImageUploadError(""); }}
                    className="input-field pr-9"
                    placeholder="https://example.com/image.jpg"
                    disabled={imageUploading}
                    readOnly={imageSourceMode === "upload"}
                  />
                  {imageUrl && (
                    <button
                      type="button"
                      onClick={() => { setImageUrl(""); setImageUploadError(""); }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-400 transition"
                      title="Remove"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}

              {/* Preview */}
              {imageUrl && !imageUploading && (
                <div className="relative group w-fit">
                  <img src={imageUrl} alt="Preview" className="max-h-28 rounded-xl object-cover border border-gray-700 shadow" />
                  <button
                    type="button"
                    onClick={() => { setImageUrl(""); setImageUploadError(""); }}
                    className="absolute top-1.5 right-1.5 bg-gray-900/80 hover:bg-red-600 text-gray-300 hover:text-white rounded-md p-0.5 opacity-0 group-hover:opacity-100 transition"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              {imageUploadError && <p className="text-xs text-red-400 flex items-center gap-1"><XCircle size={12} /> {imageUploadError}</p>}
            </div>

            {/* Right: Recipe Text */}
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Recipe Text</span>
              <textarea
                value={recipeText}
                onChange={(e) => setRecipeText(e.target.value)}
                required
                rows={4}
                className="input-field resize-none"
                placeholder="Paste recipe name and details here — the AI will generate a full article, SEO data, and Pinterest pin from this."
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end mt-5 pt-5 border-t border-gray-800/60">
            <button
              type="submit"
              disabled={adding}
              className="btn-primary flex items-center gap-2 px-6"
            >
              {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {adding ? "Adding…" : "Add Recipe"}
            </button>
          </div>
        </form>
      </div>

      <h2 className="text-lg font-semibold text-white mb-3">Recipes</h2>
      <div className="space-y-2">
        {recipes.map((r) => (
          <div key={r.id} className="card p-0 overflow-hidden">
            <div
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-800/50 transition"
              onClick={() => {
                const nextId = expandedId === r.id ? null : r.id;
                setExpandedId(nextId);
                setDetailTab("article");
                if (nextId) ensureRecipeDetails(nextId);
              }}
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
                    <p className="text-sm text-white font-medium truncate">{r.recipe_text.split("\n")[0].slice(0, 60)}{r.recipe_text.split("\n")[0].length > 60 ? "…" : ""}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTitleEdit(r); }}
                      className="text-gray-600 hover:text-gray-300 p-0.5 flex-shrink-0"
                      title="Edit title"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${statusColor[r.status] || ""}`}>{r.status}</span>
                  {r.focus_keyword && <span className="text-xs text-gray-500 truncate max-w-[120px]">{r.focus_keyword}</span>}
                  {r.category && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 flex-shrink-0">{r.category}</span>}
                  {r.wp_permalink && <a href={r.wp_permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-400 hover:underline flex-shrink-0" onClick={(e) => e.stopPropagation()}>View post</a>}
                </div>
                {r.error_message && <p className="text-xs text-red-400 mt-1">{r.error_message}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {(r.status === "pending" || r.status === "failed") && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleGenerateSingle(r.id); }}
                    disabled={generatingId === r.id}
                    className={r.status === "failed" ? "text-amber-400 hover:text-amber-300 p-1 disabled:opacity-50" : "text-brand-400 hover:text-brand-300 p-1 disabled:opacity-50"}
                    title={r.status === "failed" ? "Retry generation" : "Generate content for this recipe"}
                  >
                    {generatingId === r.id ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                  </button>
                )}
                {r.status === "generating" && (
                  <RefreshCw size={16} className="animate-spin text-blue-400 p-0 mx-1" />
                )}
                {(r.status === "generating" || r.status === "failed" || recipeJobMap[r.id]) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openRecipeLogs(r.id);
                    }}
                    className="text-cyan-400 hover:text-cyan-300 p-1"
                    title="View generation logs"
                  >
                    <Eye size={16} />
                  </button>
                )}
                {r.generated_article && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePublishArticleToWordPress(r); }}
                    disabled={wpPublishingId === r.id || r.status === "published" || r.status === "generating"}
                    className="text-gray-500 hover:text-blue-400 p-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={r.status === "published" ? "Already published to WordPress" : r.status === "generating" ? "Generation in progress — wait for it to complete" : "Publish article to WordPress"}
                  >
                    {wpPublishingId === r.id ? <RefreshCw size={16} className="animate-spin" /> : <Globe size={16} />}
                  </button>
                )}
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
                      onClick={() => setDetailTab(tab)}
                      className={`px-3 py-2 text-xs font-medium border-b-2 transition capitalize ${
                        detailTab === tab ? "border-brand-500 text-brand-400" : "border-transparent text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {tab === "seo" ? "SEO" : tab}
                    </button>
                  ))}
                </div>
                <div className="p-4 max-h-[600px] overflow-y-auto">
                  {loadingDetailId === r.id && (
                    <p className="text-sm text-gray-500 mb-3">Loading recipe details...</p>
                  )}
                  {detailTab === "article" && (
                    <div>
                      {r.generated_article ? (
                        <div className="prose prose-invert prose-sm max-w-none text-sm text-gray-300" dangerouslySetInnerHTML={{ __html: sanitizeHtml(r.generated_article) }} />
                      ) : r.status === "failed" ? (
                        <div className="text-sm">
                          <p className="text-red-400 font-medium">Generation failed.</p>
                          {r.error_message && <p className="text-gray-400 mt-1">{r.error_message}</p>}
                          <p className="text-gray-500 mt-2">Click the Retry button above to try again.</p>
                        </div>
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
                              ) : (
                                <>
                                  {boards.length > 0 && (
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs text-gray-400">Board</label>
                                        {r.pin_board && (
                                          <span className="text-xs text-brand-400">AI picked: {r.pin_board}</span>
                                        )}
                                      </div>
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
                                  )}
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
                    <div className="space-y-4">
                      {pinterestNotConnected && (
                        <div className="p-3 rounded-xl bg-amber-900/20 border border-amber-800 text-xs text-amber-300">
                          Pinterest boards are not configured for this project yet.
                        </div>
                      )}
                      {r.pin_design_image ? (
                        <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4">
                          <div className="flex flex-col sm:flex-row gap-4">
                            <div className="flex-shrink-0 relative group">
                              <img src={r.pin_design_image} alt="Saved pin" className="w-48 rounded-lg border border-gray-600 object-cover" />
                              <button
                                type="button"
                                onClick={() => {
                                  const link = document.createElement("a");
                                  link.href = r.pin_design_image!;
                                  link.download = `pin-${(pinDesignTitle || r.recipe_text?.split("\n")[0] || "design").replace(/[^a-z0-9]/gi, "_").slice(0, 40)}.png`;
                                  link.click();
                                }}
                                className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Download"
                              >
                                <Download size={28} className="text-white" />
                              </button>
                            </div>
                            <div className="flex-1 space-y-3">
                              <div>
                                <label className="text-xs text-gray-400 block mb-1">Title</label>
                                <input
                                  value={pinDesignTitle}
                                  onChange={(e) => setPinDesignTitle(e.target.value)}
                                  className="input-field text-sm w-full"
                                  placeholder="Pin title..."
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-400 block mb-1">Description</label>
                                <textarea
                                  value={pinDesignDesc}
                                  onChange={(e) => setPinDesignDesc(e.target.value)}
                                  className="input-field text-sm w-full"
                                  rows={2}
                                  placeholder="Pin description..."
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-400 block mb-1">Board</label>
                                {boardsLoading ? (
                                  <p className="text-xs text-gray-500">Loading boards…</p>
                                ) : boards.length > 0 ? (
                                  <select
                                    value={pinDesignBoard}
                                    onChange={(e) => setPinDesignBoard(e.target.value)}
                                    className="input-field text-sm w-full"
                                  >
                                    <option value="">— Select board —</option>
                                    {boards.map((b) => (
                                      <option key={b.id} value={b.name}>{b.name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    value={pinDesignBoard}
                                    onChange={(e) => setPinDesignBoard(e.target.value)}
                                    className="input-field text-sm w-full"
                                    placeholder="Board name…"
                                  />
                                )}
                              </div>
                              <div>
                                <label className="text-xs text-gray-400 block mb-1">Blog link (if already published on WordPress)</label>
                                <input
                                  value={pinDesignLink}
                                  onChange={(e) => setPinDesignLink(e.target.value)}
                                  className="input-field text-sm w-full"
                                  placeholder="https://yoursite.com/recipe-post"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-400 block mb-1">Pinterest pin URL</label>
                                <div className="flex gap-2">
                                  <input
                                    value={pinDesignPinUrl}
                                    onChange={(e) => setPinDesignPinUrl(e.target.value)}
                                    className="input-field text-sm w-full"
                                    placeholder="https://www.pinterest.com/pin/..."
                                  />
                                  {pinDesignPinUrl && (
                                    <a
                                      href={pinDesignPinUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center px-3 rounded-lg border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 transition flex-shrink-0"
                                      title="Open pin"
                                    >
                                      <ExternalLink size={14} />
                                    </a>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => handleSavePinDesign(r.id)}
                                disabled={pinDesignSaving}
                                className="btn-primary text-sm"
                              >
                                {pinDesignSaving ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-6 text-center">
                        <p className="text-gray-300 text-sm mb-4">
                          {r.pin_design_image
                            ? "Edit your design or use the Pin Designer for templates, elements, layers, and full editing."
                            : "Use the same Pin Designer as the designer page: templates (band-peach, canva-brown, etc.), elements, layers, and full editing."}
                        </p>
                        <button
                          onClick={() => router.push(`/projects/${projectId}/sites/${siteId}/designer?recipe=${r.id}`)}
                          className="btn-primary inline-flex items-center gap-2"
                        >
                          <LayoutGrid size={18} />
                          {r.pin_design_image ? "Edit Pin Designer" : "Open Pin Designer"}
                        </button>
                        {!r.generated_images && !r.image_url && (
                          <p className="text-gray-500 text-xs mt-3">Generate content first to auto-fill images in the designer.</p>
                        )}
                      </div>
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
