// Downloads LA Metro's rail GTFS feed into data/raw/.
// Source: https://gitlab.com/LACMTA/gtfs_rail
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://gitlab.com/LACMTA/gtfs_rail/-/raw/master";
const FILES = ["feed_info.txt", "routes.txt", "trips.txt", "stops.txt", "stop_times.txt", "shapes.txt"];
const OUT = new URL("../data/raw/", import.meta.url);

await mkdir(OUT, { recursive: true });

for (const name of FILES) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(new URL(name, OUT), text);
  console.log(`${name.padEnd(16)} ${(text.length / 1024).toFixed(0).padStart(6)} KB`);
}

// Stamp which commit of the feed we pulled, so stale data is easy to spot.
const repo = await fetch("https://gitlab.com/api/v4/projects/LACMTA%2Fgtfs_rail/repository/commits/master").then((r) => r.json());
const stamp = { fetched_at: new Date().toISOString(), commit: repo.id, committed_at: repo.committed_date };
await writeFile(new URL("_source.json", OUT), JSON.stringify(stamp, null, 2) + "\n");
console.log(`feed commit ${repo.id.slice(0, 8)} (${repo.committed_date})`);
