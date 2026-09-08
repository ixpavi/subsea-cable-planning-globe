import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import GlobeGL from "react-globe.gl";
import type { GlobeMethods } from "react-globe.gl";
import type { CableFeature, LandDC, SubseaDC, LandingPoint, LayerToggles, Selection } from "./types";
import type { CableNetworkIndex, NetworkSelection } from "./cableNetwork";
import {
  findCablesNearScreenPoint,
  CABLE_HIT_TOLERANCE_PX,
  CABLE_HIT_AMBIGUITY_MARGIN_PX,
  TOUCH_TOLERANCE_SCALE,
} from "./cableHitTest";
import type { CableHitCandidate } from "./cableHitTest";
import { assetUrl } from "./assetUrl";

const LAND_DC_COLOR = "#5eead4";
const SUBSEA_DC_COLOR = "#fb923c";
const CONNECTOR_COLOR = "#fbbf24";
const ARC_LABEL_COLOR = "#e2e8f0";
// Match the source/destination planning-marker glyph colors (design.css
// .planning-marker-location / .planning-marker-destination) so a landing
// point rendered on the real-data side reads as "same endpoint" as its
// hypothetical marker, not an unrelated new color.

interface CableFlatPath {
  kind: "cable";
  cableId: string;
  cableName: string;
  color: string;
  points: [number, number][];
}

type FlatPath = CableFlatPath;

// Self-hosted rather than pulled from a CDN, so the globe is not one unpkg
// outage away from a black sphere. Built by scripts/build-earth-texture.py
// from NASA Blue Marble Next Generation (public domain).
//
// 4096x2048, not 8192x4096. The 8K version was tried and reverted: it decodes
// to ~179 MB of GPU memory once mipmapped against ~45 MB here, and that
// showed up as dropped frames during the camera animation after a cable
// click. Anisotropic filtering below does more for perceived sharpness than
// the extra resolution did.
const EARTH_TEXTURE_SMALL = assetUrl("textures/earth-2k.jpg");
const EARTH_TEXTURE_FULL = assetUrl("textures/earth-4k.jpg");

/** Starting camera altitude. */
const DEFAULT_ALTITUDE = 2.2;

type ArcDatum =
  | { kind: "connector"; startLat: number; startLng: number; endLat: number; endLng: number; label: string };

/** Imperative handle exposed to App.tsx -- the smallest addition needed for camera control without reworking Globe's rendering. */
export interface GlobeApi {
  flyTo: (lat: number, lng: number, altitude?: number) => void;
}

interface Props {
  cables: CableFeature[];
  landDCs: LandDC[];
  subseaDCs: SubseaDC[];
  toggles: LayerToggles;
  rotating: boolean;
  onUserInteracted: () => void;
  onSelect: (sel: Selection | null) => void;
  /** All real landing points -- only rendered as a clickable layer in explore mode (planningMode false); planning mode shows just the connectivity-analysis subset above. */
  landingPoints?: LandingPoint[];
  /** Cable<->landing-point join built once in App.tsx; drives the explore-mode cable explorer's highlighting and click routing. */
  cableNetworkIndex?: CableNetworkIndex | null;
  /** The single cable or landing point currently selected in the explore-mode cable explorer (independent of planning mode's connectivity selection). */
  networkSelection?: NetworkSelection | null;
  onSelectNetworkItem?: (sel: NetworkSelection) => void;
  /** Fired instead of a direct selection when a click's tolerance zone genuinely contains multiple distinct real cables -- see cableHitTest.ts. */
  onAmbiguousCableClick?: (candidates: CableHitCandidate[]) => void;
}

