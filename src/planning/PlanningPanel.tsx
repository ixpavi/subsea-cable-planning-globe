// Planning mode's docked panel: pick a site, pick where it needs to reach,
// read the hypothetical routes the engine proposes, then size a facility at
// the site.
//
// The panel owns the routing hook but not the endpoints -- App.tsx holds
// those, because the globe draws markers for them and the camera frames
// them. The engine's result is handed back up the same way, so the globe can
// draw the candidate geometry the user is reading about here.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import CloseButton from "../CloseButton";
import CalculatorPanel from "../calculator/CalculatorPanel";
import { estimateRouteRisk } from "../calculator/environmentalRisk";
import { DEFAULT_ROUTING_WEIGHTS } from "../routing/hypotheticalRouting";
import { useHypotheticalRoute } from "../routing/useHypotheticalRoute";
import type { RouteEngineResult, RoutingProfileId } from "../routing/routingTypes";
import { getCountryFactors } from "../siting/countryFactors";
import type { CountryFactors } from "../siting/countryFactors";
import LocationSearch from "./LocationSearch";
import RouteCandidateList from "./RouteCandidateList";
import type { PlannedLocation } from "./planningTypes";
import { formatCoords } from "./planningTypes";
import "./planning.css";

interface Props {
  source: PlannedLocation | null;
  destination: PlannedLocation | null;
  onSetSource: (loc: PlannedLocation | null) => void;
  onSetDestination: (loc: PlannedLocation | null) => void;
  selectedRouteId: RoutingProfileId | null;
  onSelectRoute: (id: RoutingProfileId | null) => void;
  onRouteResult: (result: RouteEngineResult | null) => void;
  onClose: () => void;
  /**
   * The real cable systems already serving this pair of endpoints, when the
   * host app computes a connectivity analysis. Optional: a host that does not
   * run one passes neither of these and the hand-off below is not rendered.
   */
  relevantCableIds?: string[];
  /** Leaves planning mode for the cable explorer, scoped to those cables. */
  onExploreCables?: (cableIds: string[]) => void;
}

