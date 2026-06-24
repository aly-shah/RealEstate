"use client";

import { MediaManager } from "./MediaManager";
import { addProjectMedia, deleteProjectMedia, type MediaItem } from "../actions";

/** Project-level media (renderings, master/floor plans, brochures). */
export function ProjectMediaManager({ projectId, items }: { projectId: string; items: MediaItem[] }) {
  return (
    <MediaManager
      items={items}
      onAdd={(i) => addProjectMedia({ projectId, ...i })}
      onRemove={deleteProjectMedia}
    />
  );
}
