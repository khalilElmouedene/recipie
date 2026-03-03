"use client";

import { useEffect, useState } from "react";
import { Key, Save, Bot, Image as ImageIcon, FileJson, Shield, MessageSquare } from "lucide-react";
import { api, CredentialOut, PromptOut } from "@/lib/api";
import { getUserRole } from "@/lib/auth";

type SettingsTab = "credentials" | "prompts";

const KEY_GROUPS = [
  {
    title: "ChatGPT / OpenAI",
    description: "Clé pour la génération d'articles et de recettes (IA générale)",
    icon: Bot,
    keys: [
      { key: "openai", label: "OpenAI API Key", placeholder: "sk-...", type: "password", help: "Clé API depuis platform.openai.com" },
    ],
  },
  {
    title: "Midjourney (Discord)",
    description: "Configuration Discord pour la génération d'images Midjourney",
    icon: ImageIcon,
    keys: [
      { key: "discord_auth", label: "Discord Authorization", placeholder: "Token d'autorisation", type: "password", help: "Bearer token ou authorization header" },
      { key: "discord_app_id", label: "Discord Application ID", placeholder: "ID de l'application", type: "text" },
      { key: "discord_guild", label: "Discord Guild ID", placeholder: "ID du serveur", type: "text" },
      { key: "discord_channel", label: "Discord Channel ID", placeholder: "ID du salon", type: "text" },
      { key: "mj_version", label: "Midjourney Version", placeholder: "ex: 6", type: "text" },
      { key: "mj_id", label: "Midjourney ID", placeholder: "ID du bot Midjourney", type: "text" },
    ],
  },
  {
    title: "Google Sheets",
    description: "Service Account pour synchronisation Google Sheets (optionnel)",
    icon: FileJson,
    keys: [
      { key: "google_sa_json", label: "Service Account JSON", placeholder: "Collez le JSON complet...", type: "textarea", help: "Téléchargez depuis Google Cloud Console" },
    ],
  },
];

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

