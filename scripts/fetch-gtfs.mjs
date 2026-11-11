// Downloads LA Metro's rail GTFS feed into data/raw/, plus the busway lines drawn on the map
// (cut out of the much larger bus feed) into data/raw/bus/.
// Sources: https://gitlab.com/LACMTA/gtfs_rail, https://gitlab.com/LACMTA/gtfs_bus
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { RAW, RAW_BUS, SOURCE_STAMP } from "./lib/paths.mjs";

const BASE = "https://gitlab.com/LACMTA/gtfs_rail/-/raw/master";
const FILES = ["feed_info.txt", "routes.txt", "trips.txt", "stops.txt", "stop_times.txt", "shapes.txt"];

await mkdir(RAW, { recursive: true });

for (const name of FILES) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(new URL(name, RAW), text);
  console.log(`${name.padEnd(16)} ${(text.length / 1024).toFixed(0).padStart(6)} KB`);
}

// --- busways: the bus feed only ships as one zip (stop_times.txt is ~300 MB unpacked), so stream
// each table out of it with the system `unzip` and keep just the rows for these lines.
const BUS_ZIP = "https://gitlab.com/LACMTA/gtfs_bus/-/raw/master/gtfs_bus.zip";
const BUS_LINES = /Metro (G) Line/; // matched against route_long_name

await mkdir(RAW_BUS, { recursive: true });
const zip = fileURLToPath(new URL("gtfs_bus.zip", RAW_BUS));
const res = await fetch(BUS_ZIP);
if (!res.ok) throw new Error(`gtfs_bus.zip: HTTP ${res.status}`);
await writeFile(zip, Buffer.from(await res.arrayBuffer()));

// Copies the header and every row that `keep` accepts; returns the values of `column` it kept.
// Splitting on commas is enough here: none of the columns we read sit after a quoted field.
async function extract(name, keep, column) {
  const unzip = spawn("unzip", ["-p", zip, name], { stdio: ["ignore", "pipe", "inherit"] });
  const out = createWriteStream(new URL(name, RAW_BUS));
  const kept = new Set();
  let header, rows = 0;
  for await (const line of createInterface({ input: unzip.stdout })) {
    const cells = line.replace(/^\uFEFF/, "").split(",");
    if (!header) header = cells;
    else if (!keep(Object.fromEntries(header.map((h, i) => [h, cells[i]])))) continue;
    else { kept.add(cells[header.indexOf(column)]); rows++; }
    out.write(line + "\n");
  }
  await new Promise((done) => out.end(done));
  console.log(`bus/${name.padEnd(12)} ${String(rows).padStart(6)} rows`);
  return kept;
}

const busRoutes = await extract("routes.txt", (r) => BUS_LINES.test(r.route_long_name), "route_id");
const busTrips = await extract("trips.txt", (t) => busRoutes.has(t.route_id), "trip_id");
const busStops = await extract("stop_times.txt", (st) => busTrips.has(st.trip_id), "stop_id");
await extract("stops.txt", (s) => busStops.has(s.stop_id), "stop_id");
await rm(zip);

// Stamp which commit of each feed we pulled, so stale data is easy to spot.
const head = async (project) => {
  const c = await fetch(`https://gitlab.com/api/v4/projects/LACMTA%2F${project}/repository/commits/master`).then((r) => r.json());
  console.log(`${project} commit ${c.id.slice(0, 8)} (${c.committed_date})`);
  return { commit: c.id, committed_at: c.committed_date };
};
const stamp = { fetched_at: new Date().toISOString(), ...(await head("gtfs_rail")), bus: await head("gtfs_bus") };
await writeFile(SOURCE_STAMP, JSON.stringify(stamp, null, 2) + "\n");
