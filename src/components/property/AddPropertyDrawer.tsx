"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { PropertyForm } from "@/components/property/PropertyForm";

interface AddPropertyDrawerProps {
  dealers: { id: string; name: string }[];
  canPickDealer: boolean;
}

/**
 * "+ Add property" trigger that opens the create form in the right-sliding
 * Drawer (matching every other create/edit form in the app). On success the
 * server action redirects to the new property's page, which unmounts the
 * drawer; Cancel / Escape / backdrop just close it.
 */
export function AddPropertyDrawer({ dealers, canPickDealer }: AddPropertyDrawerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-accent">
        + Add property
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Add a property"
        description="Create a new listing for the company inventory."
        width="xl"
      >
        <PropertyForm dealers={dealers} canPickDealer={canPickDealer} onCancel={() => setOpen(false)} />
      </Drawer>
    </>
  );
}
