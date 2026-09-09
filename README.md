<div align="center">

# 🌊 Subsea Cable & Data Centre Planning Globe

**An interactive view of the real global submarine cable network and the data centre facilities it connects — plus a planning mode that proposes where a new facility's cable could run, with every quantity traceable to its source.**

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tests](https://img.shields.io/badge/tests-143%20passing-2ea44f)](#-testing)
[![Data](https://img.shields.io/badge/cable%20systems-724-0e7c86)](#-data-provenance)
[![Licence](https://img.shields.io/badge/licence-Apache%202.0-blue)](LICENSE)

</div>

---

## What it does

A data centre is only as useful as its connections, and transoceanic connections
are submarine fibre. This tool covers both halves of that problem:

- **Explore** — what actually exists, and where: the real cable network, its
  landing points, and the facilities it connects.
- **Plan** — what a *hypothetical* deployment would look like: pick a site and
  somewhere it needs to reach, and the routing engine proposes marine corridors
  between them, ranked, costed and profiled by seabed depth; the facility
  calculator sizes the site itself.

Its distinguishing feature is not the globe. It is that **every figure is
labelled with where it came from**, and a quantity the source does not publish
is reported as unavailable rather than estimated and shown as fact. The two
halves are visually separate for the same reason: real cable geometry and a
proposed corridor are on screen at the same time, and they must never be
mistakeable for each other.

---

## 📊 At a glance

<div align="center">

| | | | |
|:--:|:--:|:--:|:--:|
| **724** | **1,920** | **5,260** | **4** |
| cable systems | landing points | facilities | subsea DC sites |

</div>

---

## ✨ Capabilities

### 🗺️ Explore the real network
Every cable system, landing point and facility on a 3D globe. Click a cable to
isolate it from the other 723, frame it, and read its route, endpoints and
connected landing points.

### 🔎 Find a specific system
Search by cable or landing-point name, or browse the full directory of every
system. Clicking a 1 px line is a fine way to browse but a poor way to find
something specific, so both routes exist.

### 🎯 Reliable clicking
Custom screen-space hit-testing gives dependable cable selection where the
renderer's own raycasting cannot — see [`cableHitTest.ts`](src/cableHitTest.ts),
which reproduces three-globe's exact densification so the hit-test polyline is
the same curve that is drawn. Where a click genuinely lands on several cables,
it asks rather than guessing.

### 🏢 Inspect a facility
Operator, city, country and the networks present for land facilities; for the
real subsea deployments, depth, status, capacity where published, and a
coordinate-precision rating, because none of them has a publicly disclosed exact
position.

### 🧭 Plan a route
Pick a site and a destination, and an A\* search over a rasterised global ocean
grid returns three candidate corridors — shortest, depth-favouring and
diversity-seeking — each with its marine length, depth profile, seabed
difficulty index, overlap with existing cable corridors, protected-water
exposure and an estimated build cost. They are ranked by a weighted score whose
criteria are shown along with the share of the result each one actually
accounted for.

The engine reports what it cannot distinguish. Two candidates whose corridors
are closer together than one grid cell are still listed, flagged as **not
independent options** rather than quietly dropped, and a cable does not land at
a city, so each endpoint discloses the overland distance from the site to the
marine access point and whether that point is a real landing point or a
modelled one.

### 🏗️ Size the facility
Redundancy, tier and cooling choice give estimated availability, annual
downtime and its cost, plus PUE, WUE and CUE. CUE is PUE × the site's national
grid carbon intensity, so it is only computed once the site has a location —
the shipped national figures run from 0 to 1,306 gCO₂/kWh, which is a far wider
spread than any cooling choice, and a global average would be wrong by more
than an order of magnitude at either end. Without a location it reports `n/a`.

---

## 🔍 Data provenance

Nothing is presented without its standing.

| Quantity | Source | Standing |
|---|---|:--:|
| Cable geometry, landing points | TeleGeography-derived | `REAL` |
| Data centre facilities | [PeeringDB](https://www.peeringdb.com) | `REAL` |
| Subsea data centre sites | Hand-curated from primary and news sources | `REAL` |
| Grid carbon intensity | [Our World in Data](https://github.com/owid/energy-data) (compiling Ember and IEA) | `REAL` |
| Tier availability figures | Published Uptime Institute standard values | `REAL` |
| Nearest-landing distance | Haversine over the above | `DERIVED` |
| Land/water mask, depth bands | Natural Earth v5.1.1, rasterised to 0.5° | `DERIVED` |
| Seabed depth in metres | NOAA NCEI `DEM_global_mosaic`, on that grid | `DERIVED` |
| Protected-area exposure | EMODnet's European extract of the WDPA | `DERIVED` |
| Route geometry | A\* over the 0.5° grid, then simplified | `DERIVED` |
| Seabed difficulty index, route ranking | Model structure chosen here | `MODELED` |
| Build cost estimate | Model over length and difficulty | `MODELED` |
| Cooling PUE / WUE benchmarks | Illustrative typical values, held fixed | `USER_ASSUMPTION` |
| Capacity, owners, RFS date, cost | Not in the public export | `UNAVAILABLE` |
| Protected water outside Europe | No global dataset shipped | `UNAVAILABLE` |

The public cable-geometry export carries route geometry, names and landing
points, and nothing else. Capacity, ownership, in-service date and cost are
missing **from the source**, not from this app, and the interface says so on
every cable rather than leaving a blank that reads as zero. The same rule
governs the routing engine: outside the protected-area grid's European extent,
a route's environmental assessment reports *unavailable* — never "no
constraints found".

Facility coordinates are reported by operators and are generally geocoded from a
street address rather than surveyed, so they locate a site to roughly a city
block. Cable geometry terminates at each named landing point, which busy
landfalls share — Marseille, Mumbai and Singapore each take more than a dozen
systems, so several cables genuinely converge on one coordinate.

Place search in planning mode uses [OpenStreetMap
Nominatim](https://nominatim.openstreetmap.org). It resolves coordinates for
framing and routing only — it makes no claim that a data centre exists there.

---

## 🚀 Getting started

```bash
npm install
npm run dev
```

```bash
npm run build       # type-check and produce a static build in dist/
npm run preview     # serve the production build
npm run lint        # oxlint
npm test            # vitest
npm run build:data  # rebuild public/data from scripts/raw
```

There is no server, no account and no API key required to run or evaluate it.
The routing search runs in a Web Worker in the browser; an intercontinental
route takes roughly 15–25 seconds, and the globe deliberately shows no route
until it finishes rather than leaving the previous pair's geometry on screen.

---

## 🧪 Testing

```bash
npm test
```

143 tests over the geometry, the grid and the models: the screen-space cable
hit-test and the spherical camera framing (including the antimeridian cases a
naive implementation gets wrong), ocean-grid connectivity, the depth grid, the
protected-area raster, route analysis, the cost model, and the facility
calculator — the last checked against the shipped national carbon-intensity
data, so it tests the data as well as the arithmetic.

---

## 📂 Project structure

```
src/
├── App.tsx                   layout, data loading, mode + selection state
├── Globe.tsx                 3D globe, layers, hit-testing, route rendering
├── DetailPanel.tsx           facility / subsea site inspector
├── Legend.tsx                layer toggles
├── cableHitTest.ts           screen-space cable picking
├── cameraFraming.ts          spherical camera maths
├── cableNetwork.ts           cable ↔ landing-point join
├── assetUrl.ts               base-path-safe asset resolution
├── theme.css                 shared visual language
├── explore/                  search, directory, inspector, chooser
├── planning/                 planning mode: endpoints, candidates, panel
├── routing/                  the routing engine + its Web Worker
├── calculator/               facility sizing, PUE/WUE/CUE, route risk
├── siting/                   national indicators for a site's country
└── design/                   connectivity analysis, geocoding

scripts/
├── build-data.mjs            network dataset pipeline
├── build-ocean-grid.mjs      land/water mask + depth bands
├── build-ocean-depth-grid.mjs  seabed depth in metres (NOAA)
├── build-protected-areas.mjs   WDPA raster (European extent)
└── raw/                      committed source extracts

public/data/                  committed, app-ready datasets
```

---

## ⚠️ Known limitations

Stated here rather than discovered later:

- **Cable geometry is schematic.** The published route is a cartographic line,
  not an as-laid survey — roughly 7 vertices per 1,000 km. It shows which
  corridor a system uses, not where it physically lies.
- **Landing points are coastal locations,** not cable landing stations, and busy
  landfalls are shared between many systems.
- **Facility positions are operator-reported** and usually geocoded, so they are
  good to about a city block, not a building.
- **Proposed routes are quantised to ~55 km cells and 45° headings.** They show
  a plausible corridor, not a route. Two corridors closer together than one cell
  are not distinguishable by the data that produced them, and the engine says so.
- **Artificial canals are not navigable.** The source polygons contain natural
  coastline only, so Suez and Panama are closed and a Marseille–Mumbai route
  comes out around Africa. Natural straits narrower than one cell — Gibraltar is
  14 km wide — are force-opened, and each correction is listed by name in the
  grid's own `straitCorrections` field.
- **Protected-area coverage is European.** The source is EMODnet's extract of
  the WDPA, not the global database. Outside its extent the assessment is
  reported as unavailable.
- **National indicators are national.** Grid carbon intensity is a country-level
  aggregate; water stress especially varies enormously inside large countries.
  Treat them as an indicator of the regulatory and resource environment, not a
  measurement at the site.
- **The cost model is a model.** It is a deterministic function of route length
  and the difficulty index, with disclosed coefficients — a comparator between
  candidates, not a quotation.
- **Not survey-grade.** This is an exploration and decision-support prototype.

---

## 📜 Licence

[Apache License 2.0](LICENSE) — permissive reuse with an explicit patent grant.
Chosen over MIT deliberately: submarine cable route planning is a patent-active
area, and Apache 2.0 grants patent rights from contributors and terminates for
anyone who litigates over them.

**The code is Apache 2.0. The data is not.** Each dataset remains under the
terms of its own source — see the [provenance table](#-data-provenance). Check
those terms before redistributing any of it, particularly for commercial use.

<div align="center">

**Built with** React · TypeScript · Vite · three.js · react-globe.gl

*Data: TeleGeography · PeeringDB · Natural Earth · NOAA NCEI · EMODnet · Our World in Data · NASA Blue Marble*

</div>
