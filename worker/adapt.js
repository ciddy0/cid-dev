// Turns what LA Metro's feed says about a vehicle into what the page draws: a train of a line
// between two neighbouring stations, some of the way along. Never touches the network, so
// test/ runs it under Node.

const KM_PER_DEG = 111.32;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// A line's stations in the order each direction calls at them: direction 0 end to end, and
// direction 1 back again by way of the extra paths (see `runs` in public/js/timetable.js).
function ways(line) {
  const back = line.stations.toReversed();
  for (const { stations: ids } of line.extraPaths) {
    const a = back.indexOf(ids.at(-1)),
      b = back.indexOf(ids[0]);
    if (a >= 0 && b >= a) back.splice(a, b - a + 1, ...ids.toReversed());
  }
  return [line.stations, back];
}

// For `map` (metro.json), a function from one message of the feed — a GTFS-realtime vehicle
// position as JSON — to { id, line, from, to, progress, seen }, or null for a vehicle that isn't
// in service on a line of the map. The feed names the stop a vehicle is at or headed for; how
// far it has got from the stop before is read off its position, along the straight line between
// the two. `seen` is when the vehicle last reported, in seconds.
export function adapter(map) {
  const { lat0, lon0 } = map.projection;
  const east = KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const lines = new Map(map.lines.map((line) => [line.route, { id: line.id, ways: ways(line) }]));

  return ({ id, route_code, vehicle } = {}) => {
    const line = lines.get(route_code),
      way = line?.ways[vehicle?.trip?.directionId ?? 0];
    const k = way?.indexOf(map.platforms[vehicle?.stopId] ?? vehicle?.stopId) ?? -1;
    if (k < 0) return null;
    const train = { id, line: line.id, seen: +vehicle.timestamp };
    // At, or on its way to, the stop its trip starts from.
    if (k === 0) return { ...train, from: way[0], to: way[1], progress: 0 };
    const hop = { ...train, from: way[k - 1], to: way[k] };
    if (vehicle.currentStatus === "STOPPED_AT") return { ...hop, progress: 1 };

    const [ax, ay] = map.stations[hop.from].geo,
      [bx, by] = map.stations[hop.to].geo;
    const { latitude, longitude } = vehicle.position ?? {};
    const x = (longitude - lon0) * east,
      y = -(latitude - lat0) * KM_PER_DEG;
    const along = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2);
    // Under way, so never quite at either end.
    return { ...hop, progress: +clamp(Number.isFinite(along) ? along : 0.5, 0.05, 0.95).toFixed(3) };
  };
}
