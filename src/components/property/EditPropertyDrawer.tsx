"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { PropertyForm, type PropertyInitial } from "@/components/property/PropertyForm";

interface EditPropertyDrawerProps {
  property: PropertyInitial;
  dealers: { id: string; name: string }[];
  canPickDealer: boolean;
}

/**
 * "Edit" trigger on the property detail page. Opens the same dynamic
 * PropertyForm — pre-filled with the listing's current values — in the
 * right-sliding Drawer. On success updateProperty returns { ok }, the form
 * closes the drawer, and revalidatePath refreshes the page in place (no
 * navigation, since we're already on the listing).
 */
export function EditPropertyDrawer({ property, dealers, canPickDealer }: EditPropertyDrawerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost">
        Edit
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Edit property"
        description="Update this listing's details."
        width="xl"
      >
        <PropertyForm
          property={property}
          dealers={dealers}
          canPickDealer={canPickDealer}
          onCancel={() => setOpen(false)}
        />
      </Drawer>
    </>
  );
}