// --- Stable accessor identities --------------------------------------------
//
// three-globe rebuilds a layer's ENTIRE geometry whenever an accessor's
// identity changes. Passing inline arrows meant all 24 accessors were new on
// every render, so any state change anywhere in the app -- opening a panel,
// toggling a layer, selecting a list row -- rebuilt 1,933 densified cable
// paths and thousands of markers from scratch. That is the multi-second stall
// on interaction, and it had nothing to do with what was actually being
// changed.
//
// Every accessor that depends ONLY on its datum is defined once here, at
// module scope, so its identity is permanently stable. The ones that close
// over component state are memoised in the component with explicit
// dependencies, so they change only when their inputs genuinely do.
const pathPointLatAccessor = (p: unknown) => (p as [number, number])[0];
const pathPointLngAccessor = (p: unknown) => (p as [number, number])[1];
const pointLatAccessor = (p: unknown) => (p as { data: { lat: number } }).data.lat;
const pointLngAccessor = (p: unknown) => (p as { data: { lng: number } }).data.lng;
const arcAltitudeAccessor = () => 0.06;
const arcAltitudeAutoScaleAccessor = () => 0.5;
const arcStrokeAccessor = () => 0.6;
const arcDashLengthAccessor = () => 0.4;
const arcDashGapAccessor = () => 0.15;
const arcDashAnimateTimeAccessor = () => 2500;
const arcLabelAccessor = (d: unknown) =>
  `<div class="globe-tooltip" style="border-color:${ARC_LABEL_COLOR}">${(d as ArcDatum).label}</div>`;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const Globe = forwardRef<GlobeApi, Props>(function Globe(
  {
    cables,
    landDCs,
    subseaDCs,
    toggles,
    rotating,
    onUserInteracted,
    onSelect,
    landingPoints = [],
    cableNetworkIndex = null,
    networkSelection = null,
    onSelectNetworkItem,
    onAmbiguousCableClick,
  },
  ref
) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  // react-globe.gl/three-render-objects defaults its internal projection
  // width/height (used by getScreenCoords/getCoords for all hit-testing) to
  // `window.innerWidth/innerHeight` read ONCE at mount, with no resize
  // listener of its own -- so after a browser resize, its internal
  // projection size silently drifts from the canvas's actual rendered size,
  // while our click handler's canvas-relative coordinates (from
  // getBoundingClientRect, always live) do not. Passing explicit width/height
  // props kept fresh here closes that gap.
  const [dims, setDims] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const handleResize = () => setDims({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (lat: number, lng: number, altitude = 1.5) => {
        globeRef.current?.pointOfView({ lat, lng, altitude }, 1300);
      },
    }),
    []
  );

  // Initial camera + controls setup (runs once)
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.pointOfView({ lat: 20, lng: 10, altitude: DEFAULT_ALTITUDE }, 0);
    const controls = g.controls();
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    // Any manual drag/zoom pauses auto-rotation so the user keeps control of the view
    const handleStart = () => onUserInteracted();
    controls.addEventListener("start", handleStart);
    return () => controls.removeEventListener("start", handleStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep controls.autoRotate in sync with the rotating prop
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.controls().autoRotate = rotating;
  }, [rotating]);

  // --- Earth texture: load small first, swap to 8K when it arrives ----------
  // The 8K texture is 4.2 MB. Making first paint wait on it would leave the
  // screen empty for seconds on a slow connection, so the 0.3 MB version is
  // shown immediately and replaced once the large one has actually decoded.
  // Assigning the URL directly would blank the globe mid-load instead.
  const [earthTextureUrl, setEarthTextureUrl] = useState(EARTH_TEXTURE_SMALL);
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setEarthTextureUrl(EARTH_TEXTURE_FULL);
    };
    // On failure the small texture simply stays. A missing high-res file
    // should degrade the globe's sharpness, never leave it black.
    img.src = EARTH_TEXTURE_FULL;
    return () => {
      cancelled = true;
    };
  }, []);

  // Anisotropic filtering, applied whenever the texture changes.
  //
  // This matters more than the resolution bump. A globe is nearly always
  // viewed at a grazing angle away from the point facing the camera, and
  // three.js defaults to anisotropy 1, which forces the GPU to pick an
  // over-blurred mip level for exactly those foreshortened areas. The result
  // is that most of the visible Earth is soft no matter how large the texture
  // is. Raising it to the hardware maximum costs nothing at these sizes and
  // is the single biggest visible improvement when zoomed in.
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    // three-globe exposes globeMaterial as a PROP, not a method, so the
    // material is reached by walking the scene instead. The texture is also
    // created asynchronously after the URL prop changes, so poll briefly
    // rather than assume it already exists.
    type Tex = { anisotropy: number; needsUpdate: boolean };
    type Textured = { material?: { map?: Tex } | { map?: Tex }[] };
    let tries = 0;
    const id = window.setInterval(() => {
      const max = g.renderer()?.capabilities?.getMaxAnisotropy?.() ?? 1;
      if (max <= 1) {
        window.clearInterval(id);
        return;
      }
      let applied = false;
      g.scene()?.traverse((obj: unknown) => {
        const mats = (obj as Textured).material;
        if (!mats) return;
        for (const m of Array.isArray(mats) ? mats : [mats]) {
          const map = m?.map;
          if (map && typeof map.anisotropy === "number" && map.anisotropy < max) {
            map.anisotropy = max;
            map.needsUpdate = true;
            applied = true;
          }
        }
      });
      if (applied || ++tries > 40) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
  }, [earthTextureUrl]);

  // Cable explorer selection derivations.
  const exploreSelectedCableId =
    networkSelection?.kind === "cable" ? networkSelection.cableId : null;
  const exploreSelectedLandingPointId =
    networkSelection?.kind === "landingPoint" ? networkSelection.landingPointId : null;

  const exploreRelatedCableIds = useMemo(() => {
    if (!exploreSelectedLandingPointId || !cableNetworkIndex) return null;
    const cables = cableNetworkIndex.landingPointToCables.get(exploreSelectedLandingPointId) ?? [];
    return new Set(cables.map((c) => c.id));
  }, [exploreSelectedLandingPointId, cableNetworkIndex]);

  const exploreSelectedCableLandingPointIds = useMemo(() => {
    if (!exploreSelectedCableId || !cableNetworkIndex) return null;
    const lps = cableNetworkIndex.cableToLandingPoints.get(exploreSelectedCableId) ?? [];
    return new Set(lps.map((lp) => lp.id));
  }, [exploreSelectedCableId, cableNetworkIndex]);

  // True whenever something specific is selected and everything else is
  // context rather than subject. Cables already de-emphasize in this state;
  // the facility markers did not, so selecting a cable left 5,260 bright
  // points competing with the thing the user actually clicked.
  const hasFocusedSelection =
    exploreSelectedCableId !== null || exploreSelectedLandingPointId !== null;

  // NOTE: there is deliberately no camera-derived state in this component.
  // Anything stored from the camera changes as the user moves, and every such
  // change rebuilds the layers that depend on it -- which is how a marker
  // optimisation ended up making every camera movement more expensive than the
  // work it saved. Camera position is read directly where it is needed
  // instead, never mirrored into React state.

  const flatCablePaths: CableFlatPath[] = useMemo(
    () =>
      cables.flatMap((c) =>
        c.paths.map((points) => ({
          kind: "cable" as const,
          cableId: c.id,
          cableName: c.name,
          color: c.color,
          points,
        }))
      ),
    [cables]
  );

  const combinedPaths: FlatPath[] = useMemo(
    () => (toggles.cables ? flatCablePaths : []),
    [toggles.cables, flatCablePaths]
  );

  const arcsData: ArcDatum[] = useMemo(() => {
    const connectorArcs: ArcDatum[] =
      toggles.connectors && toggles.subseaDCs
        ? subseaDCs
            .filter((dc) => dc.nearestLandingPoint)
            .map((dc) => ({
              kind: "connector" as const,
              startLat: dc.lat,
              startLng: dc.lng,
              endLat: dc.nearestLandingPoint!.lat,
              endLng: dc.nearestLandingPoint!.lng,
              label: `${dc.name} → ${dc.nearestLandingPoint!.name} (${dc.nearestLandingPointDistanceKm} km)`,
            }))
        : [];

    return connectorArcs;
  }, [subseaDCs, toggles.connectors, toggles.subseaDCs]);

  // Every real landing point, clickable.
  const explorePointsData = useMemo(() => {
    if (!toggles.landingPoints) return [];
    return landingPoints.map((lp) => ({ kind: "exploreLandingPoint" as const, data: lp }));
  }, [toggles.landingPoints, landingPoints]);

  const pointsData = useMemo(
    () => [
      ...(toggles.landDCs ? landDCs.map((d) => ({ kind: "land" as const, data: d })) : []),
      ...(toggles.subseaDCs ? subseaDCs.map((d) => ({ kind: "subsea" as const, data: d })) : []),
      ...explorePointsData,
    ],
    // Deliberately independent of the camera. Horizon culling used to live
    // here, dropping the markers behind the planet -- but three-globe rebuilds
    // the whole layer when its data changes, so culling made every camera
    // movement rebuild all 5,260 markers to avoid drawing the ~18% that were
    // never visible. Clicking a cable flies the camera, so it paid that cost
    // every time. Building the layer once and leaving it alone is far cheaper
    // than repeatedly rebuilding a slightly smaller one.
    [toggles.landDCs, toggles.subseaDCs, landDCs, subseaDCs, explorePointsData]
  );

  // Custom cable click/hover hit-testing -- see cableHitTest.ts for why
  // three-globe's built-in path raycasting can't be trusted (effective
  // click tolerance is sub-pixel, independent of any `pathStroke` value).
  // The native listener below is attached once; it always reads the latest
  // props through this ref so it never needs to be torn down and re-bound
  // as selection/mode state changes.
  const interactionStateRef = useRef({
    cables,
    onSelectNetworkItem,
    onAmbiguousCableClick,
    onUserInteracted,
  });
  interactionStateRef.current = {
    cables,
    onSelectNetworkItem,
    onAmbiguousCableClick,
    onUserInteracted,
  };

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const canvas = g.renderer().domElement;

    let downPos: { x: number; y: number } | null = null;
    let lastHoverAt = 0;

    // Touch needs a bigger target than a mouse. A fingertip contact patch is
    // roughly 8-10mm and the point the browser reports can sit several pixels
    // from where the user believed they pressed, so the 9px tolerance tuned
    // against a 1px cursor leaves a 1.6px-wide cable effectively unhittable on
    // a phone. The click-vs-drag threshold is raised for the same reason: a
    // finger drifts several pixels during a deliberate tap, and at 5px those
    // taps were being classified as rotate gestures and discarded.
    //
    // Read through the live MediaQueryList rather than captured at mount, so a
    // convertible or a device with both a trackpad and a touchscreen picks up
    // whichever input is actually being used.
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const hitTolerancePx = () =>
      coarsePointer.matches ? CABLE_HIT_TOLERANCE_PX * TOUCH_TOLERANCE_SCALE : CABLE_HIT_TOLERANCE_PX;
    const ambiguityMarginPx = () =>
      coarsePointer.matches
        ? CABLE_HIT_AMBIGUITY_MARGIN_PX * TOUCH_TOLERANCE_SCALE
        : CABLE_HIT_AMBIGUITY_MARGIN_PX;
    const dragThresholdPx = () => (coarsePointer.matches ? 12 : 5);

    function canvasPos(e: PointerEvent): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function resolveCandidates(x: number, y: number): CableHitCandidate[] {
      const s = interactionStateRef.current;
      const globeInstance = globeRef.current;
      if (!globeInstance) return [];
      return findCablesNearScreenPoint(s.cables, globeInstance, x, y, hitTolerancePx());
    }

    function handlePointerDown(e: PointerEvent) {
      downPos = canvasPos(e);
      // Stop auto-rotation the INSTANT a pointer touches the canvas, before
      // any click-vs-drag decision or hit-testing runs. Previously this
      // only happened via OrbitControls' own 'start' event round-tripping
      // through React state (onUserInteracted -> setRotating(false) -> a
      // separate effect setting controls.autoRotate) -- a real gap during
      // which the camera keeps rotating. At high zoom, a few milliseconds
      // of continued rotation is enough screen-space drift to move a cable
      // out from under a pointer that was, at the moment the user looked,
      // sitting exactly on it. Setting autoRotate here directly guarantees
      // the camera is frozen for the whole duration of pointerdown ->
      // pointerup, so the projection computed at click time matches what
      // was actually on screen when the user clicked.
      const g = globeRef.current;
      if (g) g.controls().autoRotate = false;
      interactionStateRef.current.onUserInteracted();
    }

    function handlePointerUp(e: PointerEvent) {
      const start = downPos;
      downPos = null;
      if (!start) return;
      const up = canvasPos(e);
      // A real drag/rotate, not a click -- OrbitControls already handled it.
      if (Math.hypot(up.x - start.x, up.y - start.y) > dragThresholdPx()) return;

      const filtered = resolveCandidates(up.x, up.y);
      const s = interactionStateRef.current;

      if (filtered.length === 0) {
        return;
      }

      const [closest, second] = filtered;
      const margin = ambiguityMarginPx();
      const ambiguous = second != null && second.distancePx - closest.distancePx < margin;

      if (ambiguous) {
        const tied = filtered.filter((c) => c.distancePx - closest.distancePx < margin);
        s.onAmbiguousCableClick?.(tied);
        return;
      }

      s.onSelectNetworkItem?.({ kind: "cable", cableId: closest.cableId });
    }

    // Cursor feedback -- throttled by time only (a full scan projects every
    // stored cable point and doesn't need to run at full pointer-move rate),
    // but evaluated SYNCHRONOUSLY: position and camera state must be read at
    // the same instant, or the cursor can reflect a different moment than
    // what a click at that same position would see. A prior version deferred
    // the actual hit-test to the next requestAnimationFrame while only
    // capturing the pointer position up front -- if the camera moved at all
    // between the event and that later frame (e.g. residual OrbitControls
    // damping momentum still decaying after a drag), the cursor would show
    // "pointer" for a position/camera pairing that no longer matched what a
    // click moments later would resolve against, which is exactly the
    // "hover says yes, click says no" symptom this was causing.
    function handlePointerMove(e: PointerEvent) {
      const now = performance.now();
      if (now - lastHoverAt < 90) return;
      lastHoverAt = now;
      const pos = canvasPos(e);

      // Hover is advisory -- it only sets the cursor. When the pointer is not
      // over the globe at all there is nothing to hit, so skip the scan
      // entirely rather than projecting cable geometry against empty space.
      // Most pointer movement in a session is over space, and this was running
      // a full scan for all of it. Clicking still runs the authoritative scan
      // in handlePointerUp, so nothing about hit accuracy changes.
      const g = globeRef.current;
      if (g?.toGlobeCoords && !g.toGlobeCoords(pos.x, pos.y)) {
        canvas.style.cursor = "default";
        return;
      }

      if (resolveCandidates(pos.x, pos.y).length > 0) {
        canvas.style.cursor = "pointer";
        return;
      }
      canvas.style.cursor = "default";
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointermove", handlePointerMove);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointermove", handlePointerMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Memoised so a re-render that does not touch these inputs leaves the
  // accessor identities alone, and three-globe skips rebuilding the layer.
  const pathColorAccessor = useCallback(
    (d: unknown) => {
      const p = d as FlatPath;
      // An explicit selection always wins. Fades are aggressive on purpose --
      // the selected cable must read as unmistakably "the one" against 700+
      // others, while the rest stay faint but non-zero so the surrounding
      // network still reads as a network rather than empty ocean.
      if (exploreSelectedCableId) {
        return p.cableId === exploreSelectedCableId ? p.color : hexToRgba(p.color, 0.045);
      }
      if (exploreRelatedCableIds) {
        return exploreRelatedCableIds.has(p.cableId) ? p.color : hexToRgba(p.color, 0.045);
      }
      return p.color;
    },
    [exploreSelectedCableId, exploreRelatedCableIds]
  );

  const pathLabelAccessor = useCallback((d: unknown) => {
    const p = d as FlatPath;
    return `<div class="globe-tooltip"><strong>${p.cableName}</strong><br/>Submarine cable route<div class="globe-tooltip-hint">click to inspect this cable</div></div>`;
  }, []);

  const pathStrokeAccessor = useCallback(
    (d: unknown) => {
      const cableId = (d as FlatPath).cableId;
      if (exploreSelectedCableId) return cableId === exploreSelectedCableId ? 2.6 : 0.4;
      if (exploreRelatedCableIds) return exploreRelatedCableIds.has(cableId) ? 1.8 : 0.4;
      return 0.6;
    },
    [exploreSelectedCableId, exploreRelatedCableIds]
  );

  const pathDashLengthAccessor = useCallback(() => 0.1, []);

  const pathDashGapAccessor = useCallback(() => 0.008, []);

  const pathDashAnimateTimeAccessor = useCallback(() => 12000, []);

  const pointColorAccessor = useCallback(
    (p: unknown) => {
    const item = p as { kind: string; data?: { id?: string; role?: "source" | "destination" } };
    if (item.kind === "exploreLandingPoint") {
      const id = item.data?.id;
      if (id && exploreSelectedLandingPointId === id) return "#facc15";
      if (id && exploreSelectedCableLandingPointIds?.has(id)) return "#67e8f9";
      // Unrelated landing points recede further once a cable is the
      // subject, so the cable's own landings read as the highlighted set.
      return hexToRgba("#94a3b8", exploreSelectedCableId ? 0.16 : 0.45);
    }
    const base = item.kind === "subsea" ? SUBSEA_DC_COLOR : LAND_DC_COLOR;
    // Facilities are background context whenever a cable or landing point
    // is the subject. Kept faintly visible rather than hidden, so the user
    // can still see that infrastructure is there.
    return hasFocusedSelection ? hexToRgba(base, 0.08) : base;
  },
    [hasFocusedSelection, exploreSelectedCableId, exploreSelectedLandingPointId, exploreSelectedCableLandingPointIds]
  );

  const pointAltitudeAccessor = useCallback(
    (p: unknown) => {
    const item = p as { kind: string; data?: { id?: string } };
    if (item.kind === "exploreLandingPoint") {
      const id = item.data?.id;
      const emphasized =
        (id && exploreSelectedLandingPointId === id) || (id && exploreSelectedCableLandingPointIds?.has(id));
      return emphasized ? 0.014 : 0.006;
    }
    return item.kind === "subsea" ? 0.018 : 0.006;
  },
    [exploreSelectedLandingPointId, exploreSelectedCableLandingPointIds]
  );

  const pointRadiusAccessor = useCallback(
    (p: unknown) => {
    const item = p as { kind: string; data?: { id?: string } };
    if (item.kind === "exploreLandingPoint") {
      const id = item.data?.id;
      if (id && exploreSelectedLandingPointId === id) return 0.7;
      if (id && exploreSelectedCableLandingPointIds?.has(id)) return 0.48;
      return 0.28;
    }
    return item.kind === "subsea" ? 0.85 : 0.42;
  },
    [exploreSelectedLandingPointId, exploreSelectedCableLandingPointIds]
  );

  const pointLabelAccessor = useCallback(
    (p: unknown) => {
    const point = p as Selection | { kind: "exploreLandingPoint"; data: LandingPoint };
    if (point.kind === "exploreLandingPoint") {
      const lp = point.data;
      return `<div class="globe-tooltip">
        <div style="font-weight:600">${lp.name}</div>
        <div class="detail-section-label" style="margin:4px 0">REAL LANDING POINT</div>
        <div class="globe-tooltip-hint">click for connected cable systems</div>
      </div>`;
    }
    if (point.kind === "subsea") {
      const dc = point.data as SubseaDC;
      return `
        <div class="globe-tooltip" style="border-color:${SUBSEA_DC_COLOR}">
          <div style="font-weight:600;color:${SUBSEA_DC_COLOR}">\u{1F30A} ${dc.name}</div>
          <div>${dc.operator}</div>
          <div>Depth: ${dc.depth_m} m &middot; Status: ${dc.status}</div>
          ${dc.capacity_mw ? `<div>Capacity: ${dc.capacity_mw} MW</div>` : ""}
          ${
            dc.nearestLandingPoint
              ? `<div>Nearest landing: ${dc.nearestLandingPoint.name} (${dc.nearestLandingPointDistanceKm} km)</div>`
              : ""
          }
          ${
            dc.coordinate_precision !== "exact"
              ? `<div style="color:#f59e0b;font-style:italic;margin-top:4px">⚠ coordinates approximate</div>`
              : ""
          }
          <div class="globe-tooltip-hint">click for full details</div>
        </div>`;
    }
    const dc = point.data as LandDC;
    return `
      <div class="globe-tooltip" style="border-color:${LAND_DC_COLOR}">
        <div style="font-weight:600;color:${LAND_DC_COLOR}">${dc.name}</div>
        <div>${dc.org}</div>
        <div>${dc.city}, ${dc.country}</div>
        <div class="globe-tooltip-hint">click for full details</div>
      </div>`;
  },
    []
  );

  const arcColorAccessor = useCallback(() => CONNECTOR_COLOR, []);

  return (
    <GlobeGL
      ref={globeRef}
      width={dims.width}
      height={dims.height}
      globeImageUrl={earthTextureUrl}
      bumpImageUrl={assetUrl("textures/earth-topology.png")}
      backgroundImageUrl={assetUrl("textures/night-sky.png")}
      showAtmosphere
      atmosphereColor="#4fd1ff"
      atmosphereAltitude={0.22}
      // --- Submarine cable routes + hypothetical route candidates (same
      // layer, same rendering/densification pipeline -- see combinedPaths) ---
      pathsData={combinedPaths}
      pathPoints="points"
      pathPointLat={pathPointLatAccessor}
      pathPointLng={pathPointLngAccessor}
      pathColor={pathColorAccessor}
      pathLabel={pathLabelAccessor}
      pathStroke={pathStrokeAccessor}
      pathDashLength={pathDashLengthAccessor}
      pathDashGap={pathDashGapAccessor}
      pathDashAnimateTime={pathDashAnimateTimeAccessor}
      pathTransitionDuration={0}
      // Route click/hover, like real-cable click/hover, is handled by our
      // own native listener below -- NOT onPathClick/built-in raycasting,
      // for the same reason cables aren't: both layers render as Line2 fat
      // lines, whose raycast hit-tolerance three-globe/three-render-objects
      // never actually configures (see cableHitTest.ts's module doc).
      // Cable click/hover is handled by our own native listener (see the
      // useEffect above) -- three-globe's built-in path raycasting has an
      // effective click tolerance of a fraction of a pixel (see
      // cableHitTest.ts) and is not wired up here at all.
      // --- Land-based DC facilities (PeeringDB) + subsea DC sites, plus real
      // cable landing points (connectivity-analysis subset in planning mode,
      // every landing point in explore mode) ---
      pointsData={pointsData}
      pointLat={pointLatAccessor}
      pointLng={pointLngAccessor}
      pointColor={pointColorAccessor}
      pointAltitude={pointAltitudeAccessor}
      // Fixed angular sizes, tuned for legibility at the zoom levels this globe
      // is actually used at. An earlier version scaled these with camera
      // altitude to make markers pinpoint-accurate when zoomed in; that was the
      // wrong trade. The Earth texture is 8K, so there is no satellite-level
      // detail to pinpoint AGAINST -- shrinking the markers only made them
      // harder to see and bought precision the imagery cannot support.
      pointRadius={pointRadiusAccessor}
      // Back to 8. Raising this to 14 to smooth the octagon edge was the wrong
      // trade: it added ~75% more geometry across thousands of markers to fix
      // an artefact that was only visible because the markers were 93 km wide.
      // Now that they are sized correctly the facet count is imperceptible.
      pointResolution={8}
      pointLabel={pointLabelAccessor}
      onPointClick={(p: unknown) => {
        const item = p as { kind: string; data: unknown };
        if (item.kind === "exploreLandingPoint") {
          onSelectNetworkItem?.({ kind: "landingPoint", landingPointId: (item.data as LandingPoint).id });
          return;
        }
        onSelect(p as Selection);
      }}
      onPointHover={(p: unknown) => {
        const canvas = globeRef.current?.renderer().domElement;
        if (canvas) canvas.style.cursor = p ? "pointer" : "default";
      }}
      // --- Connector lines: subsea DC -> nearest cable landing point, plus the
      // planning-mode "connectivity requirement" line (never a real cable) ---
      arcsData={arcsData}
      arcsTransitionDuration={0}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor={arcColorAccessor}
      // The planning line spans whatever the user's two cities happen to be
      // -- anywhere from a few hundred to over ten thousand km. A fixed
      // altitude (the old 0.12) is tuned for short hops; for a long route it
      // sits too low relative to the great-circle distance, so part of the
      // arc dips behind the globe's own curvature depending on camera angle
      // and reads as an incomplete/partial line. `null` here defers to
      // three-globe's own distance-proportional auto-scale instead, so the
      // arc always clears the horizon regardless of how far apart the two
      // points are.
      arcAltitude={arcAltitudeAccessor}
      arcAltitudeAutoScale={arcAltitudeAutoScaleAccessor}
      arcStroke={arcStrokeAccessor}
      // Dash length/gap are fractions of the ARC'S TOTAL LENGTH, not a fixed
      // pixel pattern -- the old 0.25/0.18 produced only ~2 dash-gap cycles
      // across the whole line, which reads as two disconnected fragments
      // rather than one line, especially caught mid-animation. A denser
      // pattern (many small dashes) reads unambiguously as a single
      // continuous dashed connection, matching the dashed-border convention
      // used elsewhere in the app for modeled/hypothetical elements.
      arcDashLength={arcDashLengthAccessor}
      arcDashGap={arcDashGapAccessor}
      arcDashAnimateTime={arcDashAnimateTimeAccessor}
      arcLabel={arcLabelAccessor}
    />
  );
});

export default Globe;
