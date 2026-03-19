"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Key, MessageSquare, LayoutTemplate, Plus, Trash2,
  Bot, Image as ImageIcon, FileJson, Shield, Save,
} from "lucide-react";
import { api, CredentialOut, PromptOut, PinDesignerTemplateOut } from "@/lib/api";

// ── Credential groups ──────────────────────────────────────────────────────

const KEY_GROUPS = [
  {
    title: "ChatGPT / OpenAI",
    description: "Key for article and recipe generation",
    icon: Bot,
    keys: [
      { key: "openai", label: "OpenAI API Key", placeholder: "sk-...", type: "password" },
    ],
  },
  {
    title: "Midjourney (Discord)",
    description: "Discord configuration for Midjourney image generation",
    icon: ImageIcon,
    keys: [
      { key: "discord_auth", label: "Discord Authorization", placeholder: "Authorization token", type: "password" },
      { key: "discord_app_id", label: "Discord Application ID", placeholder: "App ID", type: "text" },
      { key: "discord_guild", label: "Discord Guild ID", placeholder: "Server ID", type: "text" },
      { key: "discord_channel", label: "Discord Channel ID", placeholder: "Channel ID", type: "text" },
      { key: "mj_version", label: "Midjourney Version", placeholder: "e.g. 6", type: "text" },
      { key: "mj_id", label: "Midjourney ID", placeholder: "Bot ID", type: "text" },
    ],
  },
  {
    title: "Google Sheets",
    description: "Service Account for Google Sheets sync (optional)",
    icon: FileJson,
    keys: [
      { key: "google_sa_json", label: "Service Account JSON", placeholder: "Paste full JSON...", type: "textarea" },
    ],
  },
];

// ── Prompt groups ──────────────────────────────────────────────────────────

const PROMPT_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Article generation", keys: ["article"] },
  { label: "Full recipe", keys: ["full_recipe_system", "full_recipe_user"] },
  { label: "Recipe JSON (WP Recipe Maker)", keys: ["recipe_json_system", "recipe_json_user"] },
  { label: "Meta description (SEO)", keys: ["meta_description_system", "meta_description_user"] },
  { label: "Category", keys: ["category_system", "category_user"] },
  { label: "Pinterest Pin title", keys: ["pinterest_title_system", "pinterest_title_user"] },
  { label: "Pinterest Pin description", keys: ["pinterest_description_system", "pinterest_description_user"] },
  { label: "Pinterest Pin tags", keys: ["pinterest_tags_system", "pinterest_tags_user"] },
  { label: "Midjourney image prompt", keys: ["midjourney_imagine"] },
];

// ── Sub-tab type ───────────────────────────────────────────────────────────

type SubTab = "credentials" | "prompts" | "templates";

// ══════════════════════════════════════════════════════════════════════════════

