// Turns the raw GTFS in data/raw/ into public/data/metro.json — the small file the map loads.
// Run scripts/fetch-gtfs.mjs first.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const RAW = new URL("../data/raw/", import.meta.url);
const OUT = new URL("../public/data/metro.json", import.meta.url);

// Minimal CSV parser: handles quoted fields, BOM, and CRLF.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const load = async (name) => parseCSV(await readFile(new URL(name, RAW), "utf8"));
const [routes, trips, stops, stopTimes, shapePts] = await Promise.all(
  ["routes.txt", "trips.txt", "stops.txt", "stop_times.txt", "shapes.txt"].map(load),
);
const source = JSON.parse(await readFile(new URL("_source.json", RAW), "utf8").catch(() => "{}"));

const toSec = (t) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + s; };

// --- index the raw tables
const stopById = new Map(stops.map((s) => [s.stop_id, s]));
const stationOf = (stopId) => stopById.get(stopId)?.parent_station || stopId;

const timesByTrip = new Map();
for (const st of stopTimes) {
  if (!timesByTrip.has(st.trip_id)) timesByTrip.set(st.trip_id, []);
  timesByTrip.get(st.trip_id).push(st);
}
for (const list of timesByTrip.values()) list.sort((a, b) => a.stop_sequence - b.stop_sequence);

const shapeById = new Map();
for (const p of shapePts) {
  if (!shapeById.has(p.shape_id)) shapeById.set(p.shape_id, []);
  shapeById.get(p.shape_id).push(p);
}
for (const list of shapeById.values()) list.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);

// --- projection: equirectangular around the network's center, in km (x east, y south)
const parents = stops.filter((s) => s.location_type === "1");
const lat0 = parents.reduce((a, s) => a + +s.stop_lat, 0) / parents.length;
const lon0 = parents.reduce((a, s) => a + +s.stop_lon, 0) / parents.length;
const KM_PER_DEG = 111.32;
const round = (n) => Math.round(n * 100) / 100; // 10 m precision
const project = (lat, lon) => [
  round((lon - lon0) * KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180)),
  round(-(lat - lat0) * KM_PER_DEG),
];

// Douglas–Peucker, to keep shapes small. Tolerance in km.
function simplify(pts, tol = 0.03) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts.at(-1);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [pts[0], pts.at(-1)];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

// --- build each line
const stations = {};
const lines = [];

for (const route of routes) {
  const id = route.route_long_name.match(/Metro (\w) Line/)?.[1] ?? route.route_id;
  const routeTrips = trips.filter((t) => t.route_id === route.route_id);

  // Representative trip per direction: the one that serves the most stations (skips short-turns).
  const longest = (dir) => routeTrips.filter((t) => t.direction_id === dir).reduce((best, t) =>
    (timesByTrip.get(t.trip_id)?.length ?? 0) > (timesByTrip.get(best.trip_id)?.length ?? 0) ? t : best);
  const dir0 = routeTrips.filter((t) => t.direction_id === "0");
  const rep = longest("0");

  const stationPath = (trip) => {
    const path = [];
    for (const st of timesByTrip.get(trip.trip_id)) {
      const sid = stationOf(st.stop_id);
      if (path.at(-1)?.sid === sid) continue;
      path.push({ sid, stop: st });
      if (!stations[sid]) {
        const s = stopById.get(sid) ?? stopById.get(st.stop_id);
        const [x, y] = project(+s.stop_lat, +s.stop_lon);
        stations[sid] = { name: s.stop_name.replace(/ Station$/, ""), x, y, lines: [] };
      }
      if (!stations[sid].lines.includes(id)) stations[sid].lines.push(id);
    }
    return path;
  };

  const main = stationPath(rep);
  const start = toSec(main[0].stop.departure_time);
  const stationIds = main.map((p) => p.sid);
  const times = main.map((p) => toSec(p.stop.arrival_time) - start);

  // Stations only served in the other direction (e.g. the A Line's one-way loop in Long Beach)
  // become extra paths, each anchored to main-line stations at both ends.
  const onMain = new Set(stationIds);
  const back = stationPath(longest("1")).map((p) => p.sid).reverse();
  const extraPaths = [];
  for (let i = 1; i < back.length; i++) {
    if (onMain.has(back[i])) continue;
    let j = i;
    while (j < back.length && !onMain.has(back[j])) j++;
    extraPaths.push(back.slice(i - 1, j + 1));
    i = j;
  }

  // Rough daytime frequency: busiest service day, direction 0, departures 08:00–20:00.
  const byService = Map.groupBy(dir0, (t) => t.service_id);
  const busiest = [...byService.values()].reduce((a, b) => (b.length > a.length ? b : a));
  const daytime = busiest.filter((t) => {
    const dep = toSec(timesByTrip.get(t.trip_id)?.[0]?.departure_time ?? "0:0:0");
    return dep >= 8 * 3600 && dep < 20 * 3600;
  }).length;

  const shape = simplify((shapeById.get(rep.shape_id) ?? []).map((p) => project(+p.shape_pt_lat, +p.shape_pt_lon)));

  lines.push({
    id,
    name: route.route_long_name.replace(/^Metro /, ""),
    color: `#${route.route_color}`,
    textColor: `#${route.route_text_color}`,
    stations: stationIds,
    times,
    extraPaths,
    trainsPerHour: round(daytime / 12),
    shape,
  });
}

