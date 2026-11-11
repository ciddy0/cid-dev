import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNetwork } from "../scripts/lib/network.mjs";

const stop = (stop_id, stop_name, stop_lat, stop_lon, parent_station = "") =>
  ({ stop_id, stop_name, stop_lat, stop_lon, parent_station, location_type: parent_station ? "0" : "1" });
const trip = (trip_id, route_id, direction_id) => ({ trip_id, route_id, direction_id, service_id: "weekday" });
const calls = (trip_id, start, ...stops) =>
  stops.map(([stop_id, mins], k) => {
    const time = `${String(start).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
    return { trip_id, stop_id, stop_sequence: String(k + 1), arrival_time: time, departure_time: time };
  });

const tables = {
  routes: [
    { route_id: "801", route_long_name: "Metro A Line (Blue)", route_color: "0072BC", route_text_color: "FFFFFF" },
    { route_id: "804", route_long_name: "Metro E Line (Expo)", route_color: "FDB913", route_text_color: "000000" },
  ],
  stops: [
    stop("S1", "First Station", "34.00", "-118.20"), stop("S1a", "First", "34.00", "-118.20", "S1"), stop("S1b", "First", "34.00", "-118.20", "S1"),
    stop("S2", "Second Station", "34.02", "-118.20"), stop("S2a", "Second", "34.02", "-118.20", "S2"),
    stop("S2x", "Second One Way Station", "34.02", "-118.19"), stop("S2xa", "Second One Way", "34.02", "-118.19", "S2x"),
    stop("S3", "Third A-Line", "34.04", "-118.20"), stop("S3a", "Third", "34.04", "-118.20", "S3"),
    stop("S3e", "Third E-Line", "34.0405", "-118.20"), stop("S3ea", "Third", "34.0405", "-118.20", "S3e"),
    stop("S4", "Fourth Station", "34.04", "-118.25"), stop("S4a", "Fourth", "34.04", "-118.25", "S4"),
  ],
  trips: [
    trip("out", "801", "0"), trip("out-short", "801", "0"), trip("back", "801", "1"), trip("night", "801", "0"),
    trip("e-out", "804", "0"), trip("e-back", "804", "1"),
  ],
  stopTimes: [
    ...calls("out", 9, ["S1a", 0], ["S1b", 1], ["S2a", 3], ["S3a", 7]),
    ...calls("out-short", 10, ["S1a", 0], ["S2a", 3]),
    ...calls("night", 22, ["S1a", 0], ["S2a", 3]),
    ...calls("back", 9, ["S3a", 30], ["S2xa", 34], ["S1a", 38]),
    ...calls("e-out", 9, ["S3ea", 0], ["S4a", 5]),
    ...calls("e-back", 9, ["S4a", 10], ["S3ea", 15]),
  ],
};

test("builds lines and stations out of GTFS tables", () => {
  const { lines, stations, platforms, projection } = buildNetwork(structuredClone(tables));
  const [a, e] = lines;
  assert.deepEqual([a.route, e.route], ["801", "804"]);
  assert.deepEqual([a.id, a.name, a.color, a.textColor], ["A", "A Line", "#0072BC", "#FFFFFF"]);
  assert.deepEqual(a.stations, ["S1", "S2", "S3"]); // platforms folded into their stations
  assert.deepEqual(a.times, [0, 180, 420]);
  assert.deepEqual(a.extraPaths, [["S1", "S2x", "S3"]]); // only served on the way back
  assert.equal(a.trainsPerHour, 0.17); // 2 daytime departures over 12 hours

  // S3 and S3e are one station under two names
  assert.deepEqual(e.stations, ["S3", "S4"]);
  assert.equal(stations.S3e, undefined);
  assert.deepEqual(
    platforms,
    { S1a: "S1", S1b: "S1", S2a: "S2", S2xa: "S2x", S3a: "S3", S3e: "S3", S3ea: "S3", S4a: "S4" },
  );
  assert.deepEqual(stations.S3, { name: "Third", x: 0.62, y: -1.5, lines: ["A", "E"], transfer: true });
  assert.deepEqual([stations.S1.name, stations.S1.transfer], ["First", false]);
  assert.ok(stations.S1.y > stations.S2.y); // y points south
  assert.ok(Math.abs(projection.lat0 - 34.0268) < 1e-3);
});