export default function SettingsPage() {
  const router = useRouter();
  const [subTab, setSubTab] = useState<SubTab>("templates");

  // ── Credentials ──────────────────────────────────────────────────────────
  const [creds, setCreds] = useState<CredentialOut[]>([]);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [savingCreds, setSavingCreds] = useState(false);

  useEffect(() => {
    api.getSettingsCredentials().then(setCreds).catch(() => {});
  }, []);

  const handleSaveCreds = async () => {
    const toSave = Object.entries(credValues)
      .filter(([, v]) => v.trim())
      .map(([key_type, value]) => ({ key_type, value }));
    if (!toSave.length) return;
    setSavingCreds(true);
    const updated = await api.setSettingsCredentials(toSave);
    setCreds(updated);
    setCredValues({});
    setSavingCreds(false);
  };

  const getMasked = (key: string) =>
    creds.find((c) => c.key_type === key)?.masked_value || "Not configured";

  const hasCredChanges = Object.values(credValues).some((v) => v.trim());

  // ── Prompts ──────────────────────────────────────────────────────────────
  const [prompts, setPrompts] = useState<PromptOut[]>([]);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});
  const [savingPrompts, setSavingPrompts] = useState(false);

  useEffect(() => {
    if (subTab === "prompts") {
      api.getSettingsPrompts()
        .then((list) => {
          setPrompts(list);
          setPromptValues(Object.fromEntries(list.map((p) => [p.key, p.value])));
        })
        .catch(() => {});
    }
  }, [subTab]);

  const handleSavePrompts = async () => {
    if (!Object.keys(promptValues).length) return;
    setSavingPrompts(true);
    try {
      const updated = await api.setSettingsPrompts(promptValues);
      setPrompts(updated);
    } catch { }
    setSavingPrompts(false);
  };

  const hasPromptChanges = prompts.some(
    (p) => (promptValues[p.key] ?? p.value) !== p.value
  );

  // ── Templates ─────────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<PinDesignerTemplateOut[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (subTab === "templates") {
      setTemplatesLoading(true);
      api.getPinDesignerTemplates()
        .then(setTemplates)
        .catch(() => {})
        .finally(() => setTemplatesLoading(false));
    }
  }, [subTab]);

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await api.deletePinDesignerTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch { }
    setDeletingId(null);
  };

  // ── Tabs config ───────────────────────────────────────────────────────────
  const subTabs: { key: SubTab; label: string; icon: React.ElementType }[] = [
    { key: "templates", label: "My Templates", icon: LayoutTemplate },
    { key: "credentials", label: "API Keys", icon: Key },
    { key: "prompts", label: "AI Prompts", icon: MessageSquare },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage your templates, API keys, and AI prompts.
        </p>
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-gray-800 mb-6">
        {subTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
              subTab === t.key
                ? "border-brand-500 text-brand-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── My Templates ─────────────────────────────────────────────────── */}
      {subTab === "templates" && (
        <>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-semibold text-white">My Pin Templates</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Create reusable layouts and use them in the Pin Designer.
              </p>
            </div>
            <button
              onClick={() => router.push("/template-designer")}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={16} /> Create Template
            </button>
          </div>

          {templatesLoading && (
            <div className="text-center py-16 text-gray-400 text-sm">
              Loading templates…
            </div>
          )}

          {!templatesLoading && templates.length === 0 && (
            <div className="card flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
                <LayoutTemplate size={30} className="text-gray-500" />
              </div>
              <p className="font-semibold text-gray-300 mb-1">No templates yet</p>
              <p className="text-sm text-gray-500 mb-6 max-w-sm">
                Design your first Pin template and reuse it across all your sites
                directly from the Pin Designer.
              </p>
              <button
                onClick={() => router.push("/template-designer")}
                className="btn-primary flex items-center gap-2"
              >
                <Plus size={15} /> Create your first template
              </button>
            </div>
          )}

          {!templatesLoading && templates.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {/* "New template" card */}
              <button
                onClick={() => router.push("/template-designer")}
                className="aspect-[2/3] rounded-xl border-2 border-dashed border-gray-700 hover:border-brand-500 hover:bg-gray-900/40 transition-all flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-white group"
              >
                <div className="w-10 h-10 rounded-xl border-2 border-dashed border-current flex items-center justify-center group-hover:border-brand-400">
                  <Plus size={22} />
                </div>
                <span className="text-xs font-medium">New Template</span>
              </button>

              {templates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  className="aspect-[2/3] rounded-xl border border-gray-700 overflow-hidden relative group hover:border-gray-500 transition cursor-default"
                >
                  {/* Canvas preview */}
                  <div
                    className="w-full h-full relative overflow-hidden"
                    style={{ backgroundColor: tmpl.bgColor || "#ffffff" }}
                  >
                    {tmpl.elements.slice(0, 8).map((el) => {
                      // Scale 1000×1500 px canvas down to the card size
                      const SW = 0.16;
                      const SH = 0.16;
                      const style: React.CSSProperties = {
                        position: "absolute",
                        left: el.x * SW,
                        top: el.y * SH,
                        width: el.width * SW,
                        height: (el.height ?? 40) * SH,
                        borderRadius: 2,
                        backgroundColor:
                          el.type === "text"
                            ? (el.fill || "#333333")
                            : (el.bgColor || "#e8e8e8"),
                        opacity: el.type === "text" ? 0.65 : 0.85,
                      };
                      return <div key={el.id} style={style} />;
                    })}
                  </div>

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-3">
                    <p className="text-white text-xs font-semibold text-center line-clamp-2 leading-snug">
                      {tmpl.name}
                    </p>
                    <p className="text-gray-400 text-[10px]">
                      {tmpl.elements.length} element
                      {tmpl.elements.length !== 1 ? "s" : ""}
                    </p>
                    <button
                      onClick={() => handleDeleteTemplate(tmpl.id)}
                      disabled={deletingId === tmpl.id}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-900/70 text-red-300 text-[11px] hover:bg-red-900 transition disabled:opacity-50 mt-1"
                    >
                      <Trash2 size={11} />
                      {deletingId === tmpl.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>

                  {/* Name strip */}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pt-4 pb-2">
                    <p className="text-white text-[10px] font-medium truncate">
                      {tmpl.name}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      
    </div>
  );
}
