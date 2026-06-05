"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Drawer } from "@/components/ui/Drawer";
import { ShareProperty } from "./ShareProperty";

interface QuickShareButtonProps {
  propertyId: string;
  reference: string;
  enabled: boolean;
  slug: string | null;
}

/**
 * Row-level "share" affordance on the properties list. Opens the same share
 * controls used on the detail page inside a right-side drawer — so an agent can
 * turn on a public link and copy/WhatsApp it without leaving the list.
 */
export function QuickShareButton({ propertyId, reference, enabled, slug }: QuickShareButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Share ${reference}`}
        title={enabled ? "Share link is on" : "Share with client"}
        className={`btn-ghost h-8 w-8 p-0 ${enabled ? "text-accent" : ""}`}
      >
        <Icon name="share" className="h-4 w-4" />
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Share with client" description={reference} width="md">
        <ShareProperty propertyId={propertyId} enabled={enabled} slug={slug} />
      </Drawer>
    </>
  );
}
