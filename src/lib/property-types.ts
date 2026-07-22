/**
 * Property-type taxonomy, modelled on Zameen.com's "Add Property" type picker:
 * three top-level categories (Home / Plots / Commercial) each with granular
 * subtypes. Single source of truth for the add/edit form's grouped selector,
 * the list-page filter, and the server-side enum validation — so they can never
 * drift apart.
 *
 * LEGACY_TYPES are the coarse values seeded/created before this taxonomy; they
 * stay valid (kept in the Prisma enum) so existing listings still load and edit.
 */
export interface TypeOption {
  value: string;
  label: string;
}
export interface TypeGroup {
  category: string;
  items: TypeOption[];
}

export const PROPERTY_TYPE_GROUPS: TypeGroup[] = [
  {
    category: "Home",
    items: [
      { value: "HOUSE", label: "House" },
      { value: "FLAT", label: "Flat / Apartment" },
      { value: "UPPER_PORTION", label: "Upper Portion" },
      { value: "LOWER_PORTION", label: "Lower Portion" },
      { value: "FARM_HOUSE", label: "Farm House" },
      { value: "ROOM", label: "Room" },
      { value: "PENTHOUSE", label: "Penthouse" },
      { value: "VILLA", label: "Villa" },
    ],
  },
  {
    category: "Plots",
    items: [
      { value: "RESIDENTIAL_PLOT", label: "Residential Plot" },
      { value: "COMMERCIAL_PLOT", label: "Commercial Plot" },
      { value: "AGRICULTURAL_LAND", label: "Agricultural Land" },
      { value: "INDUSTRIAL_LAND", label: "Industrial Land" },
      { value: "PLOT_FILE", label: "Plot File" },
      { value: "PLOT_FORM", label: "Plot Form" },
    ],
  },
  {
    category: "Commercial",
    items: [
      { value: "OFFICE", label: "Office" },
      { value: "SHOP", label: "Shop" },
      { value: "WAREHOUSE", label: "Warehouse" },
      { value: "FACTORY", label: "Factory" },
      { value: "BUILDING", label: "Building" },
      { value: "OTHER", label: "Other" },
    ],
  },
];

/** Coarse types created before the granular taxonomy — kept valid for old rows. */
export const LEGACY_PROPERTY_TYPES = ["RESIDENTIAL", "COMMERCIAL", "PLOT", "APARTMENT"] as const;

/** Every accepted type value (granular + legacy) — feeds the Prisma enum + zod. */
export const ALL_PROPERTY_TYPES: string[] = [
  ...PROPERTY_TYPE_GROUPS.flatMap((g) => g.items.map((i) => i.value)),
  ...LEGACY_PROPERTY_TYPES,
];

// Land has no covered area, rooms, baths, floors or year built — the form hides
// those for these types. Includes legacy PLOT.
const LAND_TYPES = new Set([
  "PLOT", "RESIDENTIAL_PLOT", "COMMERCIAL_PLOT", "AGRICULTURAL_LAND",
  "INDUSTRIAL_LAND", "PLOT_FILE", "PLOT_FORM",
]);
// Residential (dwellings) show a bedrooms field; commercial/land do not.
const RESIDENTIAL_TYPES = new Set([
  "HOUSE", "FLAT", "UPPER_PORTION", "LOWER_PORTION", "FARM_HOUSE", "ROOM",
  "PENTHOUSE", "VILLA", "APARTMENT", "RESIDENTIAL",
]);

export const isLandType = (t: string) => LAND_TYPES.has(t);
export const isResidentialType = (t: string) => RESIDENTIAL_TYPES.has(t);
