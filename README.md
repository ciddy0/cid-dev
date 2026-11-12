# cid.dev

My site. It's a map of the LA Metro rail network with the trains where Metro says they are
right now, and the menu, my resume and the settings all live on top of it. Mostly I just wanted
something nice to look at.

It's plain HTML, SVG and JavaScript, plus one small Cloudflare Worker for the live trains. No
framework, no dependencies, no build step for the site. What's left to do is in
[TO-DO.md](TO-DO.md).

Not affiliated with LA Metro. Please don't plan a trip with it.

## Commands

| | |
| --- | --- |
| `npm run dev` | serve `public/` and the Worker locally (wrangler); the live trains are real |
| `npm test` | unit tests (`node --test`, nothing to install) |
| `npm run fetch` | download the GTFS feeds into `data/raw/` (not committed) |
| `npm run build` | `data/raw/` + `data/overrides.json` → `public/data/metro.json` |
| `npm run deploy` | publish `public/` and the Worker to cid.dev |

Needs Node 22 or newer. The page itself only needs `public/` served by anything static: without
the Worker its trains follow the timetable.

## How it fits together

```
GTFS feeds ──fetch──▶ data/raw/ ──build──▶ public/data/metro.json ──▶ the page
                        data/overrides.json ──┘                    └──▶ the Worker ──/live──▶ the page
```

**The data pipeline** (`scripts/`) runs by hand, when the feed or the layout changes, and its
output is committed.

| | |
| --- | --- |
| `fetch-gtfs.mjs` | command: downloads the rail feed, and the G Line's rows of the bus feed |
| `build-map.mjs` | command: reads the tables, builds, lays out, writes `metro.json`, reports |
| `lib/network.mjs` | GTFS tables → lines and stations, geographic |
| `lib/schematize.mjs` | geographic → schematic: the layout, steered by `data/overrides.json` (documented at the top of the file) |
| `lib/csv.mjs`, `lib/vec.mjs`, `lib/paths.mjs` | CSV parser, vector maths, where files live |

`build-map` prints layout problems (stations too close, a stop off its path, an override that
matches nothing); fix those in `data/overrides.json`, not in `metro.json`.

**The page** (`public/`) is `index.html`, `styles.css` and the modules in `js/`. `main.js` wires
them up, roughly in this order:

| | |
| --- | --- |
| `network.js` | loads `metro.json`; line colours |
| `draw.js` | draws the coastline, lines, termini (`termini.js`) and stations into the `<svg>`; returns the tracks, stations and bounds everything else works from |
| `camera.js` | the viewBox: drag, pinch, wheel, glides |
| `label.js` | the station name label and halo |
| `trains.js` | puts a car wherever a feed says a train is, riding the tracks (`rail.js`) |
| `live.js` | the live feed: the last half hour run through in a few seconds as the view opens, then the socket to `/live`, cars eased from one snapshot to the next |
| `timetable.js` | the fallback feed: where every train is, worked out from the timetable |
| `menu.js` | the menu and the screens it flies to (view, resume, docs, settings); starts and stops the trains |
| `intro.js` | the lines drawing themselves in as the page opens |
| `resume.js` | the resume screen: the jobs as stops along a line, the picked one a card on it with a little map of where the job was |
| `settings.js`, `prefs.js` | the settings (language, night mode, colorblind mode, coastline, motion, sound, volume), stored in `localStorage` |
| `lang.js` | every word on the page, in English and Spanish |
| `sound.js` | the synthesized piano: a note as a train arrives on screen, menu figures, the hum |
| `geometry.js`, `math.js`, `dom.js` | bends and arcs, small numeric helpers, the SVG element helper |

`geometry.js`, `termini.js`, `timetable.js`, `math.js` and `follower()` in `live.js` never touch
the page, which is what lets `test/` run them under Node. Keep them that way.

**The Worker** (`worker/`) serves `public/` and the live trains
([diagram](docs/live-trains-architecture.svg)).

| | |
| --- | --- |
| `index.js` | the `/live` websocket, `/live/history`, and the hub: one Durable Object that listens to LA Metro's vehicle positions while anyone is watching and sends every visitor a snapshot each few seconds. Once a minute, watched or not, it stores a snapshot, and keeps 35 minutes of them |
| `adapt.js` | one vehicle of Metro's feed → a train of a line between two stations, using `metro.json` |

The page shows the timetable when there is neither a record nor a snapshot to go on, and again
whenever the snapshots stop. The record starts with the first visit after a deploy, so the very
first one gets no catch-up.

## Common changes

- **A new menu screen**: add it to `SCREENS` in `js/menu.js`, a `data-go` button in `#menu` and a
  `<section class="screen">` with the same id in `index.html`.
- **A job**: an entry in `JOBS` in `js/resume.js` (name, title, dates, skills, which of the
  `MAPS` it's on and where its pin goes) and its words under `jobs` in `js/lang.js`, in both
  languages.
- **Any wording**: `js/lang.js`, in both languages.
- **A new setting**: a default in `js/prefs.js`, a `data-pref` switch in `index.html` and its
  name in `js/lang.js`.
- **A line's colour**: `--line-<id>` in `styles.css` (falls back to the feed's colour).
- **A station in the wrong place**: `pins` / `nudges` in `data/overrides.json`, then `npm run build`.
- **Sizes and timings** are named constants at the top of the module that uses them.

## Credits

Data from LA Metro. Colorblind palette by Okabe & Ito. Inspired by Beck, Vignelli and Mini Metro.
