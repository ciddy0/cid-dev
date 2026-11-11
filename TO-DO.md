# cid.dev — LA Metro transit map art piece

A minimalist, animated schematic map of the LA Metro rail network: thick colored lines,
white station circles, 45°/90° bends, little trains gliding along. Inspired by the
schematic-map style (Beck, Vignelli, Mini Metro) — own palette, fonts, and art, no game assets.

**Stack:** plain HTML + SVG + vanilla JS in `public/`, one Node script in `scripts/` that
turns GTFS into a small JSON file. No framework, no build step for the site itself.
Deploys with `npx wrangler deploy` like the gag page. See `README.md` for where things live.

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
- [x] Simplify each line to just its stations (drop the wiggly shape points)
- [x] Snap each segment to octilinear directions (0/45/90/135°), adding one bend where needed
- [x] Nudge stations to keep min spacing so labels don't collide
- [x] Offset parallel lines where they share track (A/E downtown, B/D trunk) so both colors show
- [x] Draw the A Line's one-way Long Beach loop (`extraPaths` in metro.json) without it looking messy
- [x] Allow a hand-tuned override file (`data/overrides.json`) for stations that look bad
- [x] Sanity check: it should still *feel* like LA — Santa Monica left, Long Beach bottom,
      North Hollywood top, Pomona/APU far right

## 5. Render (static first)
- [x] `public/index.html` + `public/js/` load `metro.json` and draw an SVG
- [x] Lines: thick strokes, round caps/joins, line color
- [x] Stations: white circles with colored outline; transfers as bigger white circles / pills
- [x] Fit to viewport with padding, works on phone portrait and desktop landscape
- [x] Hover/tap a station → name label (no permanent label clutter)
- [x] Camera: drag / pinch / wheel to pan and zoom; the view opens close in on the hub at a
      readable size and zooms out as far as the whole map

## 6. Animate
- [x] Intro: lines draw in one after another (`stroke-dashoffset`, `public/js/intro.js`), each
      T popping in as its line reaches it. Stations stay hidden until the view screen
- [ ] Stations pop in as the view screen opens
- [x] Trains: small rounded rectangles moving along each line's path
- [x] Trains ease into stations, pause briefly, ease out; reverse at terminals
- [x] Rough frequency from GTFS (trains per line ~ headway), but simulated — not real-time
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

## 9. Live trains
Diagram: `docs/live-trains-architecture.svg`. One Durable Object holds the only sockets to Metro
(rail, and the G Line's buses) and fans out to every visitor, so Metro sees the same two
connections however many people are watching. Live trains run at real speed, so the view opens
with a catch-up: the last 30 minutes in 6 s, easing out into now.
- [x] Find a keyless feed: `wss://api.metro.net/ws/LACMTA_Rail/vehicle_positions` streams GTFS-rt
      vehicle positions every 3s, no API key (optionally filter: `/ws/LACMTA_Rail/vehicle_positions/801,802`)
- [ ] Note: the REST `trip_detail/route_code/{route}` endpoints returned `[]` while the socket
      had trains — retest in the daytime before relying on them
- [x] Prototype: connect straight to Metro's socket, look at what comes in per line (from Node:
      a message per vehicle, parked ones with no `trip`; G is `/ws/LACMTA/vehicle_positions/901`)
- [x] Adapter (`worker/adapt.js`): Metro's `route_code` / `directionId` / `stopId` /
      `currentStatus` / position → the states `show(states)` takes (line, from station, to
      station, progress), using `metro.json`, which now has each line's `route` and `platforms`
- [x] Durable Object hub (`worker/index.js`): keeps the latest state per train, broadcasts a
      snapshot to all browsers every 5s
- [x] Close the upstream sockets when the last viewer leaves; reopen on the next one
- [x] Worker route `/live` that upgrades to a websocket and forwards to the hub
- [x] Add the Durable Object binding + migration to `wrangler.jsonc`
- [x] Page (`public/js/live.js`): open `/live`, ease cars toward each snapshot; fall back to
      `timetable.js` when the socket fails or a snapshot is older than 30s
- [x] The record: the hub stores a snapshot a minute (an alarm rings Metro up for ~8s when
      nobody is watching) and serves the last half hour at `/live/history`
- [x] Catch-up: `follower().replay()` in `public/js/live.js` runs the record through on
      `cubic-bezier(0.33, 1, 0.68, 1)` each time the view opens, notes and all, then goes live
- [x] Smooth hand-off from the catch-up to live: the first snapshot becomes the record's last
      frame when it comes in time, else cars ease up to date over 12s; after that they glide at
      the train's own speed (no lurch every snapshot), and finish their run before turning back
- [ ] Look at it in a browser, day and night: tune `CATCH_UP` (`trains.js`) and `PAST`, `LAG`,
      `GLIDE` (`live.js`); maybe a "live" mark
- [ ] Catch-up over the last 60 minutes instead of 30: `PAST` in `public/js/live.js` and `KEEP`
      in `worker/index.js` (a little over `PAST`, so ~65 min). Twice the record to download
      (~40 KB gzipped) and twice as far for each train to race, so retune `CATCH_UP` and the
      curve with it; a full replay then needs the hub to have been recording for an hour
- [ ] Deploy, then watch the Durable Object's usage: awake while anyone has the map open, and
      for ~8s of every minute otherwise, for ever
- [ ] Check Metro's terms of use / rate limits; the API has `/login` + `/token`, so the socket may
      need auth one day — the fallback keeps the page working if it does

---

## Later / maybe
- [x] G busway line, drawn as a full line like on Metro's own map
- [ ] J busway line
- [ ] Future extensions as faint dotted lines ("coming soon")
- [ ] Click a line → it highlights, others fade
- [x] Sound: soft chime when a train arrives (off by default)
- [ ] Train crowding: G is still the busiest-looking line (cars cover ~51% of it). Try
      `LANE = 0.15` in `scripts/lib/schematize.mjs`, or shorter bus-sized cars for G
- [ ] Lines get thin zoomed all the way out (~4.6px on desktop, less on a phone) — maybe a
      floor on line thickness, or a tighter zoom-out cap
- [ ] On-screen zoom +/− buttons, for desktop visitors with no wheel or trackpad
- [ ] Tune the view's opening crop (`LINE_VIEW` in `public/js/menu.js`): on desktop the G Line sits right
      on the top edge of the window
