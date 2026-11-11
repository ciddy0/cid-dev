// Turns GTFS tables into the geographic network: lines with their stations in order, and
// stations with a position in km. schematize.mjs then straightens it out.

const KM_PER_DEG = 111.32;
const MERGE_WITHIN_KM = 0.2; // same-named stations this close together are one station
const DAYTIME = [8 * 3600, 20 * 3600]; // the hours a line's frequency is measured over

const round = (n) => Math.round(n * 100) / 100; // 10 m precision
const toSec = (t) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + s; };

// Equirectangular projection around the network's centre, in km (x east, y south).
function projection(stops) {
  const parents = stops.filter((s) => s.location_type === "1");
  const lat0 = parents.reduce((a, s) => a + +s.stop_lat, 0) / parents.length;
  const lon0 = parents.reduce((a, s) => a + +s.stop_lon, 0) / parents.length;
  const project = (lat, lon) => [
    round((lon - lon0) * KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180)),
    round(-(lat - lat0) * KM_PER_DEG),
  ];
  return { lat0, lon0, project };
}

// stop id → the id of the station it is a platform of.
function stationFinder(stops, stopById) {
  // A busway station is a stop per direction with the same name and no parent; the first one
  // stands in for the station.
  const busStation = new Map();
  for (const s of stops) if (s.bus && !busStation.has(s.stop_name)) busStation.set(s.stop_name, s.stop_id);
  return (stopId) => {
    const s = stopById.get(stopId);
    return s?.parent_station || (s?.bus && busStation.get(s.stop_name)) || stopId;
  };
}

// trip id → its stop_times rows, in order.
function timesByTrip(stopTimes) {
  const byTrip = new Map();
  for (const st of stopTimes) {
    if (!byTrip.has(st.trip_id)) byTrip.set(st.trip_id, []);
    byTrip.get(st.trip_id).push(st);
  }
  for (const list of byTrip.values()) list.sort((a, b) => a.stop_sequence - b.stop_sequence);
  return byTrip;
}

// Some transfers are two GTFS stations side by side (e.g. "Expo / Crenshaw E-Line" and
// "Expo / Crenshaw K-Line"). Merge stations with the same base name within MERGE_WITHIN_KM.
function mergeTwins(lines, stations) {
  const baseName = (n) => n.replace(/ [A-Z]-Line$/, "");
  const ids = Object.keys(stations);
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b || !stations[a] || !stations[b]) continue;
      const sa = stations[a], sb = stations[b];
      if (baseName(sa.name) !== baseName(sb.name) || Math.hypot(sa.x - sb.x, sa.y - sb.y) > MERGE_WITHIN_KM) continue;
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
}

// `tables` are the parsed GTFS files: { routes, trips, stops, stopTimes }. Returns
//   lines       [{ id, name, color, textColor, stations, times, extraPaths, trainsPerHour }],
//               `stations` being station ids end to end, `times` the seconds from the first to
//               each, and `extraPaths` runs of station ids only served in the other direction
//   stations    id → { name, x, y, lines, transfer }, x and y in km
//   projection  { lat0, lon0 }, the centre x and y are measured from
export function buildNetwork({ routes, trips, stops, stopTimes }) {
  const stopById = new Map(stops.map((s) => [s.stop_id, s]));
  const stationOf = stationFinder(stops, stopById);
  const tripTimes = timesByTrip(stopTimes);
  const { lat0, lon0, project } = projection(stops);

  const stations = {};
  const lines = [];

  for (const route of routes) {
    const id = route.route_long_name.match(/Metro (\w) Line/)?.[1] ?? route.route_id;
    const routeTrips = trips.filter((t) => t.route_id === route.route_id);

    // Representative trip per direction: the one that serves the most stations (skips short-turns).
    const longest = (dir) => routeTrips.filter((t) => t.direction_id === dir).reduce((best, t) =>
      (tripTimes.get(t.trip_id)?.length ?? 0) > (tripTimes.get(best.trip_id)?.length ?? 0) ? t : best);

    // The stations a trip calls at, adding any new ones (and this line) to `stations`.
    const stationPath = (trip) => {
      const path = [];
      for (const st of tripTimes.get(trip.trip_id)) {
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

    const main = stationPath(longest("0"));
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

    // Rough daytime frequency: busiest service day, direction 0, departures within DAYTIME.
    const dir0 = routeTrips.filter((t) => t.direction_id === "0");
    const byService = Map.groupBy(dir0, (t) => t.service_id);
    const busiest = [...byService.values()].reduce((a, b) => (b.length > a.length ? b : a));
    const daytime = busiest.filter((t) => {
      const dep = toSec(tripTimes.get(t.trip_id)?.[0]?.departure_time ?? "0:0:0");
      return dep >= DAYTIME[0] && dep < DAYTIME[1];
    }).length;

    lines.push({
      id,
      name: route.route_long_name.replace(/^Metro (\w Line).*/, "$1"),
      color: `#${route.route_color}`,
      textColor: `#${route.route_text_color}`,
      stations: stationIds,
      times,
      extraPaths,
      trainsPerHour: round(daytime / ((DAYTIME[1] - DAYTIME[0]) / 3600)),
    });
  }

  lines.sort((a, b) => a.id.localeCompare(b.id));
  mergeTwins(lines, stations);
  for (const s of Object.values(stations)) {
    s.lines.sort();
    s.transfer = s.lines.length > 1;
  }

  return { lines, stations, projection: { lat0, lon0 } };
}
