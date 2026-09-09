// Per-candidate route colors, shared by the globe (which draws the corridors)
// and the planning panel (which lists them).
//
// In its own module rather than exported from Globe.tsx so that the two
// surfaces cannot drift apart: a candidate's swatch in the list and its line
// on the globe must be the same color, because that pairing is the only thing
// telling the user which line the card describes.
import type { RoutingProfileId } from "./routingTypes";

export const ROUTE_COLORS: Record<RoutingProfileId, string> = {
  shortest: "#facc15",
  "shallow-favoring": "#a78bfa",
  "diverse-corridor": "#34d399",
};

/**
 * Bright, high-contrast override for whichever candidate is currently
 * selected -- distinct from every ROUTE_COLORS entry and from every real-cable
 * color in the dataset, so "the proposed route" reads as a completely
 * different kind of object, not just another colored line among hundreds.
 */
export const SELECTED_ROUTE_COLOR = "#ffffff";
