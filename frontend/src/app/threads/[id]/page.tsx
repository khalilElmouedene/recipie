"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, User, Send, Edit2, X, RefreshCw, Clock, CheckCircle,
  AlertCircle, FileText, Image as ImageIcon, MessageSquare, Calendar,
} from "lucide-react";
import { api, ThreadsProjectOut, ThreadsAccountOut, ThreadsPostOut } from "@/lib/api";

type Tab = "accounts" | "posts";

// ── Status badge ─────────────────────────────────────────
function StatusBadge({ status }: { status: ThreadsPostOut["status"] }) {
  const map: Record<ThreadsPostOut["status"], { label: string; cls: string; icon: React.ElementType }> = {
    draft: { label: "Draft", cls: "bg-gray-700 text-gray-300", icon: FileText },
    scheduled: { label: "Scheduled", cls: "bg-blue-900/50 text-blue-400 border border-blue-700", icon: Clock },
    published: { label: "Published", cls: "bg-green-900/50 text-green-400 border border-green-700", icon: CheckCircle },
    failed: { label: "Failed", cls: "bg-red-900/50 text-red-400 border border-red-700", icon: AlertCircle },
  };
  const { label, cls, icon: Icon } = map[status] ?? map.draft;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <Icon size={11} />
      {label}
    </span>
  );
}

// ── Post form modal ───────────────────────────────────────
interface PostFormProps {
  projectId: string;
  accounts: ThreadsAccountOut[];
  post?: ThreadsPostOut | null;
  onClose: () => void;
  onSaved: () => void;
}

