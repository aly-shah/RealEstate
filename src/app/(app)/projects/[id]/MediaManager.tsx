"use client";

import { useRef, useState } from "react";
import type { MediaItem } from "../actions";

type AddResult = { ok: true; media: MediaItem } | { ok: false; error: string };

interface Props {
  items: MediaItem[];
  onAdd: (input: { kind: string; url: string; caption?: string }) => Promise<AddResult>;
  onRemove: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

const KINDS = [
  { value: "PHOTO", label: "Photo / render" },
  { value: "FLOOR_PLAN", label: "Floor plan" },
  { value: "BROCHURE", label: "Brochure / doc" },
  { value: "VIDEO", label: "Video" },
];
const isImage = (k: string) => k === "PHOTO" || k === "FLOOR_PLAN";

/** Upload + gallery for photos / floor plans / brochures (project or unit). */
export function MediaManager({ items, onAdd, onRemove }: Props) {
  const [media, setMedia] = useState<MediaItem[]>(items);
  const [kind, setKind] = useState("PHOTO");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null); setBusy(true);
    try {
      const body = new FormData(); body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const r = await onAdd({ kind, url: data.url, caption: caption.trim() || undefined });
      if (!r.ok) throw new Error(r.error);
      setMedia((m) => [...m, r.media]);
      setCaption("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string) {
    setError(null);
    const r = await onRemove(id);
    if (!r.ok) { setError(r.error ?? "Couldn't delete."); return; }
    setMedia((m) => m.filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-3">
      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {media.map((m) => (
            <div key={m.id} className="group relative overflow-hidden rounded-lg border border-line bg-canvas">
              {isImage(m.kind) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={m.url} alt={m.caption ?? "media"} className="h-24 w-full object-cover" loading="lazy" />
              ) : (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="flex h-24 w-full flex-col items-center justify-center gap-1 text-xs text-accent">
                  <span className="text-xl">{m.kind === "VIDEO" ? "▶" : "📄"}</span>
                  {m.kind === "VIDEO" ? "Video" : "Open file"}
                </a>
              )}
              <button type="button" onClick={() => remove(m.id)} aria-label="Delete" className="absolute end-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/70 text-[11px] text-white opacity-0 transition group-hover:opacity-100">✕</button>
              {m.caption && <p className="truncate px-1.5 py-1 text-[10px] text-muted">{m.caption}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-dashed border-line p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <select className="field text-ink" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
          <input className="field text-ink sm:col-span-2" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </div>
        <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.pdf,.mp4,.mov,.doc,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn-ghost mt-2 w-full justify-center text-sm">{busy ? "Uploading…" : "↥ Upload a file"}</button>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
