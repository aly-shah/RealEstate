/**
 * Curated localities for the six Pakistani cities Proptimizr targets.
 *
 * The list is NOT exhaustive — that would balloon the bundle and date fast.
 * The shape is "20–40 best-known neighbourhoods" per city, picked to cover
 * the bulk of real-estate transactions an agency sees day-to-day. Forms
 * surface this list as suggestions (datalist), so users can still type a
 * sub-locality or new area without code changes.
 *
 * Naming follows local English transliteration (DHA, F-7, Bahria Town).
 * Sub-blocks ("Block 5", "Phase 8") are spelled out when commonly used to
 * disambiguate within a parent locality.
 */

export const PK_CITIES = [
  "Karachi",
  "Lahore",
  "Islamabad",
  "Rawalpindi",
  "Multan",
  "Faisalabad",
] as const;

export type PkCity = (typeof PK_CITIES)[number];

export const AREAS_BY_CITY: Record<PkCity, readonly string[]> = {
  Karachi: [
    "DHA Phase 1", "DHA Phase 2", "DHA Phase 4", "DHA Phase 5", "DHA Phase 6", "DHA Phase 7", "DHA Phase 8",
    "Clifton Block 1", "Clifton Block 2", "Clifton Block 4", "Clifton Block 5", "Clifton Block 7", "Clifton Block 8", "Clifton Block 9",
    "Bath Island", "Khayaban-e-Ittehad", "Khayaban-e-Hilal",
    "Bahria Town Karachi", "Bahria Town Precinct 1", "Bahria Town Precinct 10",
    "Gulshan-e-Iqbal", "Gulshan-e-Maymar", "Gulistan-e-Johar",
    "PECHS", "Tariq Road", "Bukhari Commercial",
    "North Nazimabad", "Federal B Area", "Nazimabad",
    "Gulberg Karachi", "Saddar", "II Chundrigar Road",
  ],
  Lahore: [
    "DHA Phase 1", "DHA Phase 2", "DHA Phase 3", "DHA Phase 4", "DHA Phase 5", "DHA Phase 6", "DHA Phase 7", "DHA Phase 8",
    "Bahria Town Lahore", "Bahria Orchard", "Bahria Education & Medical City",
    "Gulberg I", "Gulberg II", "Gulberg III", "Gulberg IV",
    "Model Town", "Faisal Town", "Garden Town", "Iqbal Town",
    "Johar Town", "Township", "Wapda Town",
    "Cantt", "Cavalry Ground",
    "Lake City", "Valencia Town", "Wapda City",
    "Askari", "Askari 10", "Askari 11",
    "Raiwind Road", "Ferozepur Road",
  ],
  Islamabad: [
    // Sector code is the standard handle in Islamabad real estate.
    "F-6", "F-7", "F-8", "F-10", "F-11",
    "E-7", "E-11",
    "G-6", "G-9", "G-10", "G-11", "G-13", "G-14",
    "I-8", "I-9", "I-10", "I-11", "I-14", "I-16",
    "B-17", "C-17",
    "Bahria Enclave", "Bahria Town Islamabad", "Bahria Town Phase 7", "Bahria Town Phase 8",
    "DHA Islamabad", "DHA Phase 1 Islamabad", "DHA Phase 2 Islamabad", "DHA Phase 5 Islamabad",
    "Gulberg Islamabad", "Gulberg Greens", "Gulberg Residencia",
    "PWD", "Soan Garden",
  ],
  Rawalpindi: [
    "Bahria Town Phase 1", "Bahria Town Phase 2", "Bahria Town Phase 3", "Bahria Town Phase 4",
    "Bahria Town Phase 7", "Bahria Town Phase 8",
    "DHA Phase 1 Rawalpindi", "DHA Phase 2 Rawalpindi", "DHA Phase 3 Rawalpindi",
    "Gulraiz Housing", "Gulshan Abad",
    "Saddar Rawalpindi", "Committee Chowk",
    "Satellite Town", "Asghar Mall Scheme",
    "Westridge", "Adyala Road",
    "Chaklala Scheme III", "Lalazar",
  ],
  Multan: [
    "DHA Multan", "DHA Phase 1 Multan", "DHA Phase 2 Multan",
    "Bahria Town Multan",
    "Gulgasht Colony", "Wapda Town Multan",
    "Shah Rukn-e-Alam Colony",
    "Garden Town Multan", "Officers Colony",
    "Cantt", "Bosan Road",
    "Northern Bypass",
  ],
  Faisalabad: [
    "Madina Town", "Susan Road", "Eden Valley",
    "Wapda City Faisalabad", "Citi Housing",
    "D-Type Colony", "D-Ground", "P-Block",
    "Jaranwala Road", "Sargodha Road",
    "People's Colony", "Khayaban Colony",
    "Lasani Garden", "Marwah Town",
    "Satiana Road",
  ],
};

/** Quick membership check used by the city-filter dropdown. */
export function isKnownCity(name: string | null | undefined): name is PkCity {
  if (!name) return false;
  return (PK_CITIES as readonly string[]).includes(name);
}

/** Datalist suggestions for an area input given a chosen city. Returns all
 *  cities' areas merged when the city isn't recognised (no filtering hint). */
export function suggestedAreas(city: string | null | undefined): readonly string[] {
  if (!isKnownCity(city)) {
    return Object.values(AREAS_BY_CITY).flat();
  }
  return AREAS_BY_CITY[city];
}
