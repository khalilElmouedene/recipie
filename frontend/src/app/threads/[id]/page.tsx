"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Plus, Trash2, User, Send, Edit2, X, RefreshCw, Clock, CheckCircle,
  AlertCircle, FileText, Image as ImageIcon, MessageSquare, Calendar,
  ChevronLeft, ChevronRight, BarChart2, Settings, BookOpen,
  LayoutGrid, ChevronDown, Circle,
} from "lucide-react";
import { api, ThreadsProjectOut, ThreadsAccountOut, ThreadsPostOut } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────
type ViewMode = "today" | "week" | "month";
type BottomTab = "planner" | "library" | "analytics" | "settings";

const STATUS_META: Record<ThreadsPostOut["status"], { label: string; dot: string; badge: string }> = {
  draft:     { label: "Draft",     dot: "bg-gray-400",  badge: "bg-gray-800 text-gray-300 border border-gray-700" },
  scheduled: { label: "Scheduled", dot: "bg-amber-400", badge: "bg-amber-900/40 text-amber-400 border border-amber-700" },
  published: { label: "Published", dot: "bg-green-400", badge: "bg-green-900/40 text-green-400 border border-green-700" },
  failed:    { label: "Failed",    dot: "bg-red-400",   badge: "bg-red-900/40 text-red-400 border border-red-700" },
};

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function postDateKey(p: ThreadsPostOut) {
  const ref = p.scheduled_at || p.published_at || p.created_at;
  return ref ? toDateKey(new Date(ref)) : null;
}
function postTime(p: ThreadsPostOut) {
  const ref = p.scheduled_at || p.published_at || p.created_at;
  if (!ref) return "";
  return new Date(ref).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function getWeekDays(anchor: Date) {
  const d = new Date(anchor);
  d.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => { const dd = new Date(d); dd.setDate(d.getDate() + i); return dd; });
}

