// Posts history to a lake stream's HTTP endpoint, for what the Worker doesn't send itself.
//   PIPELINES_TOKEN=... node scripts/lake-load.mjs <endpoint> positions <before, ISO>
//   PIPELINES_TOKEN=... node scripts/lake-load.mjs <endpoint> stop_times <rail|bus> <published>
// positions: every archive row sampled before the first one the hub streamed.
// stop_times: data/raw/timetables/<network>/<published>/stop_times.txt.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { batches, stopTimes } from "../worker/lake.js";
import { ARCHIVE, TIMETABLES } from "./lib/paths.mjs";
import { fileURLToPath } from "node:url";

const [endpoint, kind, a, b] = process.argv.slice(2);
const token = process.env.PIPELINES_TOKEN;
if (!endpoint || !token || !["positions", "stop_times"].includes(kind))
  throw new Error("usage: see the top of scripts/lake-load.mjs");

let rows;
if (kind === "positions") {
  const before = new Date(a);
  if (isNaN(before)) throw new Error(`bad time ${a}`);
  rows = JSON.parse(
    execFileSync(
      "duckdb",
      [
        "-json",
        "-c",
        `SELECT strftime(sampled_at, '%Y-%m-%dT%H:%M:%SZ') AS sampled_at, vehicle_id,
          route_code, trip_id, start_date, start_time, direction_id, stop_id, stop_sequence,
          status, strftime(reported_at, '%Y-%m-%dT%H:%M:%SZ') AS reported_at, lat, lon
        FROM read_parquet('${fileURLToPath(new URL("*/*.parquet", ARCHIVE))}',
          hive_partitioning = false)
        WHERE sampled_at < '${before.toISOString().slice(0, 19)}'
        ORDER BY sampled_at, vehicle_id`,
      ],
      { maxBuffer: 1 << 30 },
    ),
  );
} else {
  if (!/^(rail|bus)$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b))
    throw new Error(`bad timetable ${a} ${b}`);
  rows = stopTimes(
    await readFile(new URL(`${a}/${b}/stop_times.txt`, TIMETABLES), "utf8"),
    a,
    b,
  );
}

let sent = 0;
for (const batch of batches(rows)) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(batch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  sent += batch.length;
}
console.log(`${sent} rows sent`);
