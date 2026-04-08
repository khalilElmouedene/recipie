"use client";

import { useRef, useState, useEffect } from "react";
import { Link, Upload, X } from "lucide-react";
import { getApiBaseUrl } from "@/lib/api";

interface Props {
  value: string;
  onChange: (url: string) => void;
  siteId?: string;        // needed for upload mode — images are uploaded to WP media
  required?: boolean;
  placeholder?: string;
}

export default function ImageUrlInput({ value, onChange, siteId, required, placeholder = "https://example.com/image.jpg" }: Props) {
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    if (!siteId) {
      // No site context — store as data URL (best-effort fallback)
      const reader2 = new FileReader();
      reader2.onload = (e) => onChange(e.target?.result as string ?? "");
      reader2.readAsDataURL(file);
      return;
    }

    setUploading(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const formData = new FormData();
      formData.append("file", file, file.name || "upload.png");
      const res = await fetch(
        `${getApiBaseUrl()}/api/sites/${siteId}/upload-media?title=${encodeURIComponent(file.name || "Recipe Image")}`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        }
      );
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();
      onChange(data.media_url || "");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Image upload failed");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  // Global paste listener — works without clicking the dropzone first
  useEffect(() => {
    if (mode !== "upload") return;
    const onWindowPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFile(file);
      }
    };
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, siteId]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const clear = () => {
    setPreview(null);
    onChange("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 bg-gray-800 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setMode("url")}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
            mode === "url" ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"
          }`}
        >
          <Link size={11} /> URL
        </button>
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
            mode === "upload" ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"
          }`}
        >
          <Upload size={11} /> Upload
        </button>
      </div>

      {mode === "url" ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="input-field w-full"
          placeholder={placeholder}
        />
      ) : (
        <div className="space-y-2">
          {/* Dropzone */}
          <div
            ref={dropRef}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className="relative border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-brand-500 transition focus:outline-none"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          >
            {preview ? (
              <div className="relative inline-block">
                <img src={preview} alt="Preview" className="max-h-32 max-w-full rounded object-contain mx-auto" />
                {uploading && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded">
                    <span className="text-xs text-white">Uploading…</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-3">
                <Upload size={20} className="mx-auto text-gray-500 mb-1" />
                <p className="text-xs text-gray-400">
                  {uploading ? "Uploading…" : "Click, drag & drop, or Ctrl+V to paste an image"}
                </p>
              </div>
            )}
          </div>

          {/* Show final URL if uploaded */}
          {value && !uploading && (
            <div className="flex items-center gap-2">
              <input value={value} readOnly className="input-field w-full text-xs text-gray-400" />
              <button type="button" onClick={clear} className="p-1.5 text-gray-400 hover:text-red-400 flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          {/* Hidden input to satisfy form required validation */}
          {required && <input type="text" value={value} required readOnly className="sr-only" tabIndex={-1} />}
        </div>
      )}
    </div>
  );
}
