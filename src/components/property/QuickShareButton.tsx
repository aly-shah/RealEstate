"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Drawer } from "@/components/ui/Drawer";
import { ShareButton } from "./ShareButton";

interface QuickShareButtonProps {
  reference: string;
  title: string;
  slug: string | null;
}

/**
 * Row-level "share" affordance on the properties list. Every listing has a
 * public page from creation, so there's no on/off step — this just opens the
 * copy / WhatsApp controls in a right-side drawer.
 */
export function QuickShareButton({ reference, title, slug }: QuickShareButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Share ${reference}`}
        title="Share this property"
        className="btn-ghost h-8 w-8 p-0"
      >
        <Icon name="share" className="h-4 w-4" />
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Share this property" description={reference} width="md">
        {slug ? (
          <ShareButton slug={slug} title={title} reference={reference} />
        ) : (
          <p className="text-sm text-muted">Public link is being prepared…</p>
        )}
      </Drawer>
    </>
  );
}
