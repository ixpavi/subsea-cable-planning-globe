<div align="center">

# 🌊 Subsea Cable & Data Centre Planning Globe

**An interactive view of the real global submarine cable network and the data centre facilities it connects — built on published infrastructure data, with every quantity traceable to its source.**

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tests](https://img.shields.io/badge/tests-26%20passing-2ea44f)](#-testing)
[![Data](https://img.shields.io/badge/cable%20systems-724-0e7c86)](#-data-provenance)
[![Licence](https://img.shields.io/badge/licence-Apache%202.0-blue)](LICENSE)

</div>

---

## What it does

A data centre is only as useful as its connections, and transoceanic connections
are submarine fibre. This is the **network exploration** half of that problem:
seeing what actually exists, and where.

The tool renders the real global submarine cable network on a 3D globe together
with its landing points, the interconnection facilities on land, and the handful
of real subsea data centre deployments.

Its distinguishing feature is not the globe. It is that **every figure is
labelled with where it came from**, and a quantity the source does not publish
is reported as unavailable rather than estimated and shown as fact.

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

---

## 🔍 Data provenance

Nothing is presented without its standing.

| Quantity | Source | Standing |
|---|---|:--:|
| Cable geometry, landing points | TeleGeography-derived | `REAL` |
| Data centre facilities | [PeeringDB](https://www.peeringdb.com) | `REAL` |
| Subsea data centre sites | Hand-curated from primary and news sources | `REAL` |
| Nearest-landing distance | Haversine over the above | `DERIVED` |
| Capacity, owners, RFS date, cost | Not in the public export | `UNAVAILABLE` |

The public cable-geometry export carries route geometry, names and landing
points, and nothing else. Capacity, ownership, in-service date and cost are
missing **from the source**, not from this app, and the interface says so on
every cable rather than leaving a blank that reads as zero.

Facility coordinates are reported by operators and are generally geocoded from a
street address rather than surveyed, so they locate a site to roughly a city
block. Cable geometry terminates at each named landing point, which busy
landfalls share — Marseille, Mumbai and Singapore each take more than a dozen
systems, so several cables genuinely converge on one coordinate.

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

---

## 🧪 Testing

```bash
npm test
```

26 tests over the two pieces of real geometry logic: the screen-space cable
hit-test and the spherical camera framing, including the antimeridian cases
that a naive implementation gets wrong.

---

## 📂 Project structure

```
src/
├── App.tsx                   layout, data loading, selection state
├── Globe.tsx                 3D globe, layers, hit-testing
├── DetailPanel.tsx           facility / subsea site inspector
├── Legend.tsx                layer toggles
├── cableHitTest.ts           screen-space cable picking
├── cameraFraming.ts          spherical camera maths
├── cableNetwork.ts           cable ↔ landing-point join
├── assetUrl.ts               base-path-safe asset resolution
├── theme.css                 shared visual language
└── explore/                  search, directory, inspector, chooser

scripts/
├── build-data.mjs            build-time data pipeline
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

*Data: TeleGeography · PeeringDB · Natural Earth · NASA Blue Marble*

</div>
