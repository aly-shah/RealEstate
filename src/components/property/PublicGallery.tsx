"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

export interface PublicGalleryImage {
  id: string;
  src: string;
  caption: string | null;
}

/**
 * Read-only photo gallery for the public share page: a large hero image with
 * overlaid prev/next arrows and a row of selectable thumbnails below. No
 * upload/delete controls — clients only look.
 */
export function PublicGallery({ images }: { images: PublicGalleryImage[] }) {
  const [active, setActive] = useState(0);
  if (images.length === 0) return null;

  const count = images.length;
  const idx = Math.min(active, count - 1);
  const current = images[idx];
  const go = (delta: number) => setActive((i) => (i + delta + count) % count);

  return (
    <div className="space-y-3">
      <div className="group relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.src}
          alt={current.caption ?? "Property photo"}
          className="aspect-[16/10] w-full rounded-2xl border border-line object-cover"
        />

        {count > 1 && (
          <>
            <GalleryArrow side="left" onClick={() => go(-1)} />
            <GalleryArrow side="right" onClick={() => go(1)} />
            <div className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {idx + 1} / {count}
            </div>
          </>
        )}

        {current.caption && (
          <div className="absolute bottom-3 left-3 max-w-[70%] rounded-full bg-black/55 px-3 py-1 text-xs text-white backdrop-blur-sm">
            {current.caption}
          </div>
        )}
      </div>

      {count > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Photo ${i + 1}`}
              className={`shrink-0 overflow-hidden rounded-xl border-2 transition ${
                i === idx ? "border-accent" : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt="" className="h-16 w-24 object-cover sm:h-20 sm:w-28" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GalleryArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={`absolute top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-md ring-1 ring-black/5 transition hover:bg-white ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      <Icon name={side === "left" ? "chevron-left" : "chevron-right"} className="h-5 w-5" />
    </button>
  );
}
