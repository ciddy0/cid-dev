# cid.dev — LA Metro transit map art piece

A minimalist, animated schematic map of the LA Metro rail network: thick colored lines,
white station circles, 45°/90° bends, little trains gliding along. Inspired by the
schematic-map style (Beck, Vignelli, Mini Metro) — own palette, fonts, and art, no game assets.

**Stack:** plain HTML + SVG + vanilla JS in `public/`, one Node script in `scripts/` that
turns GTFS into a small JSON file. No framework, no build step for the site itself.
Deploys with `npx wrangler deploy` like the gag page.

---

## 1. Setup
- [x] `git init`, add `.gitignore` (`node_modules/`, `.wrangler/`, `data/raw/`)
- [x] Move the gag page to `public/meow.html` so it lives on at cid.dev/meow
- [x] Create `scripts/`, `data/raw/`, `public/data/`

## 2. Get the data
Source: LA Metro rail GTFS — https://gitlab.com/LACMTA/gtfs_rail
- [x] Script `scripts/fetch-gtfs.mjs` that downloads `routes.txt`, `trips.txt`, `stops.txt`,
      `stop_times.txt`, `shapes.txt` into `data/raw/`
- [x] Note the feed date in the output so it's obvious when it's stale
- [x] Decide scope: rail only for v1 (A, B, C, D, E, K). G/J busways maybe later as dashed lines

## 3. Process into map data
Script `scripts/build-map.mjs` → writes `public/data/metro.json`
- [x] For each route: pick the longest/most common shape as the canonical path
- [x] Get the ordered station list per line (from a representative trip's `stop_times`)
- [x] Merge platforms into one station by `parent_station` (e.g. 7th St/Metro, Union Station)
- [x] Mark transfer stations (served by 2+ lines)
- [x] Project lat/lon → x/y (simple equirectangular around ~34.05°N is fine)
- [x] Grab line colors from `routes.txt` (`route_color`) as a starting point, tweak later
- [x] Keep the JSON small: lines, ordered station ids, station names + x/y, transfer flags

## 4. Schematize (the hard/fun part)
- [ ] Simplify each line to just its stations (drop the wiggly shape points)
- [ ] Snap each segment to octilinear directions (0/45/90/135°), adding one bend where needed
- [ ] Nudge stations to keep min spacing so labels don't collide
- [ ] Offset parallel lines where they share track (A/E downtown, B/D trunk) so both colors show
- [ ] Draw the A Line's one-way Long Beach loop (`extraPaths` in metro.json) without it looking messy
- [ ] Allow a hand-tuned override file (`data/overrides.json`) for stations that look bad
- [ ] Sanity check: it should still *feel* like LA — Santa Monica left, Long Beach bottom,
      North Hollywood top, Pomona/APU far right

## 5. Render (static first)
- [ ] `public/index.html` + `public/map.js` load `metro.json` and draw an SVG
- [ ] Lines: thick strokes, round caps/joins, line color
- [ ] Stations: white circles with colored outline; transfers as bigger white circles / pills
- [ ] Fit to viewport with padding, works on phone portrait and desktop landscape
- [ ] Hover/tap a station → name label (no permanent label clutter)

## 6. Animate
- [ ] Intro: lines draw in one at a time (`stroke-dashoffset`), stations pop in after
- [ ] Trains: small rounded rectangles moving along each line's path
- [ ] Trains ease into stations, pause briefly, ease out; reverse at terminals
- [ ] Rough frequency from GTFS (trains per line ~ headway), but simulated — not real-time
- [ ] Day/night: background + palette shift based on current LA time (`America/Los_Angeles`)
- [ ] Respect `prefers-reduced-motion` (skip intro, slow/stop trains)

## 7. Polish
- [ ] Pick a typeface for labels (clean sans; self-host or system stack)
- [ ] Tiny corner signature: "cid" + a couple links
- [ ] Favicon (a station dot?)
- [ ] `<meta>` title/description + an OG image (screenshot of the map) for link previews
- [ ] Check performance on a phone — keep it smooth at 60fps

## 8. Ship
- [ ] `npx wrangler deploy`
- [ ] Check cid.dev on desktop + phone, check cid.dev/meow still works

---

## Later / maybe
- [ ] Live trains — LA Metro's real-time feed needs an API key; check whether there's a public
      feed that doesn't, otherwise skip. A Worker would proxy + cache it
- [ ] Bus rapid lines (G, J) as dashed lines
- [ ] Future extensions as faint dotted lines ("coming soon")
- [ ] Click a line → it highlights, others fade
- [ ] Sound: soft chime when a train arrives (off by default)
