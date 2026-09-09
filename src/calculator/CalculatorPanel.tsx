import { useMemo, useState } from "react";
import { calculateFacilityProfile, COOLING_SPECS, TIER_SPECS } from "./facilityCalculator";
import type { CoolingConfig, FacilityConfig, RedundancyLevel, TierLevel } from "./types";
import type { RouteRiskEstimate } from "./environmentalRisk";
import Recommendations from "./Recommendations";
import "./calculator.css";

const REDUNDANCY_OPTIONS: RedundancyLevel[] = ["N", "N+1", "2N"];
const TIER_OPTIONS: TierLevel[] = ["I", "II", "III", "IV"];
const COOLING_OPTIONS: CoolingConfig[] = Object.keys(COOLING_SPECS) as CoolingConfig[];

interface Props {
  siteName: string;
  siteLocation: string;
  isSubsea?: boolean;
  /** Defaults the cooling picker to a subsea-appropriate option */
  defaultCooling?: CoolingConfig;
  routeRisk?: RouteRiskEstimate | null;
  routeRiskLabel?: string;
  /**
   * The site's national grid carbon intensity, when a caller knows where the
   * site is (planning mode geocodes it, so it does). Without this CUE is
   * reported as unavailable -- see the CUE stat below for why that is the
   * only honest fallback.
   */
  gridCarbonGco2PerKwh?: number | null;
  /** Where gridCarbonGco2PerKwh came from, shown beside the CUE figure. */
  gridCarbonSource?: string;
}

export default function CalculatorPanel({
  siteName,
  siteLocation,
  isSubsea = false,
  defaultCooling = "air-crac",
  routeRisk,
  routeRiskLabel,
  gridCarbonGco2PerKwh = null,
  gridCarbonSource,
}: Props) {
  const [redundancy, setRedundancy] = useState<RedundancyLevel>("N+1");
  const [tier, setTier] = useState<TierLevel>("III");
  const [cooling, setCooling] = useState<CoolingConfig>(defaultCooling);
  const [downtimeCost, setDowntimeCost] = useState(9000);

  const config: FacilityConfig = useMemo(
    () => ({ redundancy, tier, cooling, downtimeCostPerHourUsd: downtimeCost }),
    [redundancy, tier, cooling, downtimeCost]
  );
  const profile = useMemo(
    () => calculateFacilityProfile(config, gridCarbonGco2PerKwh),
    [config, gridCarbonGco2PerKwh]
  );

  return (
    <div className="calc-panel">
      <div className="calc-panel-header">
        <span className="calc-badge">MODELED / HYPOTHETICAL</span>
        <h3>Configure a hypothetical deployment here</h3>
        <p className="calc-subtitle">
          Hypothetical facility at {siteName}, {siteLocation} -- not a claim about the real site.
        </p>
      </div>

      <div className="calc-inputs">
        <label className="calc-field">
          <span>Redundancy</span>
          <select value={redundancy} onChange={(e) => setRedundancy(e.target.value as RedundancyLevel)}>
            {REDUNDANCY_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="calc-field">
          <span>Tier</span>
          <select value={tier} onChange={(e) => setTier(e.target.value as TierLevel)}>
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {TIER_SPECS[t].label}
              </option>
            ))}
          </select>
        </label>

        <label className="calc-field">
          <span>Cooling</span>
          <select value={cooling} onChange={(e) => setCooling(e.target.value as CoolingConfig)}>
            {COOLING_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {COOLING_SPECS[c].label}
              </option>
            ))}
          </select>
        </label>

        <label className="calc-field">
          <span>Downtime cost ($/hr)</span>
          <input
            type="number"
            min={0}
            step={500}
            value={downtimeCost}
            onChange={(e) => setDowntimeCost(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      <p className="calc-note">{TIER_SPECS[tier].description} {COOLING_SPECS[cooling].description}</p>

      <div className="calc-results">
        <div className="calc-stat">
          <span className="calc-stat-label">Est. availability</span>
          <span className="calc-stat-value">{profile.availabilityPct}%</span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">Est. annual downtime</span>
          <span className="calc-stat-value">{profile.annualDowntimeHours} hrs</span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">Est. downtime cost</span>
          <span className="calc-stat-value">${profile.annualDowntimeCostUsd.toLocaleString()}/yr</span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">PUE</span>
          <span className="calc-stat-value">{profile.pue}</span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">CUE</span>
          {/* CUE is PUE x the site's grid carbon intensity. When the caller
              knows where the site is, that is a real published national
              figure; when it does not, this reports unavailable rather than
              substituting a global average -- the national figures this app
              ships span 0 to 1,306 gCO2/kWh, so an average would be wrong by
              more than an order of magnitude at either end. */}
          <span
            className="calc-stat-value"
            title={
              gridCarbonGco2PerKwh == null
                ? "Needs a site location: CUE is PUE x the local grid's carbon intensity"
                : `PUE x ${gridCarbonGco2PerKwh} gCO2/kWh${gridCarbonSource ? ` (${gridCarbonSource})` : ""}`
            }
          >
            {profile.cue == null ? "n/a" : `${profile.cue} kg/kWh`}
          </span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">WUE</span>
          <span className="calc-stat-value">{profile.wue} L/kWh</span>
        </div>
      </div>

      <p className="calc-disclaimer">
        Tier availability figures are the published Uptime Institute standard values. Redundancy
        downtime modifiers and cooling PUE/CUE/WUE figures are illustrative typical benchmarks for
        scenario comparison, not measurements of any real facility.
      </p>

      <Recommendations
        isSubsea={isSubsea}
        downtimeCostPerHourUsd={downtimeCost}
        onApply={(applied) => {
          setRedundancy(applied.redundancy);
          setTier(applied.tier);
          setCooling(applied.cooling);
        }}
      />

      {routeRisk && (
        <div className="calc-risk">
          <div className="calc-panel-header">
            <span className="calc-badge calc-badge-risk">MODELED / ILLUSTRATIVE</span>
            <h3>Connectivity route risk{routeRiskLabel ? ` -- ${routeRiskLabel}` : ""}</h3>
          </div>
          <div className="calc-results">
            <div className="calc-stat">
              <span className="calc-stat-label">
                Ecological sensitivity{" "}
                <span className="calc-basis">
                  {routeRisk.ecologicalBasis === "measured" ? "measured (WDPA)" : "heuristic"}
                </span>
              </span>
              <span className={`risk-pill risk-${routeRisk.ecologicalSensitivity}`}>
                {routeRisk.ecologicalSensitivity}
              </span>
            </div>
            <div className="calc-stat">
              <span className="calc-stat-label">Bathymetric hazard</span>
              <span className={`risk-pill risk-${routeRisk.bathymetricHazard}`}>
                {routeRisk.bathymetricHazard}
              </span>
            </div>
            <div className="calc-stat">
              <span className="calc-stat-label">Overall</span>
              <span className={`risk-pill risk-${routeRisk.overall}`}>{routeRisk.overall}</span>
            </div>
          </div>
          <ul className="calc-risk-rationale">
            {routeRisk.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="calc-disclaimer">
            {routeRisk.ecologicalBasis === "measured"
              ? "Ecological sensitivity is measured against the World Database on Protected Areas (European extract, ~11 km cells) -- it indicates proximity to protected water, not a legal boundary. "
              : "Ecological sensitivity falls back to a geographic heuristic (depth, latitude band) because no protected-area data covers this route. "}
            Bathymetric hazard is a heuristic in both cases: the shipped depth data is a 0.5-degree
            band index, not a sounding. Reef data (Allen Coral Atlas) is not integrated.
          </p>
        </div>
      )}
    </div>
  );
}
