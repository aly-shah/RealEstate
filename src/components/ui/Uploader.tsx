"use client";

import { useRef, useState } from "react";

interface UploaderProps {
  /** Name of the hidden input that will hold the stored file URL. */
  name?: string;
  /** Optional companion hidden input that receives the original filename. */
  nameFieldName?: string;
  label?: string;
}

type Status = { state: "idle" | "uploading" | "done" | "error"; url?: string; fileName?: string; error?: string };

/** Drag-and-drop file uploader that posts to /api/upload and stores the URL. */
export function Uploader({ name = "url", nameFieldName, label = "Drop a file or click to browse" }: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setStatus({ state: "uploading", fileName: file.name });
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setStatus({ state: "done", url: data.url, fileName: data.name });
    } catch (e) {
      setStatus({ state: "error", error: e instanceof Error ? e.message : "Upload failed" });
    }
  }

  return (
    <div>
      <input type="hidden" name={name} value={status.url ?? ""} />
      {nameFieldName && <input type="hidden" name={nameFieldName} value={status.fileName ?? ""} />}

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center text-sm transition ${
          dragging ? "border-ink bg-line-soft" : "border-line bg-white hover:border-ink"
        }`}
      >
        {status.state === "uploading" && <span className="text-muted">Uploading {status.fileName}…</span>}
        {status.state === "done" && <span className="font-medium text-ok">✓ {status.fileName}</span>}
        {status.state === "error" && <span className="text-danger">{status.error}</span>}
        {status.state === "idle" && (
          <>
            <span className="text-lg text-muted">↥</span>
            <span className="text-slate">{label}</span>
            <span className="text-xs text-muted">Images, PDF, Office docs · up to 10 MB</span>
          </>
        )}
        {status.state === "done" && <span className="text-xs text-muted">Click to replace</span>}
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
      />
    </div>
  );
}