// ── Post form modal ───────────────────────────────────────
function PostFormModal({ projectId, accounts, post, initialDate, onClose, onSaved }: {
  projectId: string; accounts: ThreadsAccountOut[]; post?: ThreadsPostOut | null;
  initialDate?: string; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!post;
  const defaultScheduled = initialDate ? `${initialDate}T09:00` : "";
  const [accountId, setAccountId] = useState(post?.account_id ?? accounts[0]?.id ?? "");
  const [text, setText] = useState(post?.text_content ?? "");
  const [imageUrl, setImageUrl] = useState(post?.image_url ?? "");
  const [firstComment, setFirstComment] = useState(post?.first_comment ?? "");
  const [publishMode, setPublishMode] = useState<"now" | "schedule">(
    post?.scheduled_at || initialDate ? "schedule" : "now"
  );
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (post?.scheduled_at) return new Date(post.scheduled_at).toISOString().slice(0, 16);
    return defaultScheduled;
  });
  const [allAccounts, setAllAccounts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allAccounts && !accountId) { setError("Select an account"); return; }
    if (!text.trim()) { setError("Text is required"); return; }
    setLoading(true); setError(null);
    try {
      const base = {
        text_content: text.trim(),
        ...(imageUrl.trim() ? { image_url: imageUrl.trim() } : {}),
        ...(firstComment.trim() ? { first_comment: firstComment.trim() } : {}),
        ...(publishMode === "schedule" && scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
      };
      if (isEdit && post) {
        await api.updateThreadsPost(post.id, { ...base, account_id: accountId });
      } else if (allAccounts) {
        await Promise.all(accounts.map((a) => api.createThreadsPost(projectId, { ...base, account_id: a.id })));
      } else {
        await api.createThreadsPost(projectId, { ...base, account_id: accountId });
      }
      onSaved();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to save"); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">{isEdit ? "Edit Post" : "New Post"}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Account</label>
            {!isEdit && accounts.length > 1 ? (
              <div className="flex rounded-xl overflow-hidden border border-gray-700">
                <button type="button" onClick={() => setAllAccounts(false)}
                  className={`flex-1 py-2.5 text-sm font-medium transition ${!allAccounts ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"}`}>
                  @{accounts.find((a) => a.id === accountId)?.username ?? "Selected"}
                </button>
                <button type="button" onClick={() => setAllAccounts(true)}
                  className={`flex-1 py-2.5 text-sm font-medium transition ${allAccounts ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"}`}>
                  All accounts ({accounts.length})
                </button>
              </div>
            ) : (
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-field">
                {accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Text</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={500}
              className="input-field resize-none" placeholder="What's on your mind?" />
            <p className={`text-xs mt-1 text-right ${text.length > 480 ? "text-yellow-400" : "text-gray-600"}`}>{text.length}/500</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Image URL (optional)</label>
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="input-field" placeholder="https://..." type="url" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">First Comment (optional)</label>
            <textarea value={firstComment} onChange={(e) => setFirstComment(e.target.value)} rows={2} className="input-field resize-none" placeholder="Add a first comment..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Publish</label>
            <div className="flex gap-4 mb-3">
              {(["now", "schedule"] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                  <input type="radio" value={m} checked={publishMode === m} onChange={() => setPublishMode(m)} className="accent-brand-500" />
                  {m === "now" ? "Publish now" : "Schedule"}
                </label>
              ))}
            </div>
            {publishMode === "schedule" && (
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required className="input-field" />
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading || !accounts.length} className="btn-primary">
              {loading ? "Saving..." : isEdit ? "Save Changes" : allAccounts ? `Create for All (${accounts.length})` : "Create Post"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Post card (calendar cell) ─────────────────────────────
function PostCard({ post, account, onEdit, onDelete, onPublish, publishing }: {
  post: ThreadsPostOut; account?: ThreadsAccountOut;
  onEdit: () => void; onDelete: () => void; onPublish: () => void; publishing: boolean;
}) {
  const { dot, badge, label } = STATUS_META[post.status];
  const time = postTime(post);
  const canPublish = post.status === "draft" || post.status === "scheduled" || post.status === "failed";

  return (
    <div className="group relative bg-gray-800 border border-gray-700 rounded-xl overflow-hidden hover:border-gray-600 transition-all hover:shadow-lg">
      {/* Status top bar */}
      <div className={`h-0.5 w-full ${dot}`} />

      <div className="p-2.5">
        {/* Time + status */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <MessageSquare size={11} className="text-gray-500" />
            <span className="text-xs font-medium text-gray-300">{time}</span>
          </div>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badge}`}>{label}</span>
        </div>

        {/* Image preview */}
        {post.image_url && (
          <div className="mb-2 rounded-lg overflow-hidden bg-gray-700 h-20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.image_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
        )}

        {/* Account + text */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="h-5 w-5 rounded-full bg-brand-600/30 flex items-center justify-center text-brand-400 shrink-0">
            <User size={10} />
          </div>
          <span className="text-xs text-gray-400 truncate">{account ? `@${account.username}` : "Unknown"}</span>
        </div>
        <p className="text-xs text-gray-200 line-clamp-2 leading-relaxed">{post.text_content}</p>

        {post.first_comment && (
          <p className="text-[10px] text-gray-600 mt-1 flex items-center gap-1 truncate">
            <MessageSquare size={9} /> {post.first_comment}
          </p>
        )}
        {post.error_message && (
          <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1 truncate">
            <AlertCircle size={9} /> {post.error_message}
          </p>
        )}

        {/* Actions (hover) */}
        <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-gray-700/50 opacity-0 group-hover:opacity-100 transition-opacity">
          {canPublish && (
            <button onClick={onPublish} disabled={publishing} title="Publish now"
              className="p-1 rounded text-gray-500 hover:text-green-400 hover:bg-gray-700 transition disabled:opacity-50">
              {publishing ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          )}
          <button onClick={onEdit} title="Edit" className="p-1 rounded text-gray-500 hover:text-brand-400 hover:bg-gray-700 transition">
            <Edit2 size={12} />
          </button>
          <button onClick={onDelete} title="Delete" className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 transition">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Week view ─────────────────────────────────────────────
function WeekView({ posts, accounts, anchor, onNewPost, onEdit, onDelete, onPublish, publishing }: {
  posts: ThreadsPostOut[]; accounts: ThreadsAccountOut[]; anchor: Date;
  onNewPost: (dateStr: string) => void;
  onEdit: (p: ThreadsPostOut) => void; onDelete: (id: string) => void;
  onPublish: (id: string) => void; publishing: string | null;
}) {
  const days = getWeekDays(anchor);
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const byDay: Record<string, ThreadsPostOut[]> = {};
  posts.forEach((p) => { const k = postDateKey(p); if (k) (byDay[k] = byDay[k] || []).push(p); });

  const todayKey = toDateKey(new Date());

  return (
    <div className="flex flex-1 min-h-0 overflow-x-auto">
      {days.map((day) => {
        const key = toDateKey(day);
        const dayPosts = (byDay[key] || []).sort((a, b) => {
          const at = a.scheduled_at || a.published_at || a.created_at || "";
          const bt = b.scheduled_at || b.published_at || b.created_at || "";
          return at.localeCompare(bt);
        });
        const isToday = key === todayKey;
        const dayName = day.toLocaleDateString("en", { weekday: "short" });
        const dayNum = day.getDate();

        return (
          <div key={key} className="flex-1 min-w-[150px] flex flex-col border-r border-gray-800 last:border-r-0">
            {/* Day header */}
            <div className={`px-3 py-2.5 border-b border-gray-800 ${isToday ? "bg-brand-600/10" : ""}`}>
              <p className={`text-xs font-medium ${isToday ? "text-brand-400" : "text-gray-500"}`}>{dayName}</p>
              <p className={`text-lg font-bold leading-tight ${isToday ? "text-brand-300" : "text-gray-300"}`}>{dayNum}</p>
            </div>

            {/* Posts */}
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {dayPosts.map((p) => (
                <PostCard
                  key={p.id} post={p} account={accountMap[p.account_id]}
                  onEdit={() => onEdit(p)} onDelete={() => onDelete(p.id)}
                  onPublish={() => onPublish(p.id)} publishing={publishing === p.id}
                />
              ))}

              {/* Add button */}
              <button
                onClick={() => onNewPost(key)}
                className="w-full py-2 rounded-xl border border-dashed border-gray-700 text-gray-600 hover:border-brand-600 hover:text-brand-500 transition text-xs flex items-center justify-center gap-1"
              >
                <Plus size={11} /> Add
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Month view ────────────────────────────────────────────
function MonthView({ posts, accounts, anchor, onNewPost, onEdit, onDelete, onPublish, publishing }: {
  posts: ThreadsPostOut[]; accounts: ThreadsAccountOut[]; anchor: Date;
  onNewPost: (dateStr: string) => void;
  onEdit: (p: ThreadsPostOut) => void; onDelete: (id: string) => void;
  onPublish: (id: string) => void; publishing: string | null;
}) {
  const year = anchor.getFullYear(); const month = anchor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const byDay: Record<string, ThreadsPostOut[]> = {};
  posts.forEach((p) => { const k = postDateKey(p); if (k) (byDay[k] = byDay[k] || []).push(p); });
  const todayKey = toDateKey(new Date());
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-7 border-b border-gray-800">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
          <div key={d} className="px-3 py-2 text-xs font-medium text-gray-500 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="border-r border-b border-gray-800/50 min-h-[100px]" />;
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayPosts = byDay[key] || [];
          const isToday = key === todayKey;
          return (
            <div key={key} className="border-r border-b border-gray-800/50 min-h-[100px] p-1.5 group cursor-pointer hover:bg-gray-800/20 transition"
              onClick={() => onNewPost(key)}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-brand-600 text-white" : "text-gray-400"}`}>{day}</span>
              </div>
              <div className="space-y-0.5" onClick={(e) => e.stopPropagation()}>
                {dayPosts.slice(0, 3).map((p) => {
                  const { dot } = STATUS_META[p.status];
                  return (
                    <div key={p.id} className="flex items-center gap-1 rounded px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 transition cursor-pointer"
                      onClick={() => onEdit(p)}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                      <span className="text-[10px] text-gray-300 truncate">{postTime(p)} {p.text_content}</span>
                    </div>
                  );
                })}
                {dayPosts.length > 3 && (
                  <p className="text-[10px] text-gray-600 px-1.5">+{dayPosts.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Today view ────────────────────────────────────────────
function TodayView({ posts, accounts, onNewPost, onEdit, onDelete, onPublish, publishing }: {
  posts: ThreadsPostOut[]; accounts: ThreadsAccountOut[];
  onNewPost: (dateStr: string) => void;
  onEdit: (p: ThreadsPostOut) => void; onDelete: (id: string) => void;
  onPublish: (id: string) => void; publishing: string | null;
}) {
  const todayKey = toDateKey(new Date());
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const todayPosts = posts.filter((p) => postDateKey(p) === todayKey)
    .sort((a, b) => (a.scheduled_at || a.created_at || "").localeCompare(b.scheduled_at || b.created_at || ""));

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-xl mx-auto">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Calendar size={14} /> Today — {new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}
        </h3>
        {todayPosts.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-gray-800 rounded-2xl">
            <p className="text-gray-600 text-sm mb-3">No posts today</p>
            <button onClick={() => onNewPost(todayKey)} className="btn-primary flex items-center gap-1.5 mx-auto text-sm">
              <Plus size={14} /> Schedule Post
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {todayPosts.map((p) => (
              <PostCard key={p.id} post={p} account={accountMap[p.account_id]}
                onEdit={() => onEdit(p)} onDelete={() => onDelete(p.id)}
                onPublish={() => onPublish(p.id)} publishing={publishing === p.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Content Library ───────────────────────────────────────
function ContentLibrary({ posts, accounts, projectId, onRefresh }: {
  posts: ThreadsPostOut[]; accounts: ThreadsAccountOut[]; projectId: string; onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<ThreadsPostOut["status"] | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [editPost, setEditPost] = useState<ThreadsPostOut | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  const filtered = filter === "all" ? posts : posts.filter((p) => p.status === filter);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try { await api.deleteThreadsPost(id); onRefresh(); } catch { /* ignore */ }
    setDeleting(null);
  };
  const handlePublish = async (id: string) => {
    setPublishing(id);
    try { await api.publishThreadsPost(id); onRefresh(); } catch { /* ignore */ }
    setPublishing(null);
  };

  return (
    <div className="flex flex-col gap-4 p-4 flex-1 overflow-auto">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
          {(["all", "draft", "scheduled", "published", "failed"] as const).map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition capitalize ${filter === s ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
              {s === "all" ? `All (${posts.length})` : `${STATUS_META[s].label} (${posts.filter((p) => p.status === s).length})`}
            </button>
          ))}
        </div>
        <button onClick={() => { setEditPost(null); setShowForm(true); }} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={14} /> New Post
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-600 text-sm">No posts found.</div>
        ) : filtered.map((p) => {
          const account = accountMap[p.account_id];
          const { badge, label, dot } = STATUS_META[p.status];
          const canPublish = p.status === "draft" || p.status === "scheduled" || p.status === "failed";
          return (
            <div key={p.id} className="card flex items-start gap-3 py-3 px-4">
              <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400">{account ? `@${account.username}` : "Unknown"}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badge}`}>{label}</span>
                  <span className="text-xs text-gray-600">{postTime(p)}</span>
                </div>
                <p className="text-sm text-gray-200 line-clamp-2">{p.text_content}</p>
                {p.first_comment && <p className="text-xs text-gray-600 mt-0.5 truncate"><MessageSquare size={9} className="inline mr-1" />{p.first_comment}</p>}
                {p.error_message && <p className="text-xs text-red-400 mt-0.5"><AlertCircle size={9} className="inline mr-1" />{p.error_message}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canPublish && (
                  <button onClick={() => handlePublish(p.id)} disabled={publishing === p.id}
                    className="p-1.5 rounded text-gray-500 hover:text-green-400 hover:bg-gray-800 transition disabled:opacity-50">
                    {publishing === p.id ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                  </button>
                )}
                <button onClick={() => { setEditPost(p); setShowForm(true); }}
                  className="p-1.5 rounded text-gray-500 hover:text-brand-400 hover:bg-gray-800 transition"><Edit2 size={13} /></button>
                <button onClick={() => handleDelete(p.id)} disabled={deleting === p.id}
                  className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800 transition disabled:opacity-50">
                  {deleting === p.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {(showForm || editPost) && (
        <PostFormModal projectId={projectId} accounts={accounts} post={editPost}
          onClose={() => { setShowForm(false); setEditPost(null); }}
          onSaved={() => { setShowForm(false); setEditPost(null); onRefresh(); }} />
      )}
    </div>
  );
}

// ── Analytics ─────────────────────────────────────────────
function AnalyticsTab({ posts, accounts }: { posts: ThreadsPostOut[]; accounts: ThreadsAccountOut[] }) {
  const total = posts.length;
  const byStatus = posts.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {} as Record<string, number>);
  const byAccount = posts.reduce((a, p) => { a[p.account_id] = (a[p.account_id] || 0) + 1; return a; }, {} as Record<string, number>);
  const last30 = posts.filter((p) => { const r = p.published_at || p.scheduled_at || p.created_at; return r && Date.now() - new Date(r).getTime() < 30 * 864e5; });

  const days14: { label: string; key: string; count: number }[] = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    const key = toDateKey(d);
    return { label: d.toLocaleDateString("en", { month: "short", day: "numeric" }), key, count: posts.filter((p) => postDateKey(p) === key).length };
  });
  const maxCount = Math.max(...days14.map((d) => d.count), 1);

  const cards = [
    { label: "Total Posts", value: total, color: "text-white" },
    { label: "Published", value: byStatus.published || 0, color: "text-green-400" },
    { label: "Scheduled", value: byStatus.scheduled || 0, color: "text-amber-400" },
    { label: "Draft", value: byStatus.draft || 0, color: "text-gray-400" },
    { label: "Failed", value: byStatus.failed || 0, color: "text-red-400" },
    { label: "Last 30 Days", value: last30.length, color: "text-brand-400" },
  ];

  return (
    <div className="p-4 space-y-5 flex-1 overflow-auto">
      <div className="grid grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2"><BarChart2 size={14} /> Activity — Last 14 Days</h3>
        <div className="flex items-end gap-1 h-28">
          {days14.map((d) => (
            <div key={d.key} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end justify-center" style={{ height: "88px" }}>
                <div className="w-full rounded-t bg-brand-600 transition-all"
                  style={{ height: `${(d.count / maxCount) * 100}%`, minHeight: d.count > 0 ? "4px" : "0" }}
                  title={`${d.label}: ${d.count}`} />
              </div>
              <span className="text-[9px] text-gray-600">{d.label.split(" ")[1]}</span>
            </div>
          ))}
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2"><User size={14} /> Posts by Account</h3>
          <div className="space-y-3">
            {accounts.map((a) => {
              const count = byAccount[a.id] || 0;
              return (
                <div key={a.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-300">@{a.username}</span>
                    <span className="text-gray-500">{count}</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full">
                    <div className="h-full bg-brand-600 rounded-full" style={{ width: total > 0 ? `${(count / total) * 100}%` : "0%" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────
function SettingsTab({ projectId, onAccountsChanged }: { projectId: string; onAccountsChanged: () => void }) {
  const [accounts, setAccounts] = useState<ThreadsAccountOut[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const load = useCallback(() => {
    api.getThreadsAccounts(projectId).then(setAccounts).catch(() => setError("Failed to load accounts"));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (!event.data?.code && !event.data?.error) return;
      if (event.data.error) { setError(`OAuth error: ${event.data.error}`); setConnecting(false); return; }
      const { code, state } = event.data as { code: string; state: string };
      setConnecting(true);
      try { await api.connectThreadsAccount({ code, state }); load(); onAccountsChanged(); }
      catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to connect"); }
      setConnecting(false);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [load, onAccountsChanged]);

  const handleConnect = async () => {
    setError(null); setConnecting(true);
    try {
      const { url } = await api.getThreadsOAuthUrl(projectId);
      const popup = window.open(url, "threads-oauth", "width=600,height=700");
      popupRef.current = popup;
      if (!popup) { setError("Popup blocked."); setConnecting(false); }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "OAuth error"); setConnecting(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try { await api.deleteThreadsAccount(projectId, id); setDeleteConfirm(null); load(); onAccountsChanged(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed"); }
    setDeleting(null);
  };

  return (
    <div className="p-4 max-w-lg flex-1 overflow-auto">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">Connected Accounts</h3>
      {error && (
        <div className="mb-3 flex items-center gap-2 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-400">
          <AlertCircle size={12} /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}
      <div className="space-y-2 mb-4">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 bg-gray-800/50 border border-gray-800 rounded-xl px-4 py-3">
            <div className="h-8 w-8 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-400">
              <User size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-200">@{a.username}</p>
              {a.token_expires_at && <p className="text-xs text-gray-600">Expires {new Date(a.token_expires_at).toLocaleDateString()}</p>}
            </div>
            {deleteConfirm === a.id ? (
              <div className="flex items-center gap-1.5">
                <button onClick={() => handleDelete(a.id)} disabled={deleting === a.id}
                  className="text-xs bg-red-600 hover:bg-red-500 text-white rounded px-2 py-1 transition">{deleting === a.id ? "..." : "Remove"}</button>
                <button onClick={() => setDeleteConfirm(null)} className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-1 transition">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setDeleteConfirm(a.id)} className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-700 transition"><Trash2 size={14} /></button>
            )}
          </div>
        ))}
      </div>
      <button onClick={handleConnect} disabled={connecting}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-700 py-3 text-sm text-gray-500 hover:border-brand-600 hover:text-brand-400 transition disabled:opacity-50">
        {connecting ? <><RefreshCw size={14} className="animate-spin" /> Connecting...</> : <><Plus size={14} /> Connect New Account</>}
      </button>
    </div>
  );
}

// ── Accounts sidebar ──────────────────────────────────────
function AccountsSidebar({ accounts, selectedId, onSelect, onConnect, connecting }: {
  accounts: ThreadsAccountOut[]; selectedId: string | null;
  onSelect: (id: string | null) => void; onConnect: () => void; connecting: boolean;
}) {
  return (
    <aside className="w-52 shrink-0 border-r border-gray-800 flex flex-col">
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <button
          onClick={() => onSelect(null)}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${selectedId === null ? "bg-brand-600/20 text-brand-300" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`}
        >
          <div className="h-7 w-7 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
            <LayoutGrid size={12} className="text-gray-400" />
          </div>
          <span className="truncate font-medium">All accounts</span>
        </button>

        {accounts.map((a) => (
          <button key={a.id} onClick={() => onSelect(selectedId === a.id ? null : a.id)}
            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition group ${selectedId === a.id ? "bg-brand-600/20 text-brand-300" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`}>
            <div className="h-7 w-7 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-400 shrink-0">
              <User size={12} />
            </div>
            <span className="flex-1 text-left truncate">@{a.username}</span>
            <CheckCircle size={13} className={selectedId === a.id ? "text-brand-400 shrink-0" : "text-gray-600 shrink-0 opacity-0 group-hover:opacity-100"} />
          </button>
        ))}
      </div>

      <div className="p-2 border-t border-gray-800">
        <button onClick={onConnect} disabled={connecting}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm text-gray-500 border border-dashed border-gray-700 hover:border-brand-600 hover:text-brand-400 transition disabled:opacity-50">
          {connecting ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
          Add Account
        </button>
      </div>
    </aside>
  );
}

// ── Main page ─────────────────────────────────────────────
export default function ThreadsProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [project, setProject] = useState<ThreadsProjectOut | null>(null);
  const [projects, setProjects] = useState<ThreadsProjectOut[]>([]);
  const [accounts, setAccounts] = useState<ThreadsAccountOut[]>([]);
  const [posts, setPosts] = useState<ThreadsPostOut[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(new Date());
  const [bottomTab, setBottomTab] = useState<BottomTab>("planner");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showProjectMenu, setShowProjectMenu] = useState(false);

  // Post actions
  const [showForm, setShowForm] = useState(false);
  const [editPost, setEditPost] = useState<ThreadsPostOut | null>(null);
  const [newPostDate, setNewPostDate] = useState<string | undefined>(undefined);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [publishingAll, setPublishingAll] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // OAuth
  const [connecting, setConnecting] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const loadData = useCallback(() => {
    if (!id) return;
    Promise.all([
      api.getThreadsProjects(),
      api.getThreadsPosts(id),
      api.getThreadsAccounts(id),
    ]).then(([projectsList, postsData, accountsData]) => {
      const found = projectsList.find((p) => p.id === id);
      if (!found) { router.push("/threads"); return; }
      setProject(found);
      setProjects(projectsList);
      setPosts(postsData);
      setAccounts(accountsData);
    }).catch(() => router.push("/threads"))
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => { loadData(); }, [loadData]);

  // OAuth popup handler
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (!event.data?.code && !event.data?.error) return;
      if (event.data.error) { setConnecting(false); return; }
      const { code, state } = event.data as { code: string; state: string };
      setConnecting(true);
      try { await api.connectThreadsAccount({ code, state }); loadData(); }
      catch { /* ignore */ }
      setConnecting(false);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [loadData]);

  const handleConnect = async () => {
    if (!id) return;
    setConnecting(true);
    try {
      const { url } = await api.getThreadsOAuthUrl(id);
      const popup = window.open(url, "threads-oauth", "width=600,height=700");
      popupRef.current = popup;
      if (!popup) setConnecting(false);
    } catch { setConnecting(false); }
  };

  const handlePublish = async (postId: string) => {
    setPublishing(postId);
    try { await api.publishThreadsPost(postId); loadData(); } catch { /* ignore */ }
    setPublishing(null);
  };

  const handlePublishAll = async () => {
    const publishableIds = visiblePosts
      .filter((p) => p.status === "draft" || p.status === "scheduled" || p.status === "failed")
      .map((p) => p.id);
    if (!publishableIds.length) return;
    setPublishingAll(true);
    try { await api.batchPublishThreadsPosts(publishableIds); loadData(); } catch { /* ignore */ }
    setPublishingAll(false);
  };

  const handleDelete = async (postId: string) => {
    if (deleteConfirm !== postId) { setDeleteConfirm(postId); return; }
    try { await api.deleteThreadsPost(postId); setDeleteConfirm(null); loadData(); } catch { /* ignore */ }
  };

  const handleNewPost = (dateStr: string) => {
    setNewPostDate(dateStr); setEditPost(null); setShowForm(true);
  };

  // Navigation label
  const navLabel = () => {
    if (viewMode === "today") return new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });
    if (viewMode === "week") {
      const days = getWeekDays(anchor);
      const first = days[0]; const last = days[6];
      if (first.getMonth() === last.getMonth()) return `${first.toLocaleDateString("en", { month: "long" })} ${first.getDate()}–${last.getDate()}, ${first.getFullYear()}`;
      return `${first.toLocaleDateString("en", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return anchor.toLocaleDateString("en", { month: "long", year: "numeric" });
  };

  const navigate = (dir: -1 | 1) => {
    const d = new Date(anchor);
    if (viewMode === "week") d.setDate(d.getDate() + dir * 7);
    else if (viewMode === "month") d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  };

  // Filter posts by selected account
  const visiblePosts = selectedAccountId ? posts.filter((p) => p.account_id === selectedAccountId) : posts;

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw size={20} className="animate-spin text-gray-500" /></div>;
  }

  const bottomTabs = [
    { key: "planner" as const, label: "Planner", icon: Calendar },
    { key: "library" as const, label: "Content Library", icon: BookOpen },
    { key: "analytics" as const, label: "Analytics", icon: BarChart2 },
    { key: "settings" as const, label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] -mx-4 -mt-4">

      {/* ── Top header ── */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-950 shrink-0">
        {/* Project selector */}
        <div className="relative">
          <button onClick={() => setShowProjectMenu((v) => !v)}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl px-3 py-2 text-sm font-medium text-gray-200 transition">
            <Circle size={8} className="text-brand-400 fill-brand-400" />
            {project?.name}
            <ChevronDown size={14} className="text-gray-500" />
          </button>
          {showProjectMenu && (
            <div className="absolute top-full left-0 mt-1 z-30 bg-gray-900 border border-gray-700 rounded-xl shadow-xl min-w-[180px] py-1">
              {projects.map((pr) => (
                <button key={pr.id} onClick={() => { setShowProjectMenu(false); if (pr.id !== id) router.push(`/threads/${pr.id}`); }}
                  className={`w-full text-left px-4 py-2 text-sm transition flex items-center gap-2 ${pr.id === id ? "text-brand-400 bg-brand-600/10" : "text-gray-300 hover:bg-gray-800"}`}>
                  <Circle size={7} className={pr.id === id ? "text-brand-400 fill-brand-400" : "text-gray-600"} />
                  {pr.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Account filter */}
        <select
          value={selectedAccountId ?? ""}
          onChange={(e) => setSelectedAccountId(e.target.value || null)}
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
        </select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Navigation (planner only) */}
        {bottomTab === "planner" && viewMode !== "today" && (
          <div className="flex items-center gap-2">
            <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"><ChevronLeft size={16} /></button>
            <span className="text-sm text-gray-300 min-w-[200px] text-center">{navLabel()}</span>
            <button onClick={() => navigate(1)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"><ChevronRight size={16} /></button>
          </div>
        )}

        {/* View toggle */}
        {bottomTab === "planner" && (
          <div className="flex bg-gray-800 border border-gray-700 rounded-xl p-0.5">
            {(["today", "week", "month"] as const).map((v) => (
              <button key={v} onClick={() => { setViewMode(v); if (v === "today") setAnchor(new Date()); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition capitalize ${viewMode === v ? "bg-gray-600 text-white" : "text-gray-400 hover:text-gray-200"}`}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Publish all */}
        {visiblePosts.some((p) => p.status === "draft" || p.status === "scheduled" || p.status === "failed") && (
          <button onClick={handlePublishAll} disabled={publishingAll}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-green-700 text-green-400 hover:bg-green-900/30 transition disabled:opacity-50">
            {publishingAll ? <><RefreshCw size={14} className="animate-spin" /> Publishing...</> : <><Send size={14} /> Publish All</>}
          </button>
        )}

        {/* New post */}
        <button onClick={() => { setEditPost(null); setNewPostDate(undefined); setShowForm(true); }}
          className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={14} /> New Post
        </button>
      </header>

      {/* ── Main content ── */}
      <div className="flex flex-1 min-h-0">
        {/* Accounts sidebar */}
        <AccountsSidebar
          accounts={accounts}
          selectedId={selectedAccountId}
          onSelect={setSelectedAccountId}
          onConnect={handleConnect}
          connecting={connecting}
        />

        {/* Right panel */}
        <div className="flex-1 min-w-0 flex flex-col">

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {bottomTab === "planner" && viewMode === "week" && (
              <WeekView posts={visiblePosts} accounts={accounts} anchor={anchor}
                onNewPost={handleNewPost} onEdit={(p) => { setEditPost(p); setShowForm(true); }}
                onDelete={handleDelete} onPublish={handlePublish} publishing={publishing} />
            )}
            {bottomTab === "planner" && viewMode === "month" && (
              <MonthView posts={visiblePosts} accounts={accounts} anchor={anchor}
                onNewPost={handleNewPost} onEdit={(p) => { setEditPost(p); setShowForm(true); }}
                onDelete={handleDelete} onPublish={handlePublish} publishing={publishing} />
            )}
            {bottomTab === "planner" && viewMode === "today" && (
              <TodayView posts={visiblePosts} accounts={accounts}
                onNewPost={handleNewPost} onEdit={(p) => { setEditPost(p); setShowForm(true); }}
                onDelete={handleDelete} onPublish={handlePublish} publishing={publishing} />
            )}
            {bottomTab === "library" && (
              <ContentLibrary posts={visiblePosts} accounts={accounts} projectId={id} onRefresh={loadData} />
            )}
            {bottomTab === "analytics" && (
              <AnalyticsTab posts={visiblePosts} accounts={accounts} />
            )}
            {bottomTab === "settings" && (
              <SettingsTab projectId={id} onAccountsChanged={loadData} />
            )}
          </div>

          {/* Bottom tab bar */}
          <div className="shrink-0 border-t border-gray-800 bg-gray-950 flex items-center px-2">
            {bottomTabs.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setBottomTab(key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-t-2 transition ${
                  bottomTab === key ? "border-brand-500 text-brand-400" : "border-transparent text-gray-500 hover:text-gray-300"
                }`}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Post form modal */}
      {(showForm || editPost) && (
        <PostFormModal
          projectId={id} accounts={accounts} post={editPost} initialDate={newPostDate}
          onClose={() => { setShowForm(false); setEditPost(null); setNewPostDate(undefined); }}
          onSaved={() => { setShowForm(false); setEditPost(null); setNewPostDate(undefined); loadData(); }}
        />
      )}
    </div>
  );
}
