import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe from "./Globe";
import type { GlobeApi, PlanningMarker } from "./Globe";
import Legend from "./Legend";
import DetailPanel from "./DetailPanel";
import NetworkSearch from "./explore/NetworkSearch";
import CableDirectory from "./explore/CableDirectory";
import NetworkInspector from "./explore/NetworkInspector";
import CableChooser from "./explore/CableChooser";
import PlanningPanel from "./planning/PlanningPanel";
import type { PlannedLocation } from "./planning/planningTypes";
import type { RouteEngineResult, RoutingProfileId } from "./routing/routingTypes";
import { buildCableNetworkIndex, getCableDetail } from "./cableNetwork";
import { frameForPoints } from "./cameraFraming";
import type { NetworkSelection } from "./cableNetwork";
import type { CableHitCandidate } from "./cableHitTest";
import type { CableFeature, LandDC, SubseaDC, LandingPoint, LayerToggles, Selection } from "./types";
import "./App.css";
import { assetUrl } from "./assetUrl";

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export default function App() {
  const [cables, setCables] = useState<CableFeature[]>([]);
  const [landDCs, setLandDCs] = useState<LandDC[]>([]);
  const [subseaDCs, setSubseaDCs] = useState<SubseaDC[]>([]);
  const [landingPoints, setLandingPoints] = useState<LandingPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [rotating, setRotating] = useState(true);
  const [toggles, setToggles] = useState<LayerToggles>({
    cables: true,
    landDCs: true,
    subseaDCs: true,
    connectors: true,
    landingPoints: true,
  });

  const globeApiRef = useRef<GlobeApi>(null);

  // Cable explorer state.
  const [networkSelection, setNetworkSelection] = useState<NetworkSelection | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [cableChoices, setCableChoices] = useState<CableHitCandidate[] | null>(null);

  // Planning-mode state. It lives here rather than inside PlanningPanel
  // because the globe is the other half of this feature: it draws the two
  // endpoints, the candidate corridors, and frames the camera on them.
  const [planningMode, setPlanningMode] = useState(false);
  const [planningSource, setPlanningSource] = useState<PlannedLocation | null>(null);
  const [planningDestination, setPlanningDestination] = useState<PlannedLocation | null>(null);
  const [routeEngineResult, setRouteEngineResult] = useState<RouteEngineResult | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<RoutingProfileId | null>(null);

  useEffect(() => {
    Promise.all([
      fetchJSON<CableFeature[]>(assetUrl("data/cables.json")),
      fetchJSON<LandDC[]>(assetUrl("data/land-dcs.json")),
      fetchJSON<SubseaDC[]>(assetUrl("data/subsea-dcs.json")),
      fetchJSON<LandingPoint[]>(assetUrl("data/landing-points.json")),
    ])
      .then(([c, l, s, lp]) => {
        setCables(c);
        setLandDCs(l);
        setSubseaDCs(s);
        setLandingPoints(lp);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Cable/landing-point join over the real datasets -- built once per data
  // load, reused by search, the directory, the inspector, and Globe's
  // highlighting (see cableNetwork.ts).
  const cableNetworkIndex = useMemo(
    () => buildCableNetworkIndex(cables, landingPoints),
    [cables, landingPoints]
  );

  /** Frames the camera on a route's full stored geometry -- generous enough that
   *  the route doesn't disappear around the globe's curve, without zooming so far
   *  out the highlight is imperceptible. Geometry lives in cameraFraming.ts so
   *  the antimeridian handling is directly testable. */
  const focusOnPoints = useCallback((points: [number, number][]) => {
    const api = globeApiRef.current;
    if (!api) return;
    const framing = frameForPoints(points);
    if (!framing) return;
    api.flyTo(framing.lat, framing.lng, framing.altitude);
  }, []);

  function handleSelectNetworkItem(sel: NetworkSelection) {
    setSelected(null);
    setDirectoryOpen(false);
    setCableChoices(null);
    setRotating(false);
    setNetworkSelection(sel);
    if (sel.kind === "cable") {
      const detail = getCableDetail(sel.cableId, cableNetworkIndex);
      if (detail) focusOnPoints(detail.paths.flat());
    } else {
      const lp = cableNetworkIndex.landingPointsById.get(sel.landingPointId);
      if (lp) globeApiRef.current?.flyTo(lp.lat, lp.lng, 1.3);
    }
  }

  function handleSelectFacility(sel: Selection | null) {
    setNetworkSelection(null);
    setSelected(sel);
  }

  /** Multiple real cables genuinely overlapped the click's tolerance zone -- let
   *  the user pick, never guess. See cableHitTest.ts. */
  function handleAmbiguousCableClick(candidates: CableHitCandidate[]) {
    setDirectoryOpen(false);
    setCableChoices(candidates);
  }

  function handleChooseCable(cableId: string) {
    setCableChoices(null);
    handleSelectNetworkItem({ kind: "cable", cableId });
  }

  function enterPlanningMode() {
    // Explore-mode surfaces are dismissed rather than left underneath: the
    // planning panel docks to the same right edge as the inspector, and two
    // stacked panels would each be describing a different thing.
    setSelected(null);
    setNetworkSelection(null);
    setDirectoryOpen(false);
    setCableChoices(null);
    setRotating(false);
    setPlanningMode(true);
  }

  function leavePlanningMode() {
    setPlanningMode(false);
    setSelectedRouteId(null);
  }

  /** Endpoints as globe markers. The proposed route's own marine endpoints are
   *  drawn separately by Globe from the engine result -- these two are the
   *  business locations, which are inland far more often than not. */
  const planningMarkers = useMemo<PlanningMarker[]>(() => {
    const markers: PlanningMarker[] = [];
    if (planningSource) {
      markers.push({
        id: "planning-source",
        kind: "location",
        lat: planningSource.lat,
        lng: planningSource.lng,
        label: planningSource.label,
        sublabel: "SITE",
      });
    }
    if (planningDestination) {
      markers.push({
        id: "planning-destination",
        kind: "destination",
        lat: planningDestination.lat,
        lng: planningDestination.lng,
        label: planningDestination.label,
        sublabel: "DESTINATION",
      });
    }
    return markers;
  }, [planningSource, planningDestination]);

  const planningConnectivity = useMemo(
    () =>
      planningSource && planningDestination
        ? {
            lat1: planningSource.lat,
            lng1: planningSource.lng,
            lat2: planningDestination.lat,
            lng2: planningDestination.lng,
          }
        : null,
    [planningSource, planningDestination]
  );

  // Frame both endpoints as soon as the pair exists, so the user sees the
  // span the engine is about to search rather than wherever the globe
  // happened to be pointing.
  useEffect(() => {
    if (!planningMode || !planningSource || !planningDestination) return;
    focusOnPoints([
      [planningSource.lat, planningSource.lng],
      [planningDestination.lat, planningDestination.lng],
    ]);
  }, [planningMode, planningSource, planningDestination, focusOnPoints]);

  // Stable identity: PlanningPanel reports every engine result through this,
  // and an inline closure would re-fire its effect on every render.
  const handleRouteResult = useCallback((result: RouteEngineResult | null) => {
    setRouteEngineResult(result);
  }, []);

  const handleSelectRoute = useCallback((id: RoutingProfileId | null) => {
    setSelectedRouteId(id);
  }, []);

  return (
    <div className="app-root">
      <header className="title-bar">
        <h1>Subsea Cable &amp; Data Centre Planning Globe</h1>
        <p>
          {cables.length.toLocaleString()} cable routes · {landDCs.length.toLocaleString()} land
          facilities (PeeringDB) · {subseaDCs.length} subsea DC sites
        </p>
      </header>

      {loading && <div className="loading-overlay">Loading globe data…</div>}
      {error && <div className="error-overlay">{error}</div>}

      {!loading && !error && (
        <>
          <Globe
            ref={globeApiRef}
            cables={cables}
            landDCs={landDCs}
            subseaDCs={subseaDCs}
            toggles={toggles}
            rotating={rotating}
            onUserInteracted={() => setRotating(false)}
            onSelect={handleSelectFacility}
            landingPoints={landingPoints}
            cableNetworkIndex={cableNetworkIndex}
            networkSelection={networkSelection}
            onSelectNetworkItem={handleSelectNetworkItem}
            onAmbiguousCableClick={handleAmbiguousCableClick}
            planningMode={planningMode}
            planningMarkers={planningMarkers}
            planningConnectivity={planningConnectivity}
            routeEngineResult={routeEngineResult}
            selectedRouteCandidateId={selectedRouteId}
            onSelectRouteCandidate={handleSelectRoute}
          />

          {!planningMode && (
            <NetworkSearch
              index={cableNetworkIndex}
              onSelectCable={(id) => handleSelectNetworkItem({ kind: "cable", cableId: id })}
              onSelectLandingPoint={(id) =>
                handleSelectNetworkItem({ kind: "landingPoint", landingPointId: id })
              }
            />
          )}

          <div className="top-toolbar">
            {/* Layers lives inside the toolbar rather than beside it so that on a
                phone -- where the bottom of the screen belongs to the panel sheets
                -- it can become an ordinary flex child of this row instead of a
                floating control with nowhere to float. On desktop it is
                position:fixed and still sits at bottom-left, unchanged. */}
            <Legend
              toggles={toggles}
              onChange={setToggles}
              counts={{
                cables: cables.length,
                landDCs: landDCs.length,
                subseaDCs: subseaDCs.length,
                landingPoints: landingPoints.length,
              }}
            />
            <button
              className="toolbar-btn"
              onClick={() => setRotating((r) => !r)}
              title={rotating ? "Pause rotation" : "Resume rotation"}
              aria-label={rotating ? "Pause rotation" : "Resume rotation"}
            >
              {rotating ? "⏸" : "▶"}
            </button>
            {!planningMode && (
              <button
                className={`toolbar-btn ${directoryOpen ? "active" : ""}`}
                onClick={() => setDirectoryOpen((v) => !v)}
                title="Browse the full cable directory"
              >
                Directory
              </button>
            )}
            <button
              className={`toolbar-btn ${planningMode ? "active" : ""}`}
              onClick={() => (planningMode ? leavePlanningMode() : enterPlanningMode())}
              title="Plan a hypothetical facility and its subsea route"
            >
              Plan
            </button>
          </div>

          {planningMode && (
            <PlanningPanel
              source={planningSource}
              destination={planningDestination}
              onSetSource={setPlanningSource}
              onSetDestination={setPlanningDestination}
              selectedRouteId={selectedRouteId}
              onSelectRoute={handleSelectRoute}
              onRouteResult={handleRouteResult}
              onClose={leavePlanningMode}
            />
          )}

          {!planningMode && selected && (
            <DetailPanel selection={selected} onClose={() => setSelected(null)} />
          )}

          {!planningMode && cableChoices && (
            <CableChooser
              candidates={cableChoices}
              onChoose={handleChooseCable}
              onClose={() => setCableChoices(null)}
            />
          )}

          {!planningMode && !cableChoices && directoryOpen && (
            <CableDirectory
              index={cableNetworkIndex}
              onSelectCable={(id) => handleSelectNetworkItem({ kind: "cable", cableId: id })}
              onClose={() => setDirectoryOpen(false)}
            />
          )}

          {!planningMode && !cableChoices && !directoryOpen && networkSelection && (
            <NetworkInspector
              selection={networkSelection}
              index={cableNetworkIndex}
              onSelectCable={(id) => handleSelectNetworkItem({ kind: "cable", cableId: id })}
              onSelectLandingPoint={(id) =>
                handleSelectNetworkItem({ kind: "landingPoint", landingPointId: id })
              }
              onClose={() => setNetworkSelection(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
