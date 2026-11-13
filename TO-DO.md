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
with a catch-up: the last 60 minutes in 30 s, every car calling at its stations, slowing into now.
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
      `timetable.js` when the socket fails or a snapshot is older than `FRESH` (120s)
- [x] The record: the hub stores a snapshot a minute (an alarm rings Metro up for ~8s when
      nobody is watching) and serves the last half hour at `/live/history`
- [x] Catch-up: `follower().replay()` in `public/js/live.js` runs the record through on
      `cubic-bezier(0.33, 1, 0.68, 1)` each time the view opens, notes and all, then goes live
- [x] Smooth hand-off from the catch-up to live: the first snapshot becomes the record's last
      frame when it comes in time, else cars ease up to date over 12s; after that they glide at
      the train's own speed (no lurch every snapshot), and finish their run before turning back
- [x] Cars vanishing and coming back (B, G and others): the hub dropped a train once Metro's
      report of it was 5 min old, but Metro goes on sending trains whose report is up to ~10 min
      old (end-of-line layovers, G buses in batches). It now drops a train only when Metro hasn't
      mentioned it for `GONE` (5 min). Side effect: layovers and a bus with a dead tracker stand
      still on the map instead of vanishing
- [x] Fewer hard cuts to the timetable and back: `FRESH` 30s → 120s rides out a reconnect (two
      retries + the hub waking, or a deploy), and back on a tab hidden longer than that runs the
      catch-up again instead of timetable → live
- [ ] Check the tab-return catch-up in a browser (no test covers it)
- [ ] First load with an empty record (`/live/history` frames ≤ 1) still goes timetable → live
      with a hard cut — maybe hold an empty map a few seconds longer for the first snapshot
- [ ] A Metro socket that stays open but goes silent is never redialled: the hub stops sending
      until the last viewer leaves. Hang up and redial a feed silent for `QUIET`
- [ ] An outage past `FRESH` still swaps timetable cars for live ones (different ids) with a cut;
      a cross-fade between the two would smooth it
- [x] Catch-up like the game: each car takes a hop at a time, standing at the stations either
      end (`STAND`) while passengers get off and on one by one (`SWAP`), on a steady clock that
      only slows over the last stretch (`RAMP`). Every snapshot that comes during it is folded
      in, so it still ends on now
- [x] Catch-up over the last 60 minutes instead of 30, in 30 s instead of 6: `PAST` in
      `public/js/live.js`, `KEEP` in `worker/index.js` (65 min), `CATCH_UP` in `trains.js`. A
      full replay needs the hub to have been recording for an hour; less is run through at the
      same speed
- [x] Cars snapping across or going missing where a train changed runs: one that turns back
      short of the end of the line (A trains do, a lot) or carries on as another line (B → D at
      Union Station) now rides to the station it turned at first, and takes the new line's name
- [ ] Look at it in a browser, day and night: tune `CATCH_UP` (`trains.js`) and `PAST`, `LAG`,
      `GLIDE`, `STAND`, `SWAP`, `RAMP` (`live.js`); maybe a "live" mark
- [ ] Trains whose tracker reports in bursts (G buses, the A's Long Beach loop) still dash a
      couple of hops in the catch-up. Cap the pace and let them run late?
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

## From the code review (unverified, 2026-11-12)
Live map — a visitor could see these:
- [ ] Stalled feed never redialled (`connect()` in `worker/index.js`): a Metro socket that goes
      quiet but stays open counts as healthy while anyone is watching. Needs a per-feed
      staleness check
- [ ] Stale trains shown as live (`settle()` in `public/js/live.js`): the record's last frame
      goes through `take()`, which stamps `heard = now`, so trains up to 3 min old pass as
      fresh for another 2 min before the timetable takes over

Build scripts — only when the data is refreshed:
- [ ] `extract()` in `scripts/fetch-gtfs.mjs` never checks `unzip`'s exit status: a bad
      download writes empty bus tables and the build drops the G Line without a word
- [ ] `head()` in `scripts/fetch-gtfs.mjs` doesn't check `res.ok`, and runs after the raw data
      is already overwritten, so `_source.json` can name the wrong commit
- [ ] `longest(dir)` and `busiest` in `scripts/lib/network.mjs` call `reduce` with no initial
      value: a route with trips in one direction only crashes the build without naming it
- [ ] The `extraPaths` scan in `scripts/lib/network.mjs` starts at `i = 1` and can run off the
      end of `back`: stations only the way back serves, at either terminus, are dropped

Latent or minor:
- [ ] `snapshot()` in `worker/index.js` compares `now - this.woke >= WARM` right after a
      `setTimeout(WARM)`: a timer a millisecond early loses that minute's record frame
- [ ] `moved` in `public/js/timetable.js` divides by `hop.arr - hop.dep - DWELL`: a hop of 20s
      or less gives NaN and kills the animation loop (shortest hop today is 60s)
- [ ] `drone()` in `public/js/trains.js` schedules two `setTargetAtTime` per animation frame.
      Throttle it to when `share` really changes
- [ ] `seat()` in `public/js/menu.js` reruns its brute-force search on every resize event, so
      the menu janks while a window edge is dragged. Debounce it
