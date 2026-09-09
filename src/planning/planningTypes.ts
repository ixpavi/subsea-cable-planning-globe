// The one thing planning mode needs to carry between its stages: a place the
// user picked, resolved to real coordinates.
//
// Deliberately smaller than a "site requirement" record. Planning mode here
// asks the routing engine a geometric question -- given two points on the
// Earth, where would a cable plausibly go, and what would a facility at the
// first point look like? Nothing downstream consumes a business profile, so
// nothing upstream collects one.
export interface PlannedLocation {
  /** Human-readable "City, Region, Country", straight from the geocoder. */
  label: string;
  lat: number;
  lng: number;
  /** ISO 3166-1 alpha-2, lowercase, when the geocoder supplied one. */
  countryCode?: string;
}

export function formatCoords(lat: number, lng: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}°${ns}, ${Math.abs(lng).toFixed(3)}°${ew}`;
}