lines.sort((a, b) => a.id.localeCompare(b.id));

// Some transfers are two GTFS stations side by side (e.g. "Expo / Crenshaw E-Line" and
// "Expo / Crenshaw K-Line"). Merge stations with the same base name within 200 m.
const baseName = (n) => n.replace(/ [A-Z]-Line$/, "");
const ids = Object.keys(stations);
for (const a of ids) {
  for (const b of ids) {
    if (a >= b || !stations[a] || !stations[b]) continue;
    const sa = stations[a], sb = stations[b];
    if (baseName(sa.name) !== baseName(sb.name) || Math.hypot(sa.x - sb.x, sa.y - sb.y) > 0.2) continue;
    sa.name = baseName(sa.name);
    sa.x = round((sa.x + sb.x) / 2);
    sa.y = round((sa.y + sb.y) / 2);
    sa.lines = [...new Set([...sa.lines, ...sb.lines])];
    delete stations[b];
    const swap = (list) => list.map((s) => (s === b ? a : s));
    for (const l of lines) {
      l.stations = swap(l.stations);
      l.extraPaths = l.extraPaths.map(swap);
    }
  }
}

for (const s of Object.values(stations)) {
  s.lines.sort();
  s.transfer = s.lines.length > 1;
}

const out = {
  source: { feed: "https://gitlab.com/LACMTA/gtfs_rail", ...source, built_at: new Date().toISOString() },
  projection: { lat0: round(lat0 * 1e4) / 1e4, lon0: round(lon0 * 1e4) / 1e4, units: "km" },
  lines,
  stations,
};

await mkdir(new URL(".", OUT), { recursive: true });
const json = JSON.stringify(out);
await writeFile(OUT, json + "\n");

for (const l of lines) {
  const ends = `${stations[l.stations[0]].name} → ${stations[l.stations.at(-1)].name}`;
  for (const p of l.extraPaths) console.log(`   ${l.id} extra path: ${p.map((s) => stations[s].name).join(" → ")}`);
  console.log(`${l.id}  ${String(l.stations.length).padStart(2)} stations  ${String(Math.round(l.times.at(-1) / 60)).padStart(3)} min  ${String(l.trainsPerHour).padStart(4)}/hr  ${String(l.shape.length).padStart(3)} pts  ${ends}`);
}
console.log(`${Object.keys(stations).length} stations, ${Object.values(stations).filter((s) => s.transfer).length} transfers, ${(json.length / 1024).toFixed(1)} KB`);
