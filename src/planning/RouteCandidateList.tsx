// The ranked hypothetical-route candidates, one card each.
//
// Two rules this list exists to enforce:
//
//  1. Every displayed number is stamped with where it came from. The chips
//     read from routing/provenance.ts rather than being written inline, so a
//     metric cannot quietly change basis while its label keeps claiming the
//     old one.
//  2. Candidates the engine flagged as degenerate -- corridors closer
//     together than one grid cell -- are still shown, with the warning
//     attached. Hiding them would present the survivors as independent
//     alternatives when the data cannot tell them apart.
import { ROUTE_COLORS } from "../routing/routeColors";
import { PROVENANCE_LABEL, ROUTE_METRIC_PROVENANCE } from "../routing/provenance";
import type { RouteMetricId } from "../routing/provenance";
import type { RankedRouteCandidate, RouteEngineResult, RoutingProfileId } from "../routing/routingTypes";

interface Props {
  result: RouteEngineResult;
  selectedId: RoutingProfileId | null;
  onSelect: (id: RoutingProfileId) => void;
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  notation: "compact",
});

function km(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} km`;
}

/** Provenance chip for one metric, worded from the shared descriptor table. */
function Chip({ metric }: { metric: RouteMetricId }) {
  const d = ROUTE_METRIC_PROVENANCE[metric];
  return (
    <span className="plan-modeled-tag" title={d.basis}>
      {PROVENANCE_LABEL[d.provenance]}
    </span>
  );
}

export default function RouteCandidateList({ result, selectedId, onSelect }: Props) {
  return (
    <>
      <ul className="plan-candidates">
        {result.candidates.map((ranked) => (
          <li key={ranked.candidate.id}>
            <CandidateCard ranked={ranked} selected={ranked.candidate.id === selectedId} onSelect={onSelect} />
          </li>
        ))}
      </ul>

      {result.degeneratePairs.length > 0 && (
        <p className="plan-degenerate">
          {result.degeneratePairs.length === 1 ? "Two candidates are" : "Some candidates are"} closer together than one
          grid cell ({Math.round(result.separationThresholdKm)} km), so they are not independent engineering options --
          the data that produced them cannot distinguish their corridors.
        </p>
      )}

      <p className="plan-note">{result.gridProvenance}</p>
    </>
  );
}

function CandidateCard({
  ranked,
  selected,
  onSelect,
}: {
  ranked: RankedRouteCandidate;
  selected: boolean;
  onSelect: (id: RoutingProfileId) => void;
}) {
  const { candidate } = ranked;
  const { analysis, resilience, cost, environmental } = candidate;

  return (
    <button
      type="button"
      className="plan-candidate"
      aria-pressed={selected}
      style={{ ["--route-color" as string]: ROUTE_COLORS[candidate.id] }}
      onClick={() => onSelect(candidate.id)}
    >
      <span className="plan-candidate-head">
        <span className="plan-candidate-name">{candidate.label}</span>
        {ranked.isRecommended && <span className="plan-rec-badge">Recommended</span>}
      </span>

      <p className="plan-candidate-why">{ranked.whyText}</p>

      <span className="plan-metrics">
        <span className="plan-metric-key">Marine length</span>
        <span className="plan-metric-val">{km(analysis.marineDistanceKm)}</span>

        <span className="plan-metric-key">Dominant depth</span>
        <span className="plan-metric-val">{analysis.dominantDepthBandLabel}</span>

        <span className="plan-metric-key">Seabed difficulty</span>
        <span className="plan-metric-val">{analysis.difficultyIndex.toFixed(3)}</span>

        <span className="plan-metric-key">Corridor overlap</span>
        <span className="plan-metric-val">{Math.round(resilience.corridorOverlapFraction * 100)}%</span>

        <span className="plan-metric-key">Est. build cost</span>
        <span className="plan-metric-val">{USD.format(cost.totalUsd)}</span>

        <span className="plan-metric-key">Protected water</span>
        <span className="plan-metric-val">
          {environmental.available
            ? `${(environmental.constrainedDistanceKm ?? 0).toFixed(1)} km`
            : "unavailable"}
        </span>
      </span>

      <span className="plan-note">
        <Chip metric="routeGeometry" /> geometry &middot; <Chip metric="costEstimate" /> cost &middot;{" "}
        <Chip metric={environmental.available ? "environmentalAssessed" : "environmentalUnavailable"} /> environmental
      </span>
    </button>
  );
}
