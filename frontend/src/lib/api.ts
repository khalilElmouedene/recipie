/** In browser: use NEXT_PUBLIC_API_URL if set, otherwise same-origin (relative URLs) for reverse-proxy setups. */
export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
      return "http://localhost:8000";
    }
    return ""; // Same origin - relative URLs (reverse proxy setup)
  }
  return "http://localhost:8000";
}
const API_URL = getApiBaseUrl();

async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("auth_user");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : "Download failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("auth_user");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (res.status === 204) return undefined as unknown as T;

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    let msg = "Request failed";
    if (typeof err.detail === "string") msg = err.detail;
    else if (Array.isArray(err.detail) && err.detail.length > 0)
      msg = err.detail[0].msg || msg;
    throw new Error(msg);
  }

  return res.json();
}

// -- Auth ------------------------------------------------
export const api = {
  register: (email: string, password: string, full_name: string) =>
    request<{ access_token: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, full_name }),
    }),

  login: (email: string, password: string) =>
    request<{ access_token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    request<void>("/api/auth/logout", {
      method: "POST",
    }),

  me: () => request<UserOut>("/api/auth/me"),

  googleAuthUrl: () =>
    request<{ url: string; state: string }>("/api/auth/google/url"),

  googleCallback: (code: string, state: string) =>
    request<{ access_token: string }>("/api/auth/google/callback", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    }),

  forgotPassword: (email: string) =>
    request<{ detail: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ access_token: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  // -- Users (Owner) --------------------------------------
  getUsers: () => request<UserOut[]>("/api/users"),

  createUser: (data: { email: string; full_name: string; role: string }) =>
    request<UserOut>("/api/users", { method: "POST", body: JSON.stringify(data) }),

  updateUserRole: (id: string, role: string) =>
    request<UserOut>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),

  deleteUser: (id: string) =>
    request<void>(`/api/users/${id}`, { method: "DELETE" }),

  resendInvite: (id: string) =>
    request<void>(`/api/users/${id}/resend-invite`, { method: "POST" }),

  // -- Projects -------------------------------------------
  getProjects: () => request<ProjectOut[]>("/api/projects"),

  getProjectPinterestRecipes: (projectId: string, siteId?: string, signal?: AbortSignal) =>
    request<PinterestRecipeOut[]>(`/api/projects/${projectId}/pinterest-recipes${siteId ? `?site_id=${siteId}` : ""}`, { signal }),

  createProject: (name: string, description: string) =>
    request<ProjectOut>("/api/projects", { method: "POST", body: JSON.stringify({ name, description }) }),

  getProject: (id: string) => request<ProjectOut>(`/api/projects/${id}`),

  getProjectHealth: (id: string) => request<ProjectHealthOverviewOut>(`/api/projects/${id}/health`),

  updateProject: (id: string, data: { name?: string; description?: string }) =>
    request<ProjectOut>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteProject: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: "DELETE" }),

  duplicateProject: (id: string) =>
    request<ProjectOut>(`/api/projects/${id}/duplicate`, { method: "POST" }),

  getPublishSchedule: (projectId: string) =>
    request<PublishScheduleOut>(`/api/projects/${projectId}/publish-schedule`),

  setPublishSchedule: (projectId: string, data: PublishScheduleUpdate) =>
    request<PublishScheduleOut>(`/api/projects/${projectId}/publish-schedule`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  startPublishScheduleNow: (projectId: string) =>
    request<PublishScheduleOut>(`/api/projects/${projectId}/publish-schedule/start-now`, {
      method: "POST",
    }),

  publishBatchToWordPress: (projectId: string, data: PublishBatchRequest) =>
    request<PublishBatchOut>(`/api/projects/${projectId}/publish-batch`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  publishBatchStream: async (
    projectId: string,
    data: PublishBatchRequest,
    onEvent: (event: BatchPublishEvent) => void,
  ): Promise<void> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const res = await fetch(`${API_URL}/api/projects/${projectId}/publish-batch`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(typeof err.detail === "string" ? err.detail : "Batch publish failed");
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try { onEvent(JSON.parse(trimmed) as BatchPublishEvent); } catch { /* skip malformed */ }
        }
      }
    }
  },

  runProjectImageCleanup: (projectId: string, data: ImageCleanupRunRequest) =>
    request<ImageCleanupRunResult>(`/api/projects/${projectId}/image-cleanup/run`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // -- Members --------------------------------------------
  getMembers: (projectId: string) => request<MemberOut[]>(`/api/projects/${projectId}/members`),

  addMember: (projectId: string, userId: string, role: string) =>
    request<MemberOut>(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role }),
    }),

  removeMember: (projectId: string, userId: string) =>
    request<void>(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" }),

  // -- Credentials ----------------------------------------
  getCredentials: (projectId: string) =>
    request<CredentialOut[]>(`/api/projects/${projectId}/credentials`),

  setCredentials: (projectId: string, creds: { key_type: string; value: string }[]) =>
    request<CredentialOut[]>(`/api/projects/${projectId}/credentials`, {
      method: "PUT",
      body: JSON.stringify(creds),
    }),

  // -- Settings (clÃ©s API globales, non liÃ©es aux projets) --
  getSettingsCredentials: () => request<CredentialOut[]>(`/api/settings/credentials`),
  setSettingsCredentials: (creds: { key_type: string; value: string }[]) =>
    request<CredentialOut[]>(`/api/settings/credentials`, {
      method: "PUT",
      body: JSON.stringify(creds),
    }),

  getSettingsPrompts: (projectId: string) =>
    request<PromptOut[]>(`/api/settings/prompts?project_id=${projectId}`),
  setSettingsPrompts: (projectId: string, prompts: Record<string, string>) =>
    request<PromptOut[]>(`/api/settings/prompts?project_id=${projectId}`, {
      method: "PUT",
      body: JSON.stringify({ prompts }),
    }),
  resetSettingsPrompts: (projectId: string) =>
    request<void>(`/api/settings/prompts?project_id=${projectId}`, { method: "DELETE" }),
  resetAllPrompts: () =>
    request<void>(`/api/settings/prompts/all`, { method: "DELETE" }),

  getCustomFonts: () => request<string[]>(`/api/settings/fonts`),
  setCustomFonts: (fonts: string[]) =>
    request<string[]>(`/api/settings/fonts`, {
      method: "PUT",
      body: JSON.stringify({ fonts }),
    }),
  getPinReusableElements: () =>
    request<PinReusableElementOut[]>(`/api/settings/pin-elements`, { cache: "no-store" }),
  setPinReusableElements: (elements: PinReusableElementOut[]) =>
    request<PinReusableElementOut[]>(`/api/settings/pin-elements`, {
      method: "PUT",
      body: JSON.stringify({ elements }),
    }),

  getMidjourneyTimers: () => request<MidjourneyTimersOut>("/api/settings/midjourney-timers"),
  setMidjourneyGridWait: (data: { grid_wait_seconds: number }) =>
    request<MidjourneyTimersOut>("/api/settings/midjourney-timers", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  importBoardsExcel: async (file: File): Promise<{ boards: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_URL}/api/settings/boards/import`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(typeof err.detail === "string" ? err.detail : "Import failed");
    }
    return res.json();
  },

  downloadBoardsTemplate: async (): Promise<void> => {
    const res = await fetch(`${API_URL}/api/settings/boards/template`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to download template");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pinterest_boards_template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  },

  // -- Sites ----------------------------------------------
  getSites: (projectId: string) => request<SiteOut[]>(`/api/projects/${projectId}/sites`),

  getLastPublishDate: (siteId: string) =>
    request<{ last_publish_date: string | null }>(`/api/sites/${siteId}/last-publish-date`),

  createSite: (projectId: string, data: SiteCreateData) =>
    request<SiteOut>(`/api/projects/${projectId}/sites`, { method: "POST", body: JSON.stringify(data) }),

  updateSite: (siteId: string, data: Partial<SiteCreateData>) =>
    request<SiteOut>(`/api/sites/${siteId}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteSite: (siteId: string) =>
    request<void>(`/api/sites/${siteId}`, { method: "DELETE" }),

  /** Store recipe source image on the app server (not WordPress). URL is subject to 7-day retention. */
  uploadRecipeImage: async (siteId: string, file: File): Promise<{ url: string }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/api/sites/${siteId}/recipe-images`, {
      method: "POST",
      body: form,
      credentials: "include",
    });
    if (res.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("auth_user");
        window.location.href = "/login";
      }
      throw new Error("Unauthorized");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const msg = typeof err.detail === "string" ? err.detail : "Upload failed";
      throw new Error(msg);
    }
    return res.json();
  },

  uploadToWordPressFromUrl: (siteId: string, params: { image_url: string; title: string; create_post?: boolean }) =>
    request<{ media_id: string; media_url: string; post_id?: string; post_url?: string }>(
      `/api/sites/${siteId}/upload-from-url?${new URLSearchParams({
        image_url: params.image_url,
        title: params.title,
        create_post: String(params.create_post ?? true),
      })}`,
      { method: "POST" }
    ),

  uploadPinImageToServer: async (siteId: string, dataUrl: string): Promise<string> => {
    // Convert base64 data URL â†' Blob â†' FormData, POST to app server (7-day retention, not WordPress)
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const formData = new FormData();
    formData.append("file", blob, `pin-${Date.now()}.png`);
    const resp = await fetch(`${API_URL}/api/sites/${siteId}/recipe-images`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!resp.ok) throw new Error(`Pin image upload failed: ${resp.status}`);
    const data = await resp.json();
    return (data.url as string) || "";
  },

  // -- Recipes --------------------------------------------
  getRecipes: (siteId: string, summary = true) =>
    request<RecipeOut[]>(`/api/sites/${siteId}/recipes${summary ? "?summary=true" : ""}`),

  getRecipe: (recipeId: string) => request<RecipeOut>(`/api/recipes/${recipeId}`),

  createRecipe: (siteId: string, data: { image_url: string; recipe_text: string }) =>
    request<RecipeOut>(`/api/sites/${siteId}/recipes`, { method: "POST", body: JSON.stringify(data) }),

  updateRecipe: (recipeId: string, data: {
    recipe_text?: string;
    generated_images?: string;
    generated_article?: string;
    pin_design_image?: string;
    pin_title?: string;
    pin_description?: string;
    pin_blog_link?: string;
    pin_template_id?: string;
    pin_url?: string;
    pin_board?: string;
    pin_tags?: string;
    seo_title?: string;
    wp_tags?: string;
  }) =>
    request<RecipeOut>(`/api/recipes/${recipeId}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteRecipe: (recipeId: string) =>
    request<void>(`/api/recipes/${recipeId}`, { method: "DELETE" }),

  publishRecipeArticle: (recipeId: string) =>
    request<{ wp_post_id: string; wp_permalink: string }>(`/api/recipes/${recipeId}/publish-article`, {
      method: "POST",
    }),

  getPinterestBoards: (projectId: string) =>
    request<PinterestBoard[]>(`/api/projects/${projectId}/pinterest/boards`),

  createPinterestPins: (recipeId: string, data: PinterestPinRequest) =>
    request<PinterestBulkResponse>(`/api/recipes/${recipeId}/pinterest`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // -- Pin Generator --------------------------------------
  getPinTemplates: () => request<PinTemplate[]>("/api/pin-templates"),

  // -- Pin Designer Templates (user-created layouts) ----------------------
  getPinDesignerTemplates: (projectId?: string) =>
    request<PinDesignerTemplateOut[]>(
      `/api/pin-designer-templates${projectId ? `?project_id=${projectId}` : ""}`,
      { cache: "no-store" }
    ),
  getPinDesignerTemplate: (templateId: string) =>
    request<PinDesignerTemplateOut>(`/api/pin-designer-templates/${templateId}`, {
      cache: "no-store",
    }),
  assignTemplateToProjects: (templateId: string, projectIds: string[] | null) =>
    request<PinDesignerTemplateOut>(`/api/pin-designer-templates/${templateId}`, {
      method: "PUT",
      body: JSON.stringify({ project_ids: projectIds }),
    }),
  createPinDesignerTemplate: (data: PinDesignerTemplateCreate) =>
    request<PinDesignerTemplateOut>("/api/pin-designer-templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updatePinDesignerTemplate: (templateId: string, data: PinDesignerTemplateCreate) =>
    request<PinDesignerTemplateOut>(`/api/pin-designer-templates/${templateId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deletePinDesignerTemplate: (templateId: string) =>
    request<void>(`/api/pin-designer-templates/${templateId}`, { method: "DELETE" }),

  generatePin: (recipeId: string, data: GeneratePinRequest) =>
    request<GeneratePinResponse>(`/api/recipes/${recipeId}/generate-pin`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  bulkGeneratePins: (siteId: string, data: BulkGeneratePinsRequest) =>
    request<BulkGeneratePinsResponse>(`/api/sites/${siteId}/bulk-generate-pins`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // -- Spy Sheet ------------------------------------------
  getSpySheet: (projectId: string) =>
    request<{ project_id: string; data: string | null; updated_at: string | null }>(`/api/projects/${projectId}/spy-sheet`),

  saveSpySheet: (projectId: string, data: string | null) =>
    request<{ project_id: string; data: string | null; updated_at: string | null }>(
      `/api/projects/${projectId}/spy-sheet`,
      { method: "PUT", body: JSON.stringify({ data }) },
    ),

  getAuditLogs: (params?: {
    limit?: number;
    offset?: number;
    action?: string;
    table_name?: string;
    actor_user_id?: string;
    entity_pk?: string;
    from_at?: string;
    to_at?: string;
  }) => {
    const qp = new URLSearchParams();
    if (params?.limit !== undefined) qp.set("limit", String(params.limit));
    if (params?.offset !== undefined) qp.set("offset", String(params.offset));
    if (params?.action) qp.set("action", params.action);
    if (params?.table_name) qp.set("table_name", params.table_name);
    if (params?.actor_user_id) qp.set("actor_user_id", params.actor_user_id);
    if (params?.entity_pk) qp.set("entity_pk", params.entity_pk);
    if (params?.from_at) qp.set("from_at", params.from_at);
    if (params?.to_at) qp.set("to_at", params.to_at);
    const qs = qp.toString();
    return request<AuditLogListOut>(`/api/audit-logs${qs ? `?${qs}` : ""}`);
  },

  downloadSiteExcel: (siteId: string, domain: string) =>
    downloadFile(`/api/sites/${siteId}/export/excel`, `${domain.replace(/[^a-z0-9]/gi, "_")}.xlsx`),

  downloadProjectExcel: (projectId: string, projectName: string) =>
    downloadFile(`/api/projects/${projectId}/export/excel`, `${projectName.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}.xlsx`),

  // -- Jobs -----------------------------------------------
  getProjectJobs: (projectId: string) => request<JobOut[]>(`/api/projects/${projectId}/jobs`),

  startJob: (projectId: string, data: { job_type: string; site_id?: string; recipe_id?: string; shared_recipes?: SharedRecipeInput[] }) =>
    request<JobOut>(`/api/projects/${projectId}/jobs`, { method: "POST", body: JSON.stringify(data) }),

  getJob: (jobId: string) => request<JobOut>(`/api/jobs/${jobId}`),

  getJobLogs: (jobId: string) => request<JobLogOut[]>(`/api/jobs/${jobId}/logs`),

  getJobGeneratedRecipes: (jobId: string, siteId?: string) =>
    request<GeneratedJobRecipeOut[]>(
      `/api/jobs/${jobId}/generated-recipes${siteId ? `?site_id=${siteId}` : ""}`
    ),

  stopJob: (jobId: string) =>
    request<JobOut>(`/api/jobs/${jobId}/stop`, { method: "POST" }),

  resumeJob: (jobId: string) =>
    request<JobOut>(`/api/jobs/${jobId}/resume`, { method: "POST" }),

  deleteJob: (jobId: string) =>
    request<void>(`/api/jobs/${jobId}`, { method: "DELETE" }),

  // -- Dashboard ------------------------------------------
  getDashboard: () => request<DashboardStats>("/api/dashboard"),
  getOperationsOverview: () => request<OperationsOverviewOut>("/api/dashboard/operations"),

  // -- Threads Projects -----------------------------------
  getThreadsProjects: () => request<ThreadsProjectOut[]>("/api/threads-projects"),
  createThreadsProject: (data: { name: string; description: string; app_id: string; app_secret: string }) =>
    request<ThreadsProjectOut>("/api/threads-projects", { method: "POST", body: JSON.stringify(data) }),
  updateThreadsProject: (id: string, data: { name?: string; description?: string; app_id?: string; app_secret?: string }) =>
    request<ThreadsProjectOut>(`/api/threads-projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteThreadsProject: (id: string) =>
    request<void>(`/api/threads-projects/${id}`, { method: "DELETE" }),

  // -- Threads Accounts -----------------------------------
  getThreadsAccounts: (projectId: string) =>
    request<ThreadsAccountOut[]>(`/api/threads-projects/${projectId}/accounts`),
  getThreadsOAuthUrl: (projectId: string) =>
    request<{ url: string }>(`/api/threads/oauth/url?project_id=${projectId}`),
  connectThreadsAccount: (data: { code: string; state: string }) =>
    request<ThreadsAccountOut>("/api/threads/oauth/callback", { method: "POST", body: JSON.stringify(data) }),
  addThreadsAccountByToken: (projectId: string, accessToken: string) =>
    request<ThreadsAccountOut>(`/api/threads-projects/${projectId}/accounts/token`, {
      method: "POST", body: JSON.stringify({ access_token: accessToken }),
    }),
  deleteThreadsAccount: (projectId: string, accountId: string) =>
    request<void>(`/api/threads-projects/${projectId}/accounts/${accountId}`, { method: "DELETE" }),

  // -- Threads Posts --------------------------------------
  getThreadsPosts: (projectId: string) =>
    request<ThreadsPostOut[]>(`/api/threads-projects/${projectId}/posts`),
  uploadThreadsMedia: async (files: File[]): Promise<{ urls: string[] }> => {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    const res = await fetch(`${API_URL}/api/threads/upload-media`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(typeof err.detail === "string" ? err.detail : "Upload failed");
    }
    return res.json();
  },
  createThreadsPost: (projectId: string, data: {
    account_id: string; text_content: string; image_url?: string;
    media_urls?: string[]; first_comment?: string; scheduled_at?: string;
  }) => request<ThreadsPostOut>(`/api/threads-projects/${projectId}/posts`, { method: "POST", body: JSON.stringify(data) }),
  publishThreadsPost: (postId: string) =>
    request<ThreadsPostOut>(`/api/threads-posts/${postId}/publish`, { method: "POST" }),
  batchPublishThreadsPosts: (postIds: string[]) =>
    request<{ succeeded: string[]; failed: { id: string; error: string }[] }>(
      "/api/threads-posts/batch-publish",
      { method: "POST", body: JSON.stringify({ post_ids: postIds }) }
    ),
  updateThreadsPost: (postId: string, data: Partial<{ text_content: string; image_url: string; media_urls: string[]; first_comment: string; scheduled_at: string; account_id: string }>) =>
    request<ThreadsPostOut>(`/api/threads-posts/${postId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteThreadsPost: (postId: string) =>
    request<void>(`/api/threads-posts/${postId}`, { method: "DELETE" }),

  // -- Cleanup Config -------------------------------------
  getCleanupConfig: () =>
    request<CleanupConfigOut>("/api/settings/cleanup-config"),
  setCleanupConfig: (data: { enabled: boolean; interval_days: number }) =>
    request<CleanupConfigOut>("/api/settings/cleanup-config", { method: "PUT", body: JSON.stringify(data) }),
  runCleanupNow: () =>
    request<{ recipes_deleted: number; files_deleted: number }>("/api/settings/cleanup-config/run-now", { method: "POST" }),
};

export function getWsUrl(jobId: string): string {
  const base = API_URL.replace("http", "ws");
  return `${base}/ws/logs/${jobId}`;
}

// -- Types ------------------------------------------------

export interface CleanupConfigOut {
  enabled: boolean;
  interval_days: number;
  last_run_at: string | null;
}

export interface UserOut {
  id: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
  has_password: boolean;
}

export interface ProjectOut {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  created_at: string;
  site_count: number;
  member_count: number;
  recipe_count: number;
  job_count: number;
}

export interface MemberOut {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: string;
}

export interface CredentialOut {
  key_type: string;
  masked_value: string;
  updated_at: string;
}

export interface PromptOut {
  key: string;
  value: string;
  description: string;
}

/** Grid wait is user-configurable; upscale_gap and post_upscale are fixed server-side (10 / 60). */
export interface MidjourneyTimersOut {
  grid_wait_seconds: number;
  upscale_gap_seconds: number;
  post_upscale_wait_seconds: number;
}

export interface WpUserOut {
  username: string;
}

export interface PinterestRecipeOut {
  id: string;
  site_id: string;
  site_domain: string;
  recipe_text: string;
  generated_images: string | null;
  image_url: string | null;
  pin_design_image: string | null;
  pin_title: string | null;
  pin_description: string | null;
  pin_board: string | null;
  pin_tags: string | null;
  pin_url: string | null;
  wp_permalink: string | null;
  created_at: string;
}

export interface SiteOut {
  id: string;
  project_id: string;
  domain: string;
  wp_url: string;
  wp_users: WpUserOut[];
  sheet_name: string;
  spreadsheet_id: string;
  pinterest_url: string;
  image_mode: string;
  embed_pin_in_article: boolean;
  created_at: string;
  recipe_count: number;
}

export interface WpUserItem {
  username: string;
  password: string;
}

export interface SiteCreateData {
  domain: string;
  wp_url: string;
  wp_users: WpUserItem[];
  sheet_name?: string;
  spreadsheet_id?: string;
  pinterest_url?: string;
  image_mode?: string;
  embed_pin_in_article?: boolean;
}

export interface RecipeOut {
  id: string;
  site_id: string;
  created_by: string;
  image_url: string;
  recipe_text: string;
  status: string;
  generated_article: string | null;
  generated_json: string | null;
  generated_full_recipe: string | null;
  focus_keyword: string | null;
  meta_description: string | null;
  category: string | null;
  generated_images: string | null;
  wp_post_id: string | null;
  wp_permalink: string | null;
  pin_design_image: string | null;
  pin_title: string | null;
  pin_description: string | null;
  pin_blog_link: string | null;
  pin_template_id: string | null;
  pin_url: string | null;
  pin_board: string | null;
  pin_tags: string | null;
  seo_title: string | null;
  wp_tags: string | null;
  error_message: string | null;
  created_at: string;
}

export interface JobOut {
  id: string;
  project_id: string;
  created_by: string;
  job_type: string;
  status: string;
  current_row: number | null;
  total_rows: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface SharedRecipeInput {
  image_url: string;
  recipe_text: string;
}

export interface GeneratedJobRecipeOut {
  id: string;
  site_id: string;
  site_domain: string;
  recipe_text: string;
  status: string;
  wp_permalink: string | null;
  image_url?: string;
  generated_images?: string | null;
  category?: string | null;
  pin_template_id?: string | null;
  created_at: string;
}

export interface PublishScheduleOut {
  enabled: boolean;
  interval_minutes: number;
  image_retention_days: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
}

export interface PublishScheduleUpdate {
  enabled: boolean;
  interval_minutes: number;
  image_retention_days: number;
}

export interface PublishBatchRequest {
  mode: "wordpress_scheduled" | "manual_backdate";
  first_publish_at?: string; // ISO datetime for first post (wordpress_scheduled mode)
  interval_minutes?: number; // override project interval
  site_id?: string; // if set, only publish recipes for this site
  recipe_id?: string; // if set, publish only this single recipe
}

export interface PublishBatchOut {
  total: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export type BatchPublishEvent =
  | { type: "start"; total: number; pre_failed: number }
  | { type: "progress"; done: number; total: number; succeeded: number; failed: number; recipe_name: string; ok: boolean }
  | { type: "done"; total: number; succeeded: number; failed: number; errors: string[] };

export interface ImageCleanupRunRequest {
  delete_all_published?: boolean;
  published_only?: boolean;
  retention_days?: number | null;
}

export interface ImageCleanupRunResult {
  recipes_updated: number;
  recipes_deleted?: number;
  files_deleted: number;
  mode: string;
}

export interface PinDesignerTemplateElement {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defaultText?: string | null;
  fontFamily?: string | null;
  fontSize?: number | null;
  fontWeight?: string | null;
  fontStyle?: string | null;
  fill?: string | null;
  bgColor?: string | null;
  textAlign?: string | null;
  textVariable?: string | null;
  textTransform?: string | null;
  radius?: number | null;
  strokeWidth?: number | null;
  strokeStyle?: Record<string, unknown> | string | null;
  imageUrl?: string | null;
  flipX?: boolean | null;
  flipY?: boolean | null;
  [key: string]: unknown;
}

export interface PinDesignerTemplateOut {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  bgColor: string;
  canvasWidth: number;
  canvasHeight: number;
  previewLayout: string | null;
  project_ids: string[] | null;
  elements: PinDesignerTemplateElement[];
}

export interface PinDesignerTemplateCreate {
  name: string;
  description: string | null;
  bgColor: string;
  canvasWidth?: number;
  canvasHeight?: number;
  project_ids?: string[] | null;
  elements: PinDesignerTemplateElement[];
}

export interface PinReusableElementOut {
  id: string;
  name: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at?: string | null;
}

export interface JobLogOut {
  id: number;
  message: string;
  created_at: string;
}

export interface AuditLogOut {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  table_name: string;
  entity_pk: string | null;
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  request_method: string | null;
  request_path: string | null;
  ip_address: string | null;
}

export interface AuditLogListOut {
  total: number;
  items: AuditLogOut[];
}

export interface DashboardStats {
  total_projects: number;
  total_sites: number;
  total_recipes: number;
  total_jobs: number;
  projects: ProjectOut[];
}

export interface OperationsMetricOut {
  key: string;
  label: string;
  value: number;
  tone: string;
  hint: string | null;
}

export interface OperationsCheckOut {
  key: string;
  label: string;
  status: string;
  detail: string;
  href: string | null;
}

export interface OperationsTaskOut {
  key: string;
  label: string;
  done: boolean;
  detail: string;
  href: string | null;
}

export interface OperationsFailureOut {
  kind: string;
  id: string;
  title: string;
  detail: string;
  status: string;
  created_at: string;
  href: string;
}

export interface OperationsOverviewOut {
  analytics: OperationsMetricOut[];
  monitoring: OperationsCheckOut[];
  onboarding: OperationsTaskOut[];
  failures: OperationsFailureOut[];
}

export interface ProjectHealthOverviewOut {
  summary: OperationsMetricOut[];
  schedule: OperationsCheckOut;
  failures: OperationsFailureOut[];
}

// -- Pin Generator ----------------------------------------

export interface PinTemplate {
  id: string;
  name: string;
  description: string;
  image_count: number;
  colors: string[];
}

export interface GeneratePinRequest {
  template_id: string;
  title?: string;
  ingredients?: string;
  website?: string;
  image_indices?: number[];
}

export interface GeneratePinResponse {
  image_base64: string;
}

export interface BulkGeneratePinsRequest {
  template_id: string;
  website?: string;
}

export interface BulkPinItem {
  recipe_id: string;
  recipe_title: string;
  image_base64?: string;
  error?: string;
}

export interface BulkGeneratePinsResponse {
  total: number;
  generated: number;
  failed: number;
  pins: BulkPinItem[];
}

export interface PinterestBoard {
  id: string;
  name: string;
}

export interface PinterestPinRequest {
  board_id: string;
  title?: string;
  description?: string;
  link?: string;
  image_indices?: number[];
}

export interface PinterestPinResult {
  image_url: string;
  pin_id?: string;
  pin_url?: string;
  error?: string;
}

export interface PinterestBulkResponse {
  total: number;
  created: number;
  failed: number;
  pins: PinterestPinResult[];
}

export interface ThreadsProjectOut {
  id: string;
  name: string;
  description: string;
  app_id: string | null;
  created_at: string;
}

export interface ThreadsAccountOut {
  id: string;
  project_id: string;
  threads_user_id: string;
  username: string;
  token_expires_at: string | null;
  created_at: string;
}

export interface ThreadsPostOut {
  id: string;
  project_id: string;
  account_id: string;
  text_content: string;
  image_url: string | null;
  media_urls: string[] | null;
  first_comment: string | null;
  status: "draft" | "scheduled" | "published" | "failed";
  scheduled_at: string | null;
  published_at: string | null;
  threads_post_id: string | null;
  error_message: string | null;
  created_at: string;
}