export default function SettingsPage() {
  const role = getUserRole();
  const canEditPrompts = role === "owner" || role === "admin";

  const [tab, setTab] = useState<SettingsTab>("credentials");

  // Credentials state
  const [creds, setCreds] = useState<CredentialOut[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Prompts state
  const [prompts, setPrompts] = useState<PromptOut[]>([]);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});
  const [savingPrompts, setSavingPrompts] = useState(false);

  useEffect(() => {
    api.getSettingsCredentials().then(setCreds).catch(() => {});
  }, []);

  useEffect(() => {
    if (canEditPrompts && tab === "prompts") {
      api.getSettingsPrompts()
        .then((list) => {
          setPrompts(list);
          setPromptValues(Object.fromEntries(list.map((p) => [p.key, p.value])));
        })
        .catch(() => {});
    }
  }, [canEditPrompts, tab]);

  const handleSave = async () => {
    const toSave = Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([key_type, value]) => ({ key_type, value }));
    if (toSave.length) {
      setSaving(true);
      const updated = await api.setSettingsCredentials(toSave);
      setCreds(updated);
      setValues({});
      setSaving(false);
    }
  };

  const handleSavePrompts = async () => {
    if (Object.keys(promptValues).length === 0) return;
    setSavingPrompts(true);
    try {
      const updated = await api.setSettingsPrompts(promptValues);
      setPrompts(updated);
    } catch (e) {
      console.error(e);
    }
    setSavingPrompts(false);
  };

  const getMasked = (key: string) => creds.find((c) => c.key_type === key)?.masked_value || "Non configuré";

  const hasChanges = Object.values(values).some((v) => v.trim());
  const hasPromptChanges = prompts.some((p) => (promptValues[p.key] ?? p.value) !== p.value);

  const tabs: { key: SettingsTab; label: string; icon: React.ElementType }[] = [
    { key: "credentials", label: "Clés API", icon: Key },
    ...(canEditPrompts ? [{ key: "prompts" as const, label: "Prompts IA", icon: MessageSquare }] : []),
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Key size={28} className="text-brand-400" />
            Paramètres
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Clés API et prompts utilisés pour la génération de contenu
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
              tab === t.key
                ? "border-brand-500 text-brand-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            <t.icon size={18} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "credentials" && (
        <>
          <div className="card mb-4 flex items-start gap-3 p-4 border-amber-800/50 bg-amber-950/20">
            <Shield size={20} className="text-amber-400 mt-0.5" />
            <div className="text-sm text-amber-200/90">
              Ces clés sont personnelles et utilisées pour tous vos projets. Elles ne sont pas partagées avec les autres membres.
            </div>
          </div>

          <div className="flex justify-end mb-4">
            {hasChanges && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                <Save size={18} />
                {saving ? "Enregistrement..." : "Enregistrer"}
              </button>
            )}
          </div>

          <div className="space-y-8">
            {KEY_GROUPS.map((group) => (
              <div key={group.title} className="card">
                <div className="flex items-start gap-3 mb-4">
                  <div className="h-10 w-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                    <group.icon size={20} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-white">{group.title}</h2>
                    <p className="text-sm text-gray-400">{group.description}</p>
                  </div>
                </div>

                <div className="space-y-4 mt-6">
                  {group.keys.map((k) => (
                    <div key={k.key} className="border border-gray-700 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-300">{k.label}</label>
                        <span className="text-xs font-mono text-gray-500">{getMasked(k.key)}</span>
                      </div>
                      {k.type === "textarea" ? (
                        <textarea
                          value={values[k.key] || ""}
                          onChange={(e) => setValues({ ...values, [k.key]: e.target.value })}
                          className="input-field h-24 font-mono text-xs resize-none"
                          placeholder={k.placeholder}
                        />
                      ) : (
                        <input
                          type={k.type}
                          value={values[k.key] || ""}
                          onChange={(e) => setValues({ ...values, [k.key]: e.target.value })}
                          className="input-field font-mono text-xs"
                          placeholder={k.placeholder}
                        />
                      )}
                      {k.help && (
                        <p className="text-[11px] text-gray-500 mt-1">{k.help}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {hasChanges && (
            <div className="sticky bottom-4 flex justify-end mt-8">
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-2 shadow-lg"
              >
                <Save size={18} />
                {saving ? "Enregistrement..." : "Enregistrer les modifications"}
              </button>
            </div>
          )}
        </>
      )}

      {tab === "prompts" && canEditPrompts && (
        <>
          <div className="card mb-4 flex items-start gap-3 p-4 border-blue-800/50 bg-blue-950/20">
            <MessageSquare size={20} className="text-blue-400 mt-0.5" />
            <div className="text-sm text-blue-200/90">
              Personnalisez les prompts utilisés pour la génération d&apos;articles, recettes, SEO, Pinterest et Midjourney.
              Utilisez les placeholders : <code className="bg-gray-800 px-1 rounded">{`{recipe_title}`}</code>, <code className="bg-gray-800 px-1 rounded">{`{full_recipe}`}</code>, <code className="bg-gray-800 px-1 rounded">{`{recipe_name}`}</code>, <code className="bg-gray-800 px-1 rounded">{`{source_img}`}</code>, etc.
            </div>
          </div>

          <div className="flex justify-end mb-4">
            {hasPromptChanges && (
              <button
                onClick={handleSavePrompts}
                disabled={savingPrompts}
                className="btn-primary flex items-center gap-2"
              >
                <Save size={18} />
                {savingPrompts ? "Enregistrement..." : "Enregistrer les prompts"}
              </button>
            )}
          </div>

          <div className="space-y-6">
            {PROMPT_GROUPS.map((group) => (
              <div key={group.label} className="card">
                <h2 className="font-semibold text-white mb-4">{group.label}</h2>
                <div className="space-y-4">
                  {group.keys.map((key) => {
                    const p = prompts.find((x) => x.key === key);
                    const desc = p?.description || "";
                    return (
                      <div key={key} className="border border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-medium text-gray-300 font-mono">{key}</label>
                          {desc && (
                            <span className="text-xs text-gray-500 max-w-md text-right">{desc}</span>
                          )}
                        </div>
                        <textarea
                          value={promptValues[key] ?? p?.value ?? ""}
                          onChange={(e) => setPromptValues({ ...promptValues, [key]: e.target.value })}
                          className="input-field w-full h-24 font-mono text-xs resize-y min-h-[80px]"
                          placeholder="Prompt..."
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {hasPromptChanges && (
            <div className="sticky bottom-4 flex justify-end mt-8">
              <button
                onClick={handleSavePrompts}
                disabled={savingPrompts}
                className="btn-primary flex items-center gap-2 shadow-lg"
              >
                <Save size={18} />
                {savingPrompts ? "Enregistrement..." : "Enregistrer les prompts"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
