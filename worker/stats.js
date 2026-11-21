// The SQL behind the stats screen, one Los Angeles day at a time, in the subset Basin SQL runs
// (no UNNEST, PERCENTILE_DISC, time zones, ANTI JOIN or USING). scripts/build-stats.mjs runs the
// same text in DuckDB over the downloaded archive.

const ZONE = "America/Los_Angeles";
const DAY = 86400;
const FRESH = 300;
const KM_PER_DEG = 111.32;
const NEAR = 0.15;
const MAX_CARS = 6;
const LATE = 300;
const WAY_LATE = 600;
const RUNS_PAST_MIDNIGHT = 6 * 3600;
export const UNTIMED = ["801"];
export const TABLES = {
  positions: "metro.vehicle_positions",
  stopTimes: "metro.stop_times",
};

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});
function offset(at) {
  const p = Object.fromEntries(
    parts.formatToParts(new Date(at * 1000)).map((x) => [x.type, +x.value]),
  );
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - at
  );
}

export function day(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad date ${date}`);
  const midnight = Date.parse(`${date}T00:00:00Z`) / 1000;
  const start = midnight - offset(midnight);
  const end = midnight + DAY - offset(midnight + DAY);
  const before = offset(start);
  const after = offset(end - 1);
  let lo = start;
  let hi = end;
  if (before !== after)
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (offset(mid) === before) lo = mid;
      else hi = mid;
    }
  const noon = midnight + DAY / 2;
  return {
    date,
    midnight,
    start,
    end,
    before,
    after,
    turn: hi,
    service: noon - offset(noon) - DAY / 2,
  };
}

export const pick = (versions, date) =>
  versions
    .filter((v) => v <= date)
    .sort()
    .at(-1) ?? null;

const stamp = (at) => `'${new Date(at * 1000).toISOString().slice(0, 19)}Z'`;
const local = (d, at) =>
  d.before === d.after
    ? `${at} + ${d.before}`
    : `${at} + CASE WHEN ${at} < ${d.turn} THEN ${d.before} ELSE ${d.after} END`;
const same = (col) =>
  `(a.${col} = b.${col} OR (a.${col} IS NULL AND b.${col} IS NULL))`;
function quote(w) {
  if (!/^[\w-]+$/.test(w)) throw new Error(`bad name ${w}`);
  return `'${w}'`;
}

export function trainsSql(d, routes, table = TABLES.positions) {
  const cars = Array.from(
    { length: MAX_CARS },
    (_, i) =>
      `SELECT t, id, waiting, heard, split_part(id, '-', ${i + 1}) AS car FROM live WHERE id LIKE '%-%'`,
  ).join("\n    UNION ALL ");
  const lines = routes
    .map((r) => `SELECT ${quote(r)} AS route`)
    .join(" UNION ALL ");
  return `WITH seen AS (
  SELECT DISTINCT sampled_at AS t, date_part('epoch', sampled_at) AS secs, route_code AS route,
    vehicle_id AS id, trip_id, date_part('epoch', reported_at) AS heard, lat, lon,
    direction_id, stop_id, CASE WHEN stop_sequence = 1 THEN 1 ELSE 0 END AS waiting
  FROM ${table}
  WHERE sampled_at >= ${stamp(d.start)} AND sampled_at < ${stamp(d.end)}
), minutes AS (
  SELECT DISTINCT t, secs FROM seen
), live AS (
  SELECT * FROM seen WHERE trip_id IS NOT NULL AND secs - heard <= ${FRESH}
), cars AS (
  ${cars}
), doubles AS (
  SELECT t, id FROM (
    SELECT t, id, ROW_NUMBER() OVER (
      PARTITION BY t, car ORDER BY waiting, heard DESC, id DESC) AS place
    FROM cars WHERE car <> ''
  ) ranked WHERE place > 1
  UNION
  SELECT a.t, a.id FROM live a JOIN live b ON a.t = b.t
    AND ${same("route")} AND ${same("direction_id")} AND ${same("stop_id")}
  WHERE NOT (a.waiting = 1 AND b.waiting = 1)
    AND (a.id LIKE '%-%' OR b.id LIKE '%-%')
    AND (b.waiting < a.waiting OR (b.waiting = a.waiting AND (a.heard < b.heard
      OR (a.heard = b.heard AND a.id < b.id))))
    AND ${KM_PER_DEG} * sqrt(power(a.lat - b.lat, 2)
      + power((a.lon - b.lon) * cos(radians(a.lat)), 2)) < ${NEAR}
), trains AS (
  SELECT t, route, count(*) AS n FROM live l
  WHERE NOT EXISTS (SELECT 1 FROM doubles d WHERE d.t = l.t AND d.id = l.id)
  GROUP BY t, route
), counts AS (
  SELECT floor((${local(d, "m.secs")} - ${d.midnight}) / 3600) AS hour, r.route,
    coalesce(tr.n, 0) AS n
  FROM minutes m CROSS JOIN (${lines}) r
    LEFT JOIN trains tr ON tr.t = m.t AND tr.route = r.route
), ranked AS (
  SELECT hour, route, n,
    ROW_NUMBER() OVER (PARTITION BY hour, route ORDER BY n) AS place,
    count(*) OVER (PARTITION BY hour, route) AS size
  FROM counts
), totals AS (
  SELECT count(DISTINCT date_trunc('minute', t)) AS minutes,
    (SELECT max(length(id) - length(replace(id, '-', ''))) + 1 FROM live) AS cars
  FROM minutes
)
SELECT r.hour, r.route, r.n AS trains, s.minutes, s.cars
FROM ranked r CROSS JOIN totals s
WHERE r.place * 2 IN (r.size, r.size + 1)
ORDER BY r.hour, r.route
LIMIT ${routes.length * 24}`;
}

export function lateSql(d, routes, feeds, tables = TABLES) {
  const timed = routes.filter((r) => !UNTIMED.includes(r));
  return `WITH obs AS (
  SELECT route_code AS route, trip_id, stop_sequence AS seq,
    CASE WHEN status = 'STOPPED_AT' THEN stop_sequence ELSE stop_sequence - 1 END AS passed,
    date_part('epoch', reported_at) AS heard
  FROM ${tables.positions}
  WHERE sampled_at >= ${stamp(d.start)}
    AND sampled_at < ${stamp(d.end + RUNS_PAST_MIDNIGHT)}
    AND start_date = '${d.date.replaceAll("-", "")}' AND trip_id IS NOT NULL
    AND route_code IN (${timed.map(quote).join(", ")})
), runs AS (
  SELECT route, trip_id, min(seq) AS first_seq FROM obs GROUP BY route, trip_id
), levels AS (
  SELECT route, trip_id, passed, min(heard) AS reached FROM obs GROUP BY route, trip_id, passed
), timetable AS (
  SELECT trip_id, stop_sequence AS seq, arrival FROM ${tables.stopTimes}
  WHERE (network = 'rail' AND feed = ${quote(feeds.rail)})
    OR (network = 'bus' AND feed = ${quote(feeds.bus)})
), arrivals AS (
  SELECT r.route, min(l.reached) - (${d.service} + s.arrival) AS late
  FROM runs r JOIN timetable s ON s.trip_id = r.trip_id AND s.seq > r.first_seq AND s.seq > 1
    JOIN levels l ON l.route = r.route AND l.trip_id = r.trip_id AND l.passed >= s.seq
  GROUP BY r.route, r.trip_id, s.seq, s.arrival
)
SELECT route, count(*) AS arrivals,
  sum(CASE WHEN late >= ${LATE} THEN 1 ELSE 0 END) AS late,
  sum(CASE WHEN late >= ${WAY_LATE} THEN 1 ELSE 0 END) AS way_late
FROM arrivals GROUP BY route ORDER BY route
LIMIT 50`;
}

export function hours(d, rows) {
  const cars = Math.max(0, ...rows.map((r) => Number(r.cars)));
  if (cars > MAX_CARS)
    throw new Error(`${d.date}: a train of ${cars} cars, over ${MAX_CARS}`);
  const lines = {};
  for (const { hour, route, trains } of rows)
    (lines[route] ??= Array(24).fill(null))[Number(hour)] = Number(trains);
  return { date: d.date, minutes: Number(rows[0]?.minutes ?? 0), lines };
}

export const lateness = (rows) =>
  Object.fromEntries(
    rows.map((r) => [
      r.route,
      {
        arrivals: Number(r.arrivals),
        late: Number(r.late),
        off: 2 * Number(r.way_late) > Number(r.arrivals),
      },
    ]),
  );
