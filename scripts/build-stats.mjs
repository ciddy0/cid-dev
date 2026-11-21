// Turns the archive files in data/raw/archive/ into public/data/stats.json: for each day in Los
// Angeles, how many trains of each line were out in each hour (the median of its minutes). Needs
// the `duckdb` command.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ARCHIVE, STATS_JSON } from "./lib/paths.mjs";

const FRESH = 300;
const ZONE = "America/Los_Angeles";
const KM_PER_DEG = 111.32;
const NEAR = 0.15;

const files = fileURLToPath(new URL("*/*.parquet", ARCHIVE));
const query = (sql) =>
  JSON.parse(
    execFileSync("duckdb", ["-json", "-c", sql], {
      maxBuffer: 1 << 28,
    }).toString() || "[]",
  );

// Counts a train once that the feed names twice, by the rules of `unique` in worker/adapt.js.
const COUNTS = `
  WITH live AS (
    SELECT timezone('${ZONE}', timezone('UTC', sampled_at)) AS t, route_code AS route,
      vehicle_id AS id, reported_at, lat, lon, stop_sequence = 1 AS waiting,
      concat_ws(' ', route_code, direction_id, stop_id) AS bound
    FROM read_parquet('${files}')
    WHERE trip_id IS NOT NULL AND epoch(sampled_at - reported_at) <= ${FRESH}
  ), doubles AS (
    SELECT t, id FROM (
      SELECT t, id, row_number() OVER (
        PARTITION BY t, car ORDER BY waiting, reported_at DESC, id DESC) AS place
      FROM (SELECT *, unnest(string_split(id, '-')) AS car FROM live
        WHERE id LIKE '%-%')
    ) WHERE place > 1
    UNION
    SELECT a.t, a.id FROM live a JOIN live b USING (t, bound)
    WHERE NOT (a.waiting AND b.waiting) AND (a.id LIKE '%-%' OR b.id LIKE '%-%')
      AND (b.waiting, a.reported_at, a.id) < (a.waiting, b.reported_at, b.id)
      AND ${KM_PER_DEG} * sqrt(pow(a.lat - b.lat, 2)
        + pow((a.lon - b.lon) * cos(radians(a.lat)), 2)) < ${NEAR}
  ), trains AS (
    SELECT t, route, count(*) AS n
    FROM live ANTI JOIN doubles USING (t, id) GROUP BY 1, 2
  ), counts AS (
    SELECT t, route, coalesce(n, 0) AS n
    FROM (SELECT DISTINCT timezone('${ZONE}', timezone('UTC', sampled_at)) AS t
        FROM read_parquet('${files}'))
      CROSS JOIN (SELECT DISTINCT route FROM trains)
      LEFT JOIN trains USING (t, route)
  )`;

const hours = query(`${COUNTS}
  SELECT strftime(t, '%Y-%m-%d') AS date, hour(t) AS hour, route,
    quantile_disc(n, 0.5) AS trains
  FROM counts GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`);

const days = query(`${COUNTS}
  SELECT strftime(t, '%Y-%m-%d') AS date,
    count(DISTINCT date_trunc('minute', t)) AS minutes
  FROM counts GROUP BY 1 ORDER BY 1`);

for (const day of days) day.lines = {};
const byDate = new Map(days.map((day) => [day.date, day]));
for (const { date, hour, route, trains } of hours)
  (byDate.get(date).lines[route] ??= Array(24).fill(null))[hour] = trains;

await writeFile(STATS_JSON, JSON.stringify({ days }));
console.log(`${days.length} days, to ${days.at(-1)?.date}`);
