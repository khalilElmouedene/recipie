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
    return ""; // Same origin – relative URLs (reverse proxy setup)
  }
  return "http://localhost:8000";
}
const API_URL = getApiBaseUrl();

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
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

// ── Auth ────────────────────────────────────────────────
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

  me: () => request<UserOut>("/api/auth/me"),

  googleAuthUrl: () =>
    request<{ url: string; state: string }>("/api/auth/google/url"),

  googleCallback: (code: string, state: string) =>
    request<{ access_token: string }>("/api/auth/google/callback", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    }),

  // ── Users (Owner) ──────────────────────────────────────
  getUsers: () => request<UserOut[]>("/api/users"),

  createUser: (data: { email: string; full_name: string; role: string }) =>
    request<UserOut>("/api/users", { method: "POST", body: JSON.stringify(data) }),

  updateUserRole: (id: string, role: string) =>
    request<UserOut>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),

  deleteUser: (id: string) =>
    request<void>(`/api/users/${id}`, { method: "DELETE" }),

  resendInvite: (id: string) =>
    request<void>(`/api/users/${id}/resend-invite`, { method: "POST" }),

  // ── Projects ───────────────────────────────────────────
  getProjects: () => request<ProjectOut[]>("/api/projects"),

  createProject: (name: string, description: string) =>
    request<ProjectOut>("/api/projects", { method: "POST", body: JSON.stringify({ name, description }) }),

  getProject: (id: string) => request<ProjectOut>(`/api/projects/${id}`),

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

  // ── Members ────────────────────────────────────────────
  getMembers: (projectId: string) => request<MemberOut[]>(`/api/projects/${projectId}/members`),

  addMember: (projectId: string, userId: string, role: string) =>
    request<MemberOut>(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role }),
    }),

  removeMember: (projectId: string, userId: string) =>
    request<void>(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" }),

  // ── Credentials ────────────────────────────────────────
  getCredentials: (projectId: string) =>
    request<CredentialOut[]>(`/api/projects/${projectId}/credentials`),

  setCredentials: (projectId: string, creds: { key_type: string; value: string }[]) =>
    request<CredentialOut[]>(`/api/projects/${projectId}/credentials`, {
      method: "PUT",
      body: JSON.stringify(creds),
    }),

  // ── Settings (clés API globales, non liées aux projets) ──
  getSettingsCredentials: () => request<CredentialOut[]>(`/api/settings/credentials`),
  setSettingsCredentials: (creds: { key_type: string; value: string }[]) =>
    request<CredentialOut[]>(`/api/settings/credentials`, {
      method: "PUT",
      body: JSON.stringify(creds),
    }),

  getSettingsPrompts: () => request<PromptOut[]>(`/api/settings/prompts`),
  setSettingsPrompts: (prompts: Record<string, string>) =>
    request<PromptOut[]>(`/api/settings/prompts`, {
      method: "PUT",
      body: JSON.stringify({ prompts }),
    }),

  getCustomFonts: () => request<string[]>(`/api/settings/fonts`),
  setCustomFonts: (fonts: string[]) =>
    request<string[]>(`/api/settings/fonts`, {
      method: "PUT",
      body: JSON.stringify({ fonts }),
    }),

  // ── Sites ──────────────────────────────────────────────
  getSites: (projectId: string) => request<SiteOut[]>(`/api/projects/${projectId}/sites`),

  createSite: (projectId: string, data: SiteCreateData) =>
    request<SiteOut>(`/api/projects/${projectId}/sites`, { method: "POST", body: JSON.stringify(data) }),

  updateSite: (siteId: string, data: Partial<SiteCreateData>) =>
    request<SiteOut>(`/api/sites/${siteId}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteSite: (siteId: string) =>
    request<void>(`/api/sites/${siteId}`, { method: "DELETE" }),

  uploadToWordPressFromUrl: (siteId: string, params: { image_url: string; title: string; create_post?: boolean }) =>
    request<{ media_id: string; media_url: string; post_id?: string; post_url?: string }>(
      `/api/sites/${siteId}/upload-from-url?${new URLSearchParams({
        image_url: params.image_url,
        title: params.title,
        create_post: String(params.create_post ?? true),
      })}`,
      { method: "POST" }
    ),

  // ── Recipes ────────────────────────────────────────────
  getRecipes: (siteId: string, summary = true) =>
    request<RecipeOut[]>(`/api/sites/${siteId}/recipes${summary ? "?summary=true" : ""}`),

  getRecipe: (recipeId: string) => request<RecipeOut>(`/api/recipes/${recipeId}`),

  createRecipe: (siteId: string, data: { image_url: string; recipe_text: string }) =>
    request<RecipeOut>(`/api/sites/${siteId}/recipes`, { method: "POST", body: JSON.stringify(data) }),

  updateRecipe: (recipeId: string, data: {
    recipe_text?: string;
    generated_images?: string;
    pin_design_image?: string;
    pin_title?: string;
    pin_description?: string;
    pin_blog_link?: string;
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

  // ── Pin Generator ──────────────────────────────────────
  getPinTemplates: () => request<PinTemplate[]>("/api/pin-templates"),

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

  getExportUrl: (siteId: string) => {
    const token = getToken();
    return `${API_URL}/api/sites/${siteId}/recipes/export?token=${token}`;
  },

  getExcelExportUrl: (siteId: string) => {
    const token = getToken();
    return `${API_URL}/api/sites/${siteId}/export/excel?token=${token}`;
  },

  getProjectExcelExportUrl: (projectId: string) => {
    const token = getToken();
    return `${API_URL}/api/projects/${projectId}/export/excel?token=${token}`;
  },

  // ── Jobs ───────────────────────────────────────────────
  getProjectJobs: (projectId: string) => request<JobOut[]>(`/api/projects/${projectId}/jobs`),

  startJob: (projectId: string, data: { job_type: string; site_id?: string; recipe_id?: string; shared_recipes?: SharedRecipeInput[] }) =>
    request<JobOut>(`/api/projects/${projectId}/jobs`, { method: "POST", body: JSON.stringify(data) }),

  getJob: (jobId: string) => request<JobOut>(`/api/jobs/${jobId}`),

  getJobLogs: (jobId: string) => request<JobLogOut[]>(`/api/jobs/${jobId}/logs`),

  getJobGeneratedRecipes: (jobId: string) =>
    request<GeneratedJobRecipeOut[]>(`/api/jobs/${jobId}/generated-recipes`),

  stopJob: (jobId: string) =>
    request<JobOut>(`/api/jobs/${jobId}/stop`, { method: "POST" }),

  deleteJob: (jobId: string) =>
    request<void>(`/api/jobs/${jobId}`, { method: "DELETE" }),

  // ── Dashboard ──────────────────────────────────────────
  getDashboard: () => request<DashboardStats>("/api/dashboard"),
};

export function getWsUrl(jobId: string): string {
  const token = getToken();
  const base = API_URL.replace("http", "ws");
  return `${base}/ws/logs/${jobId}?token=${token}`;
}

// ── Types ────────────────────────────────────────────────

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

export interface WpUserOut {
  username: string;
}

export interface SiteOut {
  id: string;
  project_id: string;
  domain: string;
  wp_url: string;
  wp_users: WpUserOut[];
  sheet_name: string;
  spreadsheet_id: string;
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
  created_at: string;
}

export interface PublishScheduleOut {
  enabled: boolean;
  interval_hours: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
}

export interface PublishScheduleUpdate {
  enabled: boolean;
  interval_hours: number;
}

export interface JobLogOut {
  id: number;
  message: string;
  created_at: string;
}

export interface DashboardStats {
  total_projects: number;
  total_sites: number;
  total_recipes: number;
  total_jobs: number;
  projects: ProjectOut[];
}

// ── Pin Generator ────────────────────────────────────────

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
