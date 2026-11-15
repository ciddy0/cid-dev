# cid.dev

My site. It's a map of the LA Metro rail network with the trains where Metro says they are
right now, and the menu, my resume and the settings all live on top of it. Mostly I just wanted
something nice to look at.

It's plain HTML, SVG and JavaScript, plus one small Cloudflare Worker for the live trains, which
also [keeps a record](#the-archive) of what Metro's feed says. No framework, no build step for
the site, and one dependency, the Parquet writer in the Worker. What's left to do is in
[TO-DO.md](TO-DO.md).

Not affiliated with LA Metro. Please don't plan a trip with it.

## Commands

|                  |                                                                             |
| ---------------- | --------------------------------------------------------------------------- |
| `npm run dev`    | serve `public/` and the Worker locally (wrangler); the live trains are real |
| `npm install`    | the one dependency (`hyparquet-writer`), which the Worker and one test need |
| `npm test`       | unit tests (`node --test`)                                                  |
| `npm run fetch`  | download the GTFS feeds into `data/raw/` (not committed)                    |
| `npm run build`  | `data/raw/` + `data/overrides.json` → `public/data/metro.json`              |
| `npm run deploy` | publish `public/` and the Worker to cid.dev                                 |

Needs Node 22 or newer. The page itself only needs `public/` served by anything static: without
the Worker its trains follow the timetable.

## How it fits together

```
GTFS feeds ──fetch──▶ data/raw/ ──build──▶ public/data/metro.json ──▶ the page
                        data/overrides.json ──┘                    └──▶ the Worker ──/live──▶ the page
                                                                            └──every 6 h──▶ R2, as Parquet
```

**The data pipeline** (`scripts/`) runs by hand, when the feed or the layout changes, and its
output is committed.

|                                               |                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `fetch-gtfs.mjs`                              | command: downloads the rail feed, and the G Line's rows of the bus feed                                  |
| `build-map.mjs`                               | command: reads the tables, builds, lays out, writes `metro.json`, reports                                |
| `lib/network.mjs`                             | GTFS tables → lines and stations, geographic                                                             |
| `lib/schematize.mjs`                          | geographic → schematic: the layout, steered by `data/overrides.json` (documented at the top of the file) |
| `lib/csv.mjs`, `lib/vec.mjs`, `lib/paths.mjs` | CSV parser, vector maths, where files live                                                               |

`build-map` prints layout problems (stations too close, a stop off its path, an override that
matches nothing); fix those in `data/overrides.json`, not in `metro.json`.

**The page** (`public/`) is `index.html`, `styles.css` and the modules in `js/`. `main.js` wires
them up, roughly in this order:

|                                    |                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `network.js`                       | loads `metro.json`; line colours                                                                                                                                                                                   |
| `draw.js`                          | draws the coastline, lines, termini (`termini.js`) and stations into the `<svg>`; returns the tracks, stations and bounds everything else works from                                                               |
| `camera.js`                        | the viewBox: drag, pinch, wheel, glides                                                                                                                                                                            |
| `label.js`                         | the station name label and halo                                                                                                                                                                                    |
| `trains.js`                        | puts a car wherever a feed says a train is, riding the tracks (`rail.js`)                                                                                                                                          |
| `live.js`                          | the live feed: the last hour run through in half a minute as the view opens, every car stopping at its stations to let passengers off and on, then the socket to `/live`, cars eased from one snapshot to the next |
| `timetable.js`                     | the fallback feed: where every train is, worked out from the timetable                                                                                                                                             |
| `menu.js`                          | the menu and the screens it flies to (map, resume, about, settings); starts and stops the trains                                                                                                                   |
| `intro.js`                         | the lines drawing themselves in as the page opens                                                                                                                                                                  |
| `resume.js`                        | the resume screen: the jobs as stops along a line, the picked one a card on it with a little map of where the job was                                                                                              |
| `settings.js`, `prefs.js`          | the settings (language, night mode, colorblind mode, coastline, motion, sound, volume), stored in `localStorage`                                                                                                   |
| `lang.js`                          | every word on the page, in English and Spanish                                                                                                                                                                     |
| `sound.js`                         | the synthesized piano: a note as a train arrives on screen, menu figures, the hum                                                                                                                                  |
| `geometry.js`, `math.js`, `dom.js` | bends and arcs, small numeric helpers, the SVG element helper                                                                                                                                                      |

`geometry.js`, `termini.js`, `timetable.js`, `math.js` and `follower()` in `live.js` never touch
the page, which is what lets `test/` run them under Node. Keep them that way.

**The Worker** (`worker/`) serves `public/` and the live trains
([diagram](docs/live-trains-architecture.svg)).

|              |                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.js`   | the `/live` websocket, `/live/history`, and the hub: one Durable Object that listens to LA Metro's vehicle positions while anyone is watching and sends every visitor a snapshot each few seconds. Once a minute, watched or not, it stores a snapshot, and keeps 65 minutes of them. The same minute it notes what the feed said about every vehicle, and every six hours writes those notes to R2 as one file |
| `adapt.js`   | one vehicle of Metro's feed → a train of a line between two stations, using `metro.json`                                                                                                                                                                                                                                                                                                                        |
| `archive.js` | the archive, less the bucket: one vehicle of the feed → a flat row, which six hours a time falls in and the file they are kept as, rows → Parquet                                                                                                                                                                                                                                                               |

The page shows the timetable when there is neither a record nor a snapshot to go on, and again
whenever the snapshots stop. The record starts with the first visit after a deploy, so the very
first one gets no catch-up.

`adapt.js` and `archive.js` never touch the network or the bucket, so `test/` runs them too.

## The archive

Since 14 November 2026 the hub keeps everything Metro's feed says: every vehicle, once a minute,
round the clock. Nothing reads it yet. It is there for a weekly page of numbers (how many stops
each train made, how often trains ran late) that isn't built.

- **Where**: the R2 bucket `cid-dev-metro`, bound as `ARCHIVE` in `wrangler.jsonc`. One file for
  every six hours by UTC: `vehicle_positions/date=2026-11-14/18.parquet` is 18:00 to 23:59. The
  bucket has to exist before a deploy (`npx wrangler r2 bucket create cid-dev-metro`).
- **What**: a row per vehicle per sample, the feed's own fields and nothing worked out from them:
  `sampled_at`, `vehicle_id`, `route_code`, `trip_id`, `start_date`, `start_time`,
  `direction_id`, `stop_id`, `stop_sequence`, `status`, `reported_at`, `lat`, `lon`. A parked
  vehicle has no trip, and is nulls but for where it is.
- **How**: each minute's sample waits in the hub's SQLite (the `samples` table). The first alarm
  after six hours are over writes their file and only then deletes their samples, so a write that
  fails is tried again a minute later, under the same name.
- **How long**: for ever; nothing deletes a file. Going by the first one, a full file is about
  1 MB, so 4 MB a day and 1.5 GB a year, of the 10 GB R2 gives away.
- **How exact**: with nobody watching, the hub listens to Metro for 8 seconds of each minute, so
  when a train reached a stop is known to the minute, not the second.

To look at it, download the files and ask DuckDB (`brew install duckdb`). `data/raw/` isn't
committed, so they can live there:

```sh
for day in 2026-11-15 2026-11-16; do for hour in 00 06 12 18; do
  npx wrangler r2 object get "cid-dev-metro/vehicle_positions/date=$day/$hour.parquet" \
    --remote --file "data/raw/archive/date=$day/$hour.parquet"
done; done
find data/raw/archive -size 0 -delete # a file not in the bucket yet is left behind empty

duckdb -c "SELECT * FROM 'data/raw/archive/*/*.parquet' WHERE trip_id IS NOT NULL LIMIT 10"
```

### Check-up, due around 18 November 2026

A few days of files are enough to see whether the archive is sound and what the numbers can be
built on. Download every file so far (the loop above; the first is
`date=2026-11-14/18.parquet`, and is only 13 minutes long), then, in `duckdb`:

```sql
CREATE VIEW archive AS
  SELECT * FROM read_parquet('data/raw/archive/*/*.parquet', filename = true);
```

1. **Is every file there, and full?** Four a day, about 360 samples each. A missing file means a
   flush kept failing: `npx wrangler tail` around 00:00, 06:00, 12:00 or 18:00 UTC shows why, as
   a line starting `archive:`.

   ```sql
   SELECT filename, count(DISTINCT sampled_at) AS samples, count(*) AS rows
   FROM archive GROUP BY 1 ORDER BY 1;
   ```

2. **Are there holes?** Every minute Metro didn't answer in time is one. A few are fine; a
   pattern (the same hour every night, say) is worth knowing before counting anything.

   ```sql
   SELECT sampled_at, gap FROM (
     SELECT sampled_at, sampled_at - lag(sampled_at) OVER (ORDER BY sampled_at) AS gap
     FROM (SELECT DISTINCT sampled_at FROM archive)
   ) WHERE gap > INTERVAL 90 SECOND ORDER BY 1;
   ```

3. **How big is a full file?** `ls -l data/raw/archive/*/`, and put the real figure under _How
   long_ above.

4. **How do stops show up, a sample a minute?** `step` is how many stops a train moved on
   between two samples: 0 and 1 are easy to count, 2 or more is a stop it was never seen at. In
   the first 13 minutes that was 3 times in 934. If it stays that rare, stops can be counted off
   `stop_sequence` alone.

   ```sql
   SELECT step, count(*) AS times FROM (
     SELECT stop_sequence - lag(stop_sequence) OVER (
       PARTITION BY start_date, trip_id, vehicle_id ORDER BY sampled_at) AS step
     FROM archive WHERE trip_id IS NOT NULL
   ) WHERE step IS NOT NULL GROUP BY 1 ORDER BY 1;
   ```

5. **Do the trips match the timetable?** Running late is measured against `stop_times.txt`, by
   `trip_id`, and Metro publishes a new one most nights (about 01:30 in Los Angeles). On the
   first day all 79 rail trips were in that day's timetable and only 37 in a copy four days old,
   so each day has to be checked against the timetable of that day. `npm run fetch` gets
   today's; older ones are in the history of gitlab.com/LACMTA/gtfs_rail. Decide here whether
   the numbers fetch them from there or the hub starts keeping a copy. (The G Line, route 901,
   is in the bus feed, `data/raw/bus/`.)

   ```sql
   SELECT a.start_date, count(*) AS trips, count(s.trip_id) AS in_timetable
   FROM (SELECT DISTINCT start_date, trip_id FROM archive
         WHERE trip_id IS NOT NULL AND route_code <> '901') a
   LEFT JOIN (SELECT DISTINCT trip_id
              FROM read_csv('data/raw/stop_times.txt', types = {'trip_id': 'VARCHAR'})) s
     USING (trip_id)
   GROUP BY 1 ORDER BY 1;
   ```

6. **What does it cost?** In the Cloudflare dashboard: the Durable Object's duration and rows
   written, and R2's storage and operations, against the free allowances.

Then the numbers themselves: see [TO-DO.md](TO-DO.md).

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
