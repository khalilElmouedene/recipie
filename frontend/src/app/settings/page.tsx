"use client";

import { useEffect, useState } from "react";
import { Key, Save, Bot, Image as ImageIcon, FileJson, Shield } from "lucide-react";
import { api, CredentialOut } from "@/lib/api";

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

export default function SettingsPage() {
  const [creds, setCreds] = useState<CredentialOut[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettingsCredentials().then(setCreds).catch(() => {});
  }, []);

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

  const getMasked = (key: string) => creds.find((c) => c.key_type === key)?.masked_value || "Non configuré";

  const hasChanges = Object.values(values).some((v) => v.trim());

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Key size={28} className="text-brand-400" />
            Paramètres — Clés API
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Clés globales pour ChatGPT, Midjourney, Google — non liées aux projets
          </p>
        </div>
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

      <div className="card mb-4 flex items-start gap-3 p-4 border-amber-800/50 bg-amber-950/20">
        <Shield size={20} className="text-amber-400 mt-0.5" />
        <div className="text-sm text-amber-200/90">
          Ces clés sont personnelles et utilisées pour tous vos projets. Elles ne sont pas partagées avec les autres membres.
        </div>
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
    </div>
  );
}