export default function PlanningPanel({
  source,
  destination,
  onSetSource,
  onSetDestination,
  selectedRouteId,
  onSelectRoute,
  onRouteResult,
  onClose,
  relevantCableIds,
  onExploreCables,
}: Props) {
  // Weights are fixed at the engine's documented defaults. They are held as a
  // constant rather than exposed as sliders because every change restarts a
  // 15-25 s A* search in the worker; a slider invites dragging, and dragging
  // would queue searches the user never asked for.
  const [weights] = useState(DEFAULT_ROUTING_WEIGHTS);

  const { status, result, error } = useHypotheticalRoute({
    sourceLat: source?.lat ?? null,
    sourceLng: source?.lng ?? null,
    sourceLabel: source?.label ?? "",
    destLat: destination?.lat ?? null,
    destLng: destination?.lng ?? null,
    destLabel: destination?.label ?? "",
    weights,
  });

  useEffect(() => {
    onRouteResult(result);
  }, [result, onRouteResult]);

  // Default the selection to whatever the engine recommends, but never
  // overwrite a choice the user has already made.
  useEffect(() => {
    if (!result || selectedRouteId) return;
    const recommended = result.candidates.find((c) => c.isRecommended) ?? result.candidates[0];
    if (recommended) onSelectRoute(recommended.candidate.id);
  }, [result, selectedRouteId, onSelectRoute]);

  const selected = useMemo(
    () => result?.candidates.find((c) => c.candidate.id === selectedRouteId)?.candidate ?? null,
    [result, selectedRouteId]
  );

  // National indicators for the site's country. Without these the calculator
  // can only report CUE as unavailable, because CUE is PUE times the local
  // grid's carbon intensity and that varies by more than an order of
  // magnitude between countries -- far more than any cooling choice.
  //
  // The resolved factors are stored alongside the country they belong to, so
  // moving the site to another country discards them during render instead of
  // waiting for the next lookup to land -- otherwise a French site's carbon
  // intensity would briefly be attributed to an Indian one.
  const iso2 = source?.countryCode ?? null;
  const [resolved, setResolved] = useState<{ iso2: string; factors: CountryFactors | null } | null>(null);
  const countryFactors = iso2 && resolved?.iso2 === iso2 ? resolved.factors : null;

  useEffect(() => {
    if (!iso2) return;
    let cancelled = false;
    getCountryFactors(iso2)
      .then((res) => {
        if (!cancelled) setResolved({ iso2, factors: res.factors });
      })
      // A country absent from the source datasets is reported as absent, never
      // as zero -- a blank reads as zero to anyone comparing two sites.
      .catch(() => {
        if (!cancelled) setResolved({ iso2, factors: null });
      });
    return () => {
      cancelled = true;
    };
  }, [iso2]);

  // Feed the facility calculator the route it will actually be served by, so
  // its environmental risk is the selected corridor's, not a generic one.
  const routeRisk = useMemo(() => {
    if (!selected || !source) return null;
    return estimateRouteRisk({
      depthM: selected.analysis.meanDepthM ?? 0,
      latitude: source.lat,
      routeDistanceKm: selected.analysis.marineDistanceKm,
      protectedAreaExposure: selected.environmental,
    });
  }, [selected, source]);

  return (
    <div className="panel plan-panel">
      <div className="panel-header">
        <span className="plan-modeled-tag">MODELED / HYPOTHETICAL</span>
        <CloseButton onClick={onClose} label="Leave planning mode" />
      </div>

      <div className="plan-body">
        <Stage num={1} title="Where would the facility go?">
          <p className="plan-hint">
            Pick the site. Nothing here asserts a data centre exists at this place -- it is the origin for everything
            below.
          </p>
          <Endpoint role="source" loc={source} onClear={() => onSetSource(null)}>
            <LocationSearch placeholder="Search a city, e.g. Marseille" onChoose={onSetSource} />
          </Endpoint>
        </Stage>

        <Stage num={2} title="What does it need to reach?">
          <p className="plan-hint">The far end of the connection you want costed.</p>
          <Endpoint role="destination" loc={destination} onClear={() => onSetDestination(null)}>
            <LocationSearch placeholder="Search a city, e.g. Mumbai" onChoose={onSetDestination} />
          </Endpoint>
        </Stage>

        <Stage num={3} title="Proposed routes">
          {status === "idle" && <p className="plan-status">Choose both endpoints to run the routing engine.</p>}
          {status === "loading" && (
            <p className="plan-status">
              Searching the ocean grid. An A* pass over the 0.5-degree grid takes roughly 15-25 seconds. The globe
              deliberately shows no route until it finishes, rather than leaving the previous pair&rsquo;s geometry on
              screen.
            </p>
          )}
          {status === "error" && <p className="plan-status error">{error ?? "The routing engine failed."}</p>}
          {status === "ready" && result?.unavailableReason && (
            <p className="plan-status error">{result.unavailableReason}</p>
          )}
          {status === "ready" && result && !result.unavailableReason && (
            <>
              <RouteCandidateList result={result} selectedId={selectedRouteId} onSelect={onSelectRoute} />
              <EndpointNote result={result} />
            </>
          )}
        </Stage>

        {relevantCableIds && relevantCableIds.length > 0 && onExploreCables && (
          <Stage num={4} title="What already serves this route">
            <p className="plan-hint">
              {relevantCableIds.length} real cable {relevantCableIds.length === 1 ? "system" : "systems"} already
              connect these endpoints. A new build competes with them, so they are worth reading before costing one.
            </p>
            <button type="button" className="plan-clear" onClick={() => onExploreCables(relevantCableIds)}>
              Explore those cables
            </button>
          </Stage>
        )}

        {source && (
          <Stage num={relevantCableIds && relevantCableIds.length > 0 && onExploreCables ? 5 : 4} title="Size the facility">
            <CalculatorPanel
              siteName={source.label}
              siteLocation={formatCoords(source.lat, source.lng)}
              routeRisk={routeRisk}
              routeRiskLabel={selected ? `via ${selected.shortName}` : undefined}
              gridCarbonGco2PerKwh={countryFactors?.carbonIntensityGco2PerKwh ?? null}
              gridCarbonSource={
                countryFactors?.carbonIntensityYear
                  ? `${countryFactors.name ?? "national grid"}, ${countryFactors.carbonIntensityYear}`
                  : undefined
              }
            />
            {countryFactors?.carbonIntensityGco2PerKwh != null && (
              <p className="plan-note">
                CUE uses {countryFactors.name ?? "this country"}&rsquo;s published grid carbon intensity of{" "}
                {countryFactors.carbonIntensityGco2PerKwh} gCO<sub>2</sub>/kWh
                {countryFactors.carbonIntensityYear ? ` (${countryFactors.carbonIntensityYear})` : ""}. This is a
                national aggregate, not a measurement at the site.
              </p>
            )}
          </Stage>
        )}
      </div>
    </div>
  );
}

