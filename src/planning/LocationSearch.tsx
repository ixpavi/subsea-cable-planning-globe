// Free-text place lookup for one planning endpoint.
//
// The search is debounced and every in-flight request is aborted when the
// query changes, so a slow response for "sing" can never overwrite the
// results for "singapore" -- out-of-order responses would otherwise present
// results for a query the user has already moved past.
import { useEffect, useRef, useState } from "react";
import { geocodeLocation } from "../design/geocoding";
import type { GeocodeResult } from "../design/geocoding";
import type { PlannedLocation } from "./planningTypes";
import { formatCoords } from "./planningTypes";

const DEBOUNCE_MS = 350;

interface Props {
  placeholder: string;
  onChoose: (loc: PlannedLocation) => void;
}

export default function LocationSearch({ placeholder, onChoose }: Props) {
  const [query, setQuery] = useState("");
  // Results are stored with the query that produced them, so a stale set is
  // discarded during render rather than cleared by an effect. That keeps
  // "typed one more character" from ever painting a frame in which the old
  // city list sits under the new query.
  const [answered, setAnswered] = useState<{ query: string; results: GeocodeResult[] } | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "error">("idle");
  const abortRef = useRef<AbortController | null>(null);

  const trimmedQuery = query.trim();
  const tooShort = trimmedQuery.length < 2;
  const results = !tooShort && answered?.query === trimmedQuery ? answered.results : [];

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("searching");
      geocodeLocation(trimmed, { signal: controller.signal })
        .then((found) => {
          if (controller.signal.aborted) return;
          setAnswered({ query: trimmed, results: found });
          setStatus("idle");
        })
        .catch((err: unknown) => {
          // An abort is this component doing its job, not a failure to report.
          if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          setAnswered({ query: trimmed, results: [] });
          setStatus("error");
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <div className="plan-search">
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={placeholder}
      />
      {!tooShort && status === "searching" && <p className="plan-note">Searching OpenStreetMap Nominatim...</p>}
      {!tooShort && status === "error" && (
        <p className="plan-note">Lookup failed. Check the connection and try again.</p>
      )}
      {results.length > 0 && (
        <ul className="plan-results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng},${r.displayName}`}>
              <button
                type="button"
                onClick={() => {
                  // Clearing the query makes the derived result list empty on
                  // this same render -- no second state write needed.
                  setQuery("");
                  onChoose({ label: r.displayName, lat: r.lat, lng: r.lng, countryCode: r.countryCode });
                }}
              >
                {r.displayName}
                <span className="plan-result-coords">{formatCoords(r.lat, r.lng)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
