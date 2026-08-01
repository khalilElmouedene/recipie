"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  List,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import { api, PromptOut } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/components/ConfirmModal";

const PROMPT_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Article generation", keys: ["article"] },
  { label: "Full recipe", keys: ["full_recipe"] },
  { label: "Recipe JSON (WP Recipe Maker)", keys: ["recipe_json"] },
  { label: "SEO title", keys: ["seo_title"] },
  { label: "Meta description (SEO)", keys: ["meta_description"] },
  { label: "Category", keys: ["category"] },
  { label: "Pinterest Pin title", keys: ["pinterest_title"] },
  { label: "Pinterest Pin description", keys: ["pinterest_description"] },
  { label: "Pinterest Pin tags", keys: ["pinterest_tags"] },
  { label: "Pinterest Pin board", keys: ["pinterest_board"] },
  { label: "Midjourney image prompt", keys: ["midjourney_imagine"] },
];

type BoardsMode = "text" | "excel";

function valuesFrom(prompts: PromptOut[]) {
  return Object.fromEntries(prompts.map((prompt) => [prompt.key, prompt.value]));
}

export default function FacebookAiPromptSettings({
  contentProjectId,
}: {
  contentProjectId: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [prompts, setPrompts] = useState<PromptOut[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [boardsMode, setBoardsMode] = useState<BoardsMode>("text");
  const [importingBoards, setImportingBoards] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.getSettingsPrompts(contentProjectId);
      setPrompts(list);
      setValues(valuesFrom(list));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load AI prompts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentProjectId]);

  const changedPrompts = useMemo(
    () =>
      Object.fromEntries(
        prompts
          .filter((prompt) => (values[prompt.key] ?? prompt.value) !== prompt.value)
          .map((prompt) => [prompt.key, values[prompt.key] ?? prompt.value]),
      ),
    [prompts, values],
  );
  const hasChanges = Object.keys(changedPrompts).length > 0;

  const save = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const updated = await api.setSettingsPrompts(contentProjectId, changedPrompts);
      setPrompts(updated);
      setValues(valuesFrom(updated));
      toast.success("AI prompts saved for this Facebook project");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save AI prompts");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    const accepted = await confirm({
      message:
        "Reset only this Facebook project's AI prompts to the built-in defaults? Other projects will not be changed.",
      confirmLabel: "Reset prompts",
      danger: true,
    });
    if (!accepted) return;
    setResetting(true);
    try {
      await api.resetSettingsPrompts(contentProjectId);
      await load();
      toast.success("This project's AI prompts were reset");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset AI prompts");
    } finally {
      setResetting(false);
    }
  };

  const importBoards = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportingBoards(true);
    try {
      const { boards } = await api.importBoardsExcel(file);
      setValues((current) => ({ ...current, pinterest_boards_list: boards }));
      setBoardsMode("text");
      toast.success("Pinterest boards imported. Save prompts to apply them.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import boards");
    } finally {
      setImportingBoards(false);
      event.target.value = "";
    }
  };

  const downloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      await api.downloadBoardsTemplate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download template");
    } finally {
      setDownloadingTemplate(false);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center rounded-[20px] border border-slate-800 bg-[#101827]">
        <Loader2 className="animate-spin text-[#68a8ff]" />
      </div>
    );
  }

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">AI Prompts</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Control article, recipe, SEO, Pinterest, and Midjourney generation for this Facebook
            project.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={reset}
            disabled={resetting}
            className="btn-secondary inline-flex items-center gap-2 hover:border-red-700 hover:text-red-300"
          >
            {resetting ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
            Reset defaults
          </button>
          <button
            onClick={save}
            disabled={saving || !hasChanges}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2f86f6] disabled:opacity-40"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save prompts
          </button>
        </div>
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-xl border border-blue-900/50 bg-blue-950/20 px-4 py-3 text-sm text-blue-200">
        <Sparkles size={17} className="mt-0.5 shrink-0 text-[#68a8ff]" />
        <p>
          These prompts belong only to the selected Facebook project. Saving or resetting them
          does not affect any other project.
        </p>
      </div>

      <div className="mt-5 space-y-4">
        {PROMPT_GROUPS.map((group) => (
          <div
            key={group.label}
            className="overflow-hidden rounded-[18px] border border-slate-800 bg-[#101827]"
          >
            <div className="border-b border-slate-800 px-5 py-4">
              <h3 className="font-semibold text-white">{group.label}</h3>
            </div>
            <div className="space-y-3 p-5">
              {group.keys.map((key) => {
                const prompt = prompts.find((item) => item.key === key);
                return (
                  <div key={key}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                        {key}
                      </label>
                      {prompt?.description && (
                        <span className="text-[10px] text-slate-600">{prompt.description}</span>
                      )}
                    </div>
                    <textarea
                      value={values[key] ?? prompt?.value ?? ""}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [key]: event.target.value }))
                      }
                      rows={5}
                      className="input-field min-h-28 resize-y font-mono text-xs leading-5"
                      placeholder="Prompt..."
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="overflow-hidden rounded-[18px] border border-slate-800 bg-[#101827]">
          <div className="flex flex-col gap-3 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#1877f2]/10 text-[#68a8ff]">
                <List size={17} />
              </span>
              <div>
                <h3 className="font-semibold text-white">Pinterest Boards List</h3>
                <p className="mt-1 text-xs text-slate-500">One board name per line.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={downloadTemplate}
                disabled={downloadingTemplate}
                className="btn-secondary inline-flex items-center gap-2 text-xs"
              >
                {downloadingTemplate ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )}
                Excel template
              </button>
              <div className="flex overflow-hidden rounded-lg border border-slate-700">
                {(["text", "excel"] as BoardsMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setBoardsMode(mode)}
                    className={`px-3 py-2 text-xs font-medium capitalize transition ${
                      boardsMode === mode
                        ? "bg-[#1877f2] text-white"
                        : "text-slate-500 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="p-5">
            {boardsMode === "text" ? (
              <div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  pinterest_boards_list
                </label>
                <textarea
                  value={values.pinterest_boards_list ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      pinterest_boards_list: event.target.value,
                    }))
                  }
                  className="input-field min-h-48 resize-y font-mono text-xs leading-5"
                  placeholder="One board name per line..."
                />
              </div>
            ) : (
              <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 text-center transition hover:border-[#1877f2]/60 hover:bg-[#1877f2]/5">
                {importingBoards ? (
                  <Loader2 size={25} className="animate-spin text-[#68a8ff]" />
                ) : (
                  <Upload size={25} className="text-slate-600" />
                )}
                <span className="mt-3 text-sm font-medium text-slate-300">
                  {importingBoards ? "Importing boards..." : "Choose an Excel file"}
                </span>
                <span className="mt-1 text-xs text-slate-600">Board names in column A from row 2</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={importBoards}
                  disabled={importingBoards}
                />
              </label>
            )}
          </div>
        </div>
      </div>

      {hasChanges && (
        <div className="sticky bottom-4 mt-6 flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_35px_rgba(24,119,242,.28)] transition hover:bg-[#2f86f6] disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save project prompts
          </button>
        </div>
      )}
    </section>
  );
}
