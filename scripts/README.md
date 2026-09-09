# Data pipeline

Everything under `scripts/` builds what the *app* ships — trimmed, committed
datasets in `public/data/`. There are two independent build paths:

- **[the network dataset](#building-app-ready-data)** — cables, landing points
  and data centre facilities, from `build-data.mjs`;
- **[the marine grids](#building-the-marine-routing-data)** — the land/water
  mask, seabed depth and protected-area rasters the routing engine searches.

Raw sourced data lives in `scripts/raw/` and `scripts/subsea-dcs.json`. It is
fetched/curated once and committed — the app never fetches these sources at
runtime, only the trimmed output in `public/data/`.

## Re-fetching raw sources

```bash
curl -s "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json" -o scripts/raw/cable-geo.json
curl -s "https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json" -o scripts/raw/landing-point-geo.json
curl -s "https://www.peeringdb.com/api/fac?limit=10000" -o scripts/raw/peeringdb-fac-all.json
```

These are the live TeleGeography-backed endpoints behind submarinecablemap.com
(the richiecarmichael/delusan GitHub mirrors mentioned in project docs ship
the same per-cable JSON split across hundreds of files — these consolidated
endpoints are the same underlying data, much cheaper to fetch/parse). The
PeeringDB endpoint is public but rate-limited for unauthenticated requests
(~1/hour for large pulls) — get an API key at peeringdb.com for regular runs.

## Subsea data centre dataset

`scripts/subsea-dcs.json` is a hand-curated, source-cited list — there is no
structured API for subsea DCs. It was compiled via Apify web research
(`apify/rag-web-browser`) against primary/news sources for each site. Every
entry carries `coordinate_precision` ("exact" | "approximate" | "unverified")
and a `coordinate_note` explaining how the position was derived, since none of
the three currently-known real deployments have a publicly disclosed GPS fix:

- **Project Natick (Microsoft, Orkney)** — positioned at the EMEC tidal test
  site off Eday; Microsoft never published exact coordinates. Confirmed
  discontinued (DCD, 2025) — no successor deployment.
- **Hainan / Lingshui (Highlander Digital Technology)** — positioned on the
  Lingshui, Hainan coastline per news coverage; no published seabed fix.
  Actively expanding (a further module added Feb 2025).
- **Shanghai Lingang (HiCloud)** — estimated from "~10km off the Lingang
  coast" reporting; no published GPS fix. Depth is reported inconsistently
  across sources (10m vs 35m) — see `coordinate_note` in the dataset.
- **Subsea Cloud "Jules Verne" (Port Angeles, WA)** — `coordinate_precision:
  "unverified"`: announced 2022, no independent confirmation the pod was ever
  physically deployed. Included as a named, sourced candidate rather than
  omitted, but flagged as unconfirmed.

To add a new site, research it, append an entry to `subsea-dcs.json` with
`sources` URLs, and re-run the build.

## Building app-ready data

```bash
node scripts/build-data.mjs
```

Writes `public/data/{cables,landing-points,land-dcs,subsea-dcs}.json`. The
subsea build step also computes each subsea DC's nearest cable landing point
(haversine distance) and embeds it as `nearestLandingPoint` /
`nearestLandingPointDistanceKm`, which the globe uses to draw the connector
arcs.

## Building the marine routing data

These three produce everything `src/routing/*` reads. They are independent of
`build-data.mjs` and of each other, and each is slow enough that its output is
committed rather than rebuilt on demand.

```bash
node scripts/build-ocean-grid.mjs        # -> public/data/ocean-grid.json
node scripts/build-ocean-depth-grid.mjs  # -> public/data/ocean-depth.{json,bin}
node scripts/build-protected-areas.mjs   # -> public/data/protected-areas.json
```

- **`build-ocean-grid.mjs`** rasterises the Natural Earth land and
  bathymetry-contour polygons in `scripts/raw/{land,bathymetry}/` into a 0.5°
  land/water mask with 12 depth bands. Named navigable straits narrower than
  the 56 km cell are force-opened and listed in the output's
  `straitCorrections`, because Gibraltar (14 km wide) otherwise rasterises to
  land and seals the Mediterranean. Artificial canals — Suez, Panama — are
  deliberately left closed, which is why a Marseille–Mumbai route comes out
  around Africa.
- **`build-ocean-depth-grid.mjs`** fetches NOAA NCEI's `DEM_global_mosaic` and
  stores real metres on that same mask, as an Int16 binary sidecar. A contour
  band is only a lower bound; this replaces it with a modelled depth. Cached
  strips land in `scripts/.cache-depth-strips/` and are re-fetchable.
- **`build-protected-areas.mjs`** rasterises EMODnet's marine protected areas
  onto the same grid. **Coverage is European, and the output records that**:
  cells outside the source's extent are stored as *unknown*, never as zero, so
  a route through unsurveyed water reports its environmental assessment as
  unavailable instead of claiming it found no constraints.

### Grid diagnostics

Not part of any build — these answer questions about the grid that was built.

```bash
node scripts/analyse-grid-connectivity.mjs  # connected components; which landing points can reach each other
node scripts/find-grid-barriers.mjs         # narrowest false land barrier per isolated basin
node scripts/profile-routing.mjs            # where the 15-25 s of an intercontinental search actually goes
```

`grid-connectivity.json` and `grid-barriers.json` are the committed outputs of
the first two, kept so the strait corrections above can be audited against the
measurements that justified them.
