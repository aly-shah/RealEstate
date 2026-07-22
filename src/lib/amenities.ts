/**
 * Property features / amenities, grouped into categories the way Zameen.com's
 * "Add Features" dialog is. Single source of truth shared by the add/edit
 * property form, the standalone amenities editor on the detail page, and the
 * server-side validation in properties/actions.ts.
 *
 * Storage stays a flat `string[]` on the property; the groups only organise the
 * picker. The original 18 amenity names are all preserved verbatim inside these
 * groups, so listings created before the expansion keep every tag they had.
 */
export interface AmenityGroup {
  category: string;
  items: string[];
}

export const AMENITY_GROUPS: AmenityGroup[] = [
  {
    category: "Utilities",
    items: ["Backup Generator", "Gas Connection", "Water Boring", "Solar Panels"],
  },
  {
    category: "Main Features",
    items: [
      "Furnished", "Central Air Conditioning", "Central Heating",
      "Double Glazed Windows", "Lift / Elevator", "Parking", "Waste Disposal",
    ],
  },
  {
    category: "Land & Location",
    items: ["Boundary Wall", "Corner", "Park Facing", "Main Road"],
  },
  {
    category: "Rooms",
    items: [
      "Servant Quarter", "Drawing Room", "Dining Room", "Study Room",
      "Powder Room", "Store Room", "Laundry Room", "Prayer Room",
    ],
  },
  {
    category: "Business & Communication",
    items: ["Broadband Internet", "Satellite / Cable TV", "Intercom"],
  },
  {
    category: "Community Features",
    items: [
      "Community Lawn / Garden", "Community Swimming Pool", "Community Gym",
      "Community Centre", "Mosque Nearby", "Kids Play Area", "Day Care Centre",
    ],
  },
  {
    category: "Health & Recreation",
    items: ["Gym", "Swimming Pool", "Garden / Lawn", "Sauna", "Jacuzzi", "Barbeque Area"],
  },
  {
    category: "Nearby",
    items: [
      "Nearby Schools", "Nearby Hospitals", "Nearby Shopping Malls",
      "Nearby Restaurants", "Nearby Public Transport",
    ],
  },
  {
    category: "Security & Other",
    items: ["Security / Guard", "CCTV", "Maintenance Staff", "Facilities for Disabled"],
  },
];

/** Flat union of every allowed amenity — the server allow-list. */
export const AMENITIES: string[] = AMENITY_GROUPS.flatMap((g) => g.items);
