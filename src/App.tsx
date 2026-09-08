import { useEffect, useMemo, useRef, useState } from "react";
import Globe from "./Globe";
import type { GlobeApi } from "./Globe";
import Legend from "./Legend";
import DetailPanel from "./DetailPanel";
import NetworkSearch from "./explore/NetworkSearch";
import CableDirectory from "./explore/CableDirectory";
import NetworkInspector from "./explore/NetworkInspector";
import CableChooser from "./explore/CableChooser";
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
  function focusOnPoints(points: [number, number][]) {
    const api = globeApiRef.current;
    if (!api) return;
    const framing = frameForPoints(points);
    if (!framing) return;
    api.flyTo(framing.lat, framing.lng, framing.altitude);
  }

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
          />

          <NetworkSearch
            index={cableNetworkIndex}
            onSelectCable={(id) => handleSelectNetworkItem({ kind: "cable", cableId: id })}
            onSelectLandingPoint={(id) =>
              handleSelectNetworkItem({ kind: "landingPoint", landingPointId: id })
            }
          />

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
            <button
              className={`toolbar-btn ${directoryOpen ? "active" : ""}`}
              onClick={() => setDirectoryOpen((v) => !v)}
              title="Browse the full cable directory"
            >
              Directory
            </button>
          </div>

          {selected && <DetailPanel selection={selected} onClose={() => setSelected(null)} />}

          {cableChoices && (
            <CableChooser
              candidates={cableChoices}
              onChoose={handleChooseCable}
              onClose={() => setCableChoices(null)}
            />
          )}

          {!cableChoices && directoryOpen && (
            <CableDirectory
              index={cableNetworkIndex}
              onSelectCable={(id) => handleSelectNetworkItem({ kind: "cable", cableId: id })}
              onClose={() => setDirectoryOpen(false)}
            />
          )}

          {!cableChoices && !directoryOpen && networkSelection && (
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
