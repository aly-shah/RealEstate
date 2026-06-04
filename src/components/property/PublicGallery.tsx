"use client";

import { useState } from "react";

export interface PublicGalleryImage {
  id: string;
  src: string;
  caption: string | null;
}

/**
 * Read-only photo gallery for the public share page: a large hero image with a
 * row of selectable thumbnails. No upload/delete controls — clients only look.
 */
export function PublicGallery({ images }: { images: PublicGalleryImage[] }) {
  const [active, setActive] = useState(0);
  if (images.length === 0) return null;

  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.src}
        alt={current.caption ?? "Property photo"}
        className="aspect-[16/10] w-full rounded-2xl border border-line object-cover"
      />
      {current.caption && <p className="text-sm text-muted">{current.caption}</p>}

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Photo ${i + 1}`}
              className={`shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === active ? "border-accent" : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt="" className="h-16 w-24 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
