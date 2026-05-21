"use client";

import { useActionState, useState } from "react";
import { addPropertyMedia, deletePropertyMedia, type FormState } from "@/app/(app)/properties/actions";
import { Uploader } from "@/components/ui/Uploader";
import { humanize } from "@/lib/format";

export interface MediaItem {
  id: string;
  url: string;
  kind: string;
  caption: string | null;
}

const KINDS = ["PHOTO", "VIDEO", "FLOOR_PLAN", "BROCHURE"];
const isImage = (url: string) => /\.(jpe?g|png|webp|gif|avif)$/i.test(url);

export function PropertyGallery({
  propertyId,
  media,
  canManage,
}: {
  propertyId: string;
  media: MediaItem[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await addPropertyMedia(p, fd);
    if (res.ok) setOpen(false);
    return res;
  }, {});

  return (
    <div>
      {media.length === 0 ? (
        <p className="text-sm text-muted">No media yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {media.map((m) => (
            <div key={m.id} className="group relative overflow-hidden rounded-md border border-line bg-line-soft">
              {isImage(m.url) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={m.url} alt={m.caption ?? "Property media"} className="aspect-[4/3] w-full object-cover" />
              ) : (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="flex aspect-[4/3] flex-col items-center justify-center gap-1 text-sm text-slate hover:text-ink">
                  <span className="text-2xl">▤</span>
                  {humanize(m.kind)}
                </a>
              )}
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="truncate text-xs text-muted">{m.caption ?? humanize(m.kind)}</span>
                {canManage && (
                  <form action={deletePropertyMedia}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="text-xs text-muted transition hover:text-danger" aria-label="Remove">✕</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="mt-4">
          {!open ? (
            <button onClick={() => setOpen(true)} className="btn-ghost text-sm">+ Add media</button>
          ) : (
            <form action={action} className="space-y-3 rounded-md border border-line p-4">
              <input type="hidden" name="propertyId" value={propertyId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="kind">Kind</label>
                  <select id="kind" name="kind" className="field" defaultValue="PHOTO">
                    {KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="caption">Caption (optional)</label>
                  <input id="caption" name="caption" className="field" />
                </div>
              </div>
              <Uploader name="url" label="Drop a photo, floor plan or brochure" />
              {state.error && <p className="text-xs text-danger">{state.error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5 text-xs">{pending ? "Saving…" : "Add to gallery"}</button>
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost px-3 py-1.5 text-xs">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