function PostFormModal({ projectId, accounts, post, onClose, onSaved }: PostFormProps) {
  const isEdit = !!post;
  const [accountId, setAccountId] = useState(post?.account_id ?? accounts[0]?.id ?? "");
  const [text, setText] = useState(post?.text_content ?? "");
  const [imageUrl, setImageUrl] = useState(post?.image_url ?? "");
  const [firstComment, setFirstComment] = useState(post?.first_comment ?? "");
  const [publishMode, setPublishMode] = useState<"now" | "schedule">(
    post?.scheduled_at ? "schedule" : "now"
  );
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (post?.scheduled_at) {
      return new Date(post.scheduled_at).toISOString().slice(0, 16);
    }
    return "";
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) { setError("Select an account"); return; }
    if (!text.trim()) { setError("Text content is required"); return; }
    setLoading(true);
    setError(null);
    try {
      const payload: {
        account_id: string;
        text_content: string;
        image_url?: string;
        first_comment?: string;
        scheduled_at?: string;
      } = {
        account_id: accountId,
        text_content: text.trim(),
        ...(imageUrl.trim() ? { image_url: imageUrl.trim() } : {}),
        ...(firstComment.trim() ? { first_comment: firstComment.trim() } : {}),
        ...(publishMode === "schedule" && scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
      };

      if (isEdit && post) {
        await api.updateThreadsPost(post.id, payload);
      } else {
        await api.createThreadsPost(projectId, payload);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save post");
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h2 className="text-base font-semibold text-white">{isEdit ? "Edit Post" : "New Post"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-700 bg-red-900/20 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Account selector */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Account</label>
            {accounts.length === 0 ? (
              <p className="text-sm text-yellow-400">No connected accounts. Connect an account first.</p>
            ) : (
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="input-field"
                required
              >
                <option value="">Select account...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>@{a.username}</option>
                ))}
              </select>
            )}
          </div>

          {/* Text content */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              <span className="flex items-center gap-1.5"><MessageSquare size={14} /> Text Content</span>
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              maxLength={500}
              rows={4}
              className="input-field resize-none"
              placeholder="What's on your mind?"
            />
            <p className={`text-xs mt-1 text-right ${text.length > 480 ? "text-yellow-400" : "text-gray-500"}`}>
              {text.length}/500
            </p>
          </div>

          {/* Image URL */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              <span className="flex items-center gap-1.5"><ImageIcon size={14} /> Image URL (optional)</span>
            </label>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className="input-field"
              placeholder="https://example.com/image.jpg"
              type="url"
            />
          </div>

          {/* First comment */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              <span className="flex items-center gap-1.5"><MessageSquare size={14} /> First Comment (optional)</span>
            </label>
            <textarea
              value={firstComment}
              onChange={(e) => setFirstComment(e.target.value)}
              rows={2}
              className="input-field resize-none"
              placeholder="Add a first comment..."
            />
          </div>

          {/* Publish mode */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Publish</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                <input
                  type="radio"
                  value="now"
                  checked={publishMode === "now"}
                  onChange={() => setPublishMode("now")}
                  className="accent-brand-500"
                />
                Publish now
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                <input
                  type="radio"
                  value="schedule"
                  checked={publishMode === "schedule"}
                  onChange={() => setPublishMode("schedule")}
                  className="accent-brand-500"
                />
                Schedule
              </label>
            </div>

            {publishMode === "schedule" && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  <span className="flex items-center gap-1.5"><Calendar size={14} /> Scheduled At</span>
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required={publishMode === "schedule"}
                  className="input-field"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading || accounts.length === 0} className="btn-primary">
              {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Post"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Accounts Tab ─────────────────────────────────────────
function AccountsTab({ projectId }: { projectId: string }) {
  const [accounts, setAccounts] = useState<ThreadsAccountOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getThreadsAccounts(projectId)
      .then(setAccounts)
      .catch(() => setError("Failed to load accounts"))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (!event.data?.code && !event.data?.error) return;
      if (event.data.error) {
        setError(`OAuth error: ${event.data.error}`);
        setConnecting(false);
        return;
      }
      const { code, state } = event.data as { code: string; state: string };
      setConnecting(true);
      try {
        await api.connectThreadsAccount({ code, state });
        load();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to connect account");
      }
      setConnecting(false);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [load]);

  const handleConnect = async () => {
    setError(null);
    setConnecting(true);
    try {
      const { url } = await api.getThreadsOAuthUrl(projectId);
      const popup = window.open(url, "threads-oauth", "width=600,height=700,scrollbars=yes");
      popupRef.current = popup;
      if (!popup) {
        setError("Popup blocked. Please allow popups for this site.");
        setConnecting(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to get OAuth URL");
      setConnecting(false);
    }
  };

  const handleDelete = async (accountId: string) => {
    setDeleting(accountId);
    try {
      await api.deleteThreadsAccount(projectId, accountId);
      setDeleteConfirm(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
    }
    setDeleting(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">{accounts.length} connected account{accounts.length !== 1 ? "s" : ""}</p>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="btn-primary flex items-center gap-2"
        >
          {connecting ? (
            <><RefreshCw size={16} className="animate-spin" /> Connecting...</>
          ) : (
            <><Plus size={16} /> Connect Account</>
          )}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-700 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="shrink-0 hover:text-red-200">
            <X size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="card animate-pulse flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-gray-700" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-700 rounded w-1/4" />
                <div className="h-2 bg-gray-700 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No connected accounts. Click "Connect Account" to link a Threads profile.
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="card flex items-center gap-4 relative">
              <div className="h-10 w-10 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-400 shrink-0">
                <User size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white">@{a.username}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                  <span>Connected {new Date(a.created_at).toLocaleDateString()}</span>
                  {a.token_expires_at && (
                    <span>Expires {new Date(a.token_expires_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>

              {deleteConfirm === a.id ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-gray-300">Remove?</span>
                  <button
                    onClick={() => handleDelete(a.id)}
                    disabled={deleting === a.id}
                    className="rounded px-2.5 py-1 text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition"
                  >
                    {deleting === a.id ? "Removing..." : "Yes"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="rounded px-2.5 py-1 text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirm(a.id)}
                  title="Remove account"
                  className="shrink-0 p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-800 transition"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Posts Tab ─────────────────────────────────────────────
function PostsTab({ projectId }: { projectId: string }) {
  const [posts, setPosts] = useState<ThreadsPostOut[]>([]);
  const [accounts, setAccounts] = useState<ThreadsAccountOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editPost, setEditPost] = useState<ThreadsPostOut | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getThreadsPosts(projectId),
      api.getThreadsAccounts(projectId),
    ])
      .then(([postsData, accountsData]) => {
        setPosts(postsData);
        setAccounts(accountsData);
      })
      .catch(() => setError("Failed to load posts"))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (postId: string) => {
    setDeleting(postId);
    try {
      await api.deleteThreadsPost(postId);
      setDeleteConfirm(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete post");
    }
    setDeleting(null);
  };

  const handlePublish = async (postId: string) => {
    setPublishing(postId);
    setError(null);
    try {
      await api.publishThreadsPost(postId);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to publish post");
    }
    setPublishing(null);
  };

  const handleFormSaved = () => {
    setShowForm(false);
    setEditPost(null);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">{posts.length} post{posts.length !== 1 ? "s" : ""}</p>
        <button
          onClick={() => { setEditPost(null); setShowForm(true); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={16} /> New Post
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-700 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="shrink-0 hover:text-red-200">
            <X size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse space-y-2">
              <div className="h-3 bg-gray-700 rounded w-1/4" />
              <div className="h-4 bg-gray-700 rounded w-3/4" />
              <div className="h-3 bg-gray-700 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No posts yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => {
            const account = accountMap[p.account_id];
            const canPublish = p.status === "draft" || p.status === "scheduled" || p.status === "failed";
            return (
              <div key={p.id} className="card">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-400 shrink-0 mt-0.5">
                    <User size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-300">
                        {account ? `@${account.username}` : "Unknown account"}
                      </span>
                      <StatusBadge status={p.status} />
                      {p.scheduled_at && p.status === "scheduled" && (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock size={11} /> {new Date(p.scheduled_at).toLocaleString()}
                        </span>
                      )}
                      {p.published_at && p.status === "published" && (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <CheckCircle size={11} /> {new Date(p.published_at).toLocaleString()}
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-gray-200 whitespace-pre-wrap break-words line-clamp-3">
                      {p.text_content}
                    </p>

                    {p.image_url && (
                      <p className="text-xs text-blue-400 mt-1 flex items-center gap-1 truncate">
                        <ImageIcon size={11} /> {p.image_url}
                      </p>
                    )}
                    {p.first_comment && (
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <MessageSquare size={11} />
                        <span className="truncate">{p.first_comment}</span>
                      </p>
                    )}
                    {p.error_message && (
                      <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                        <AlertCircle size={11} /> {p.error_message}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {canPublish && (
                      deleteConfirm !== p.id ? (
                        <button
                          onClick={() => handlePublish(p.id)}
                          disabled={publishing === p.id}
                          title="Publish now"
                          className="p-1.5 rounded text-gray-500 hover:text-green-400 hover:bg-gray-800 transition disabled:opacity-50"
                        >
                          {publishing === p.id
                            ? <RefreshCw size={15} className="animate-spin" />
                            : <Send size={15} />}
                        </button>
                      ) : null
                    )}

                    {deleteConfirm === p.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">Delete?</span>
                        <button
                          onClick={() => handleDelete(p.id)}
                          disabled={deleting === p.id}
                          className="rounded px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition"
                        >
                          {deleting === p.id ? "..." : "Yes"}
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="rounded px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 transition"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditPost(p); setShowForm(true); }}
                          title="Edit post"
                          className="p-1.5 rounded text-gray-500 hover:text-brand-400 hover:bg-gray-800 transition"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(p.id)}
                          title="Delete post"
                          className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800 transition"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(showForm || editPost) && (
        <PostFormModal
          projectId={projectId}
          accounts={accounts}
          post={editPost}
          onClose={() => { setShowForm(false); setEditPost(null); }}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────
export default function ThreadsProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ThreadsProjectOut | null>(null);
  const [tab, setTab] = useState<Tab>("accounts");

  useEffect(() => {
    api.getThreadsProjects()
      .then((list) => {
        const found = list.find((p) => p.id === id);
        if (found) setProject(found);
        else router.push("/threads");
      })
      .catch(() => router.push("/threads"));
  }, [id, router]);

  if (!project) {
    return <div className="text-gray-400">Loading...</div>;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "accounts", label: "Accounts" },
    { key: "posts", label: "Posts" },
  ];

  return (
    <div>
      <button
        onClick={() => router.push("/threads")}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4 transition"
      >
        <ArrowLeft size={16} /> Back to Threads Projects
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{project.name}</h1>
        {project.description && (
          <p className="text-sm text-gray-400 mt-1">{project.description}</p>
        )}
        <p className="text-xs text-gray-600 mt-1">
          Created {new Date(project.created_at).toLocaleDateString()}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.key
                ? "border-brand-500 text-brand-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "accounts" && <AccountsTab projectId={id} />}
      {tab === "posts" && <PostsTab projectId={id} />}
    </div>
  );
}
