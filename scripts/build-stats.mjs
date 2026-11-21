// Turns the archive files in data/raw/archive/ into public/data/stats.json by running the SQL of
// worker/stats.js in DuckDB, one LA day at a time. Late arrivals need the day's timetables in
// data/raw/timetables/{rail,bus}/<published>/stop_times.txt. Needs the `duckdb` command.
import { execFileSync } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import map from "../public/data/metro.json" with { type: "json" };
import { ARCHIVE, STATS_JSON, TIMETABLES } from "./lib/paths.mjs";
import {
  day,
  hours,
  lateSql,
  lateness,
  pick,
  trainsSql,
} from "../worker/stats.js";

const path = (url) => fileURLToPath(url);
const versions = async (system) =>
  (await readdir(new URL(`${system}/`, TIMETABLES)).catch(() => [])).sort();
const rail = await versions("rail");
const bus = await versions("bus");

const setup = `
  CREATE SCHEMA metro;
  CREATE VIEW metro.vehicle_positions AS
    SELECT * FROM read_parquet('${path(new URL("*/*.parquet", ARCHIVE))}', hive_partitioning = false);
  ${
    rail.length && bus.length
      ? `CREATE VIEW metro.stop_times AS
    SELECT regexp_extract(filename, 'timetables/(rail|bus)/', 1) AS network,
      regexp_extract(filename, '/(\\d{4}-\\d{2}-\\d{2})/', 1) AS feed, trip_id,
      stop_sequence::INT AS stop_sequence,
      split_part(arrival_time, ':', 1)::INT * 3600 + split_part(arrival_time, ':', 2)::INT * 60
        + split_part(arrival_time, ':', 3)::INT AS arrival
    FROM read_csv('${path(new URL("*/*/stop_times.txt", TIMETABLES))}',
      filename = true, all_varchar = true, union_by_name = true);`
      : ""
  }`;
const query = (sql) =>
  JSON.parse(
    execFileSync("duckdb", ["-json", "-c", `${setup}\n${sql}`], {
      maxBuffer: 1 << 28,
    }).toString() || "[]",
  );

const routes = map.lines.map((line) => line.route).sort();
const dates = query(`SELECT DISTINCT strftime(timezone('America/Los_Angeles',
    timezone('UTC', sampled_at)), '%Y-%m-%d') AS date
  FROM metro.vehicle_positions ORDER BY 1`).map((r) => r.date);

const days = [];
for (const date of dates) {
  const d = day(date);
  const stats = hours(d, query(trainsSql(d, routes)));
  const feeds = { rail: pick(rail, date), bus: pick(bus, date) };
  if (feeds.rail && feeds.bus)
    stats.late = lateness(query(lateSql(d, routes, feeds)));
  else console.log(`${date}: no timetable, so no late arrivals`);
  days.push(stats);
}

await writeFile(STATS_JSON, JSON.stringify({ days }));
console.log(`${days.length} days, to ${days.at(-1)?.date}`);
