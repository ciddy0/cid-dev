import assert from "node:assert/strict";
import { test } from "node:test";
import { adapter, spot, unique } from "../worker/adapt.js";

// Three stations a kilometre or so apart heading north, and one only called at on the way back.
const map = {
  projection: { lat0: 34, lon0: -118 },
  lines: [
    {
      id: "A",
      route: "801",
      stations: ["a", "b", "c"],
      extraPaths: [{ stations: ["a", "x", "c"] }],
    },
  ],
  stations: {
    a: { geo: [0, 0] },
    b: { geo: [0, -1] },
    c: { geo: [0, -2] },
    x: { geo: [1, -1] },
  },
  platforms: { b1: "b" },
};
const adapt = adapter(map);
const lat = (km) => 34 + km / 111.32;
const vehicle = (stopId, currentStatus, directionId, km, route = "801") => ({
  id: "101-102",
  route_code: route,
  vehicle: {
    trip: { routeId: route, directionId },
    position: { latitude: lat(km), longitude: -118 },
    currentStatus,
    stopId,
    timestamp: "1700000000",
  },
});

test("a train on its way is between the stop before and the one it is headed for", () => {
  assert.deepEqual(adapt(vehicle("b1", "IN_TRANSIT_TO", 0, 0.25)), {
    id: "101-102",
    line: "A",
    seen: 1700000000,
    from: "a",
    to: "b",
    progress: 0.25,
  });
  const { from, to, progress } = adapt(vehicle("c", "IN_TRANSIT_TO", 0, 1.5));
  assert.deepEqual([from, to, progress], ["b", "c", 0.5]);
});

test("direction 1 runs the line backwards, by its extra paths", () => {
  const { from, to } = adapt(vehicle("x", "IN_TRANSIT_TO", 1, 1.5));
  assert.deepEqual([from, to], ["c", "x"]);
  assert.equal(adapt(vehicle("b", "IN_TRANSIT_TO", 1, 1.5)), null); // not called at on the way back
});

test("a stopped train stands at its stop", () => {
  const { from, to, progress } = adapt(vehicle("b", "STOPPED_AT", 0, 1));
  assert.deepEqual([from, to, progress], ["a", "b", 1]);
  const first = adapt(vehicle("a", "STOPPED_AT", 0, 0));
  assert.deepEqual([first.from, first.to, first.progress], ["a", "b", 0]);
});

test("a train under way is never quite at a station, wherever its position puts it", () => {
  assert.equal(adapt(vehicle("b", "IN_TRANSIT_TO", 0, -3)).progress, 0.05);
  assert.equal(adapt(vehicle("b", "IN_TRANSIT_TO", 0, 3)).progress, 0.95);
  const lost = vehicle("b", "IN_TRANSIT_TO", 0, 0);
  delete lost.vehicle.position;
  assert.equal(adapt(lost).progress, 0.5);
});

test("vehicles out of service, off the map or malformed are nobody", () => {
  const parked = vehicle("b", "STOPPED_AT", 0, 1, "");
  delete parked.vehicle.trip;
  assert.equal(adapt(parked), null);
  assert.equal(adapt(vehicle("b", "STOPPED_AT", 0, 1, "999")), null);
  assert.equal(adapt(vehicle("nowhere", "STOPPED_AT", 0, 1)), null);
  assert.equal(adapt({}), null);
  assert.equal(adapt({ id: "1", route_code: "801" }), null);
});

// A train as the hub keeps it: `seq` 1 is waiting to start, `km` is how far north it is.
const train = (id, seen, stopId, seq, km, directionId = 0) => {
  const message = vehicle(stopId, "IN_TRANSIT_TO", directionId, km);
  Object.assign(message, { id });
  message.vehicle.currentStopSequence = seq;
  return { id, seen, spot: spot(message) };
};
const kept = (...trains) => unique(trains).map(({ id }) => id);

test("of two trains with a car in common, the one under way is kept", () => {
  const yard = train("100-125-129", 20, "a", 1, 0),
    running = train("116-125", 10, "c", 3, 1.5);
  assert.deepEqual(kept(yard, running), ["116-125"]);
  assert.deepEqual(kept(running, yard), ["116-125"]);
});

test("and of two both under way, the one heard from last", () => {
  const old = train("116-125", 10, "b", 2, 0.5),
    fresh = train("125-130", 20, "c", 3, 1.5);
  assert.deepEqual(kept(old, fresh), ["125-130"]);
});

test("two ids in one place headed for the same stop are one train", () => {
  const one = train("116-125", 10, "c", 3, 1.5),
    twin = train("164", 20, "c", 3, 1.55);
  assert.deepEqual(kept(one, twin), ["164"]);
  assert.deepEqual(kept(one, train("164", 20, "c", 3, 1.9)).length, 2);
  assert.deepEqual(kept(one, train("164", 20, "c", 3, 1.55, 1)).length, 2);
  assert.deepEqual(kept(train("9001", 10, "c", 3, 1.5), twin).length, 2); // two buses
});

test("two trains waiting at the same terminal are two trains", () => {
  const one = train("116-125", 10, "a", 1, 0),
    other = train("140-141", 20, "a", 1, 0.02);
  assert.deepEqual(kept(one, other), ["116-125", "140-141"]);
});