function Stage({ num, title, children }: { num: number; title: string; children: ReactNode }) {
  return (
    <section className="plan-stage">
      <h3 className="plan-stage-title">
        <span className="plan-stage-num">{num}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The chosen place, or the search box that has yet to produce one. */
function Endpoint({
  role,
  loc,
  onClear,
  children,
}: {
  role: "source" | "destination";
  loc: PlannedLocation | null;
  onClear: () => void;
  children: ReactNode;
}) {
  if (!loc) return <>{children}</>;
  return (
    <div className="plan-chosen">
      <span className={`plan-chosen-dot ${role}`} aria-hidden="true" />
      <span className="plan-chosen-text">
        <span className="plan-chosen-name">{loc.label}</span>
        <span className="plan-chosen-coords">{formatCoords(loc.lat, loc.lng)}</span>
      </span>
      <button type="button" className="plan-clear" onClick={onClear}>
        Change
      </button>
    </div>
  );
}

/**
 * A cable does not land at a city. This states the gap between the site the
 * user picked and the point on the coast the route actually starts from, and
 * whether that point is a real landing point or one the engine invented.
 */
function EndpointNote({ result }: { result: RouteEngineResult }) {
  return (
    <>
      <EndpointBasis role="Source" endpoint={result.sourceEndpoint} />
      <EndpointBasis role="Destination" endpoint={result.destinationEndpoint} />
    </>
  );
}

/**
 * Why this marine access point, and where it is.
 *
 * A cable does not land at a city, and for an inland site the engine may put
 * the access point on a different coast from the nearest landing point --
 * Bangalore resolves toward the Arabian Sea while its nearest landing point,
 * Chennai, is on the Bay of Bengal. Shown a marker with no explanation, that
 * reads as "the app chose Kochi". These fields state what was chosen, where it
 * is, and what it beat, so the choice is auditable instead of mysterious.
 */
function EndpointBasis({ role, endpoint }: { role: string; endpoint: RouteEngineResult["sourceEndpoint"] }) {
  const isReal = endpoint.kind === "real-landing-point";
  const km = (v: number) => `${Math.round(v).toLocaleString()} km`;

  return (
    <div className="plan-endpoint">
      <div className="plan-endpoint-head">
        <span className="plan-metric-key">{role} marine access</span>
        <span className="plan-modeled-tag">{isReal ? "REAL DATA" : "MODELLED"}</span>
      </div>

      <dl className="plan-endpoint-basis">
        <dt>Chosen</dt>
        <dd>
          {isReal ? (
            <>Real landing point &mdash; {endpoint.landingPointName}</>
          ) : endpoint.kind === "modeled-access-point" ? (
            <>Modelled ocean cell (no landing point used)</>
          ) : (
            <>None &mdash; routing cannot start here</>
          )}
        </dd>

        {endpoint.lat != null && endpoint.lng != null && (
          <>
            <dt>Position</dt>
            <dd className="plan-endpoint-mono">
              {endpoint.lat.toFixed(2)}, {endpoint.lng.toFixed(2)}
            </dd>
          </>
        )}

        {endpoint.terrestrialAccessKm != null && (
          <>
            <dt>Overland</dt>
            <dd>
              {km(endpoint.terrestrialAccessKm)} from {endpoint.businessLabel}
            </dd>
          </>
        )}

        {!isReal && endpoint.localityReference && (
          <>
            <dt>Whereabouts</dt>
            <dd>
              coast near {endpoint.localityReference.name} ({km(endpoint.localityReference.distanceKm)} away) &mdash; a
              locality reference only, not a cable landing
            </dd>
          </>
        )}

        {endpoint.nearestLandingPoint && endpoint.selection.rule !== "shorter-total-connection" && (
          <>
            <dt>Nearest landing point</dt>
            <dd>
              {endpoint.nearestLandingPoint.name} ({km(endpoint.nearestLandingPoint.distanceKm)})
              {!isReal && <> &mdash; beyond the {km(endpoint.searchRadiusKm)} radius, so not used</>}
            </dd>
          </>
        )}

        {/* When two access points were actually routed against each other, the
            measurement decided it -- not the radius rule. Show the numbers. */}
        {endpoint.selection.rejected && endpoint.selection.totalConnectionKm != null && (
          <>
            <dt>Decided by</dt>
            <dd>
              shorter total connection &mdash; {km(endpoint.selection.totalConnectionKm)} here against{" "}
              {km(endpoint.selection.rejected.totalConnectionKm)} via {endpoint.selection.rejected.label} (
              {km(endpoint.selection.rejected.terrestrialAccessKm)} overland)
            </dd>
          </>
        )}
      </dl>

      <p className="plan-note">{endpoint.note}</p>
    </div>
  );
}
