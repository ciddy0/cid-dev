// Turns the raw GTFS in data/raw/ into public/data/metro.json — the small file the map loads.
// Run scripts/fetch-gtfs.mjs first. The schematic layout comes from lib/schematize.mjs, steered
// by the hand-edited data/overrides.json.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseCSV } from "./lib/csv.mjs";
import { buildNetwork } from "./lib/network.mjs";
import { MAP_JSON, OVERRIDES, RAW, RAW_BUS, SOURCE_STAMP } from "./lib/paths.mjs";
import { schematize } from "./lib/schematize.mjs";

const FEEDS = { feed: "https://gitlab.com/LACMTA/gtfs_rail", busFeed: "https://gitlab.com/LACMTA/gtfs_bus" };

// A rail table, with the busway rows from data/raw/bus/ (if fetched) appended.
const table = async (name) => {
  const rail = parseCSV(await readFile(new URL(name, RAW), "utf8"));
  const bus = parseCSV(await readFile(new URL(name, RAW_BUS), "utf8").catch(() => ""));
  return [...rail, ...bus.map((row) => ({ ...row, bus: true }))];
};
const json = async (url) => JSON.parse(await readFile(url, "utf8").catch(() => "{}"));

const [routes, trips, stops, stopTimes] = await Promise.all(
  ["routes.txt", "trips.txt", "stops.txt", "stop_times.txt"].map(table),
);
const { lines, stations, platforms, projection } = buildNetwork({ routes, trips, stops, stopTimes });
const schematic = schematize(lines, stations, await json(OVERRIDES));

const deg = (n) => Math.round(n * 1e6) / 1e6;
const out = {
  source: { ...FEEDS, ...(await json(SOURCE_STAMP)), built_at: new Date().toISOString() },
  projection: { lat0: deg(projection.lat0), lon0: deg(projection.lon0), units: "km" },
  layout: schematic.layout,
  lines: schematic.lines,
  stations: schematic.stations,
  platforms,
};
const text = JSON.stringify(out);
await mkdir(new URL(".", MAP_JSON), { recursive: true });
await writeFile(MAP_JSON, text + "\n");

// --- report
const pad = (v, n) => String(v).padStart(n);
for (const l of lines) {
  const ends = `${stations[l.stations[0]].name} → ${stations[l.stations.at(-1)].name}`;
  for (const p of l.extraPaths) console.log(`   ${l.id} extra path: ${p.map((s) => stations[s].name).join(" → ")}`);
  console.log(`${l.id}  ${pad(l.stations.length, 2)} stations  ${pad(Math.round(l.times.at(-1) / 60), 3)} min  ${pad(l.trainsPerHour, 4)}/hr  ${ends}`);
}
console.log(`${Object.keys(stations).length} stations, ${Object.values(stations).filter((s) => s.transfer).length} transfers, ${(text.length / 1024).toFixed(1)} KB`);
console.log(`layout: ${schematic.summary}`);
for (const p of schematic.problems) console.warn(`  ! ${p}`);
if (!schematic.problems.length) console.log("layout checks passed: every segment octilinear, every stop on its path, no stations too close");
