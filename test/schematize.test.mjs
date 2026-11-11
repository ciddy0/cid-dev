import assert from "node:assert/strict";
import { test } from "node:test";
import { LANE, schematize } from "../scripts/lib/schematize.mjs";

const station = (name, x, y, lines) => ({ name, x, y, lines, transfer: lines.length > 1 });
const line = (id, stations) => ({ id, stations, extraPaths: [] });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

// X and Y run east together from a to c, then X heads south-east and Y north-east.
const fork = () => ({
  lines: [line("X", ["a", "b", "c", "d"]), line("Y", ["a", "b", "c", "e"])],
  stations: {
    a: station("Alder", 0, 0, ["X", "Y"]),
    b: station("Birch", 1, 0, ["X", "Y"]),
    c: station("Cedar", 2, 0, ["X", "Y"]),
    d: station("Dogwood", 3, 1, ["X"]),
    e: station("Elm", 3, -1, ["Y"]),
  },
  pins: { Alder: [0, 0], Cedar: [2, 0], Dogwood: [3, 1], Elm: [3, -1] },
});

test("lines sharing track get a lane each, on the side they peel away to", () => {
  const { lines, stations, pins } = fork();
  const out = schematize(lines, stations, { pins });
  assert.deepEqual(out.problems, []);
  const [x, y] = out.lines;
  near(x.stops[0][1] - y.stops[0][1], LANE); // Y, turning north, is on the north side
  assert.deepEqual(out.stations.a.marker, [x.stops[0], y.stops[0]]);
  assert.equal(out.stations.d.marker, undefined);
  assert.deepEqual([out.stations.b.x, out.stations.b.y], [1, 0]); // spread between the pins
  assert.deepEqual(x.at.slice(0, 2), [0, 1]);
  assert.equal(out.layout.lane, LANE);
});

test("unpinned ends walk outward by compass direction, and nudges move them", () => {
  const net = () => ({
    lines: [line("X", ["a", "b", "c"])],
    stations: { a: station("Alder", 0, 0, ["X"]), b: station("Birch", 2, 0.1, ["X"]), c: station("Cedar", 4, 0, ["X"]) },
  });
  const plain = schematize(net().lines, net().stations, { pins: { a: [0, 0] } });
  assert.deepEqual(plain.problems, []);
  assert.deepEqual(plain.lines[0].stops, [[0, 0], [1, 0], [2, 0]]);

  const nudged = schematize(net().lines, net().stations, { pins: { a: [0, 0] }, nudges: { Cedar: [1, 0] } });
  assert.deepEqual(nudged.lines[0].stops, [[0, 0], [1.5, 0], [3, 0]]);
});

test("a forced bend is drawn the way it is told", () => {
  const net = { lines: [line("X", ["a", "b"])], stations: { a: station("Alder", 0, 0, ["X"]), b: station("Birch", 2, 1, ["X"]) } };
  const pins = { a: [0, 0], b: [3, 1] };
  assert.deepEqual(schematize(net.lines, net.stations, { pins, bends: { "Alder > Birch": "E-SE" } }).lines[0].path, [[0, 0], [2, 0], [3, 1]]);
  assert.deepEqual(schematize(net.lines, net.stations, { pins, bends: { "Alder > Birch": "SE-E" } }).lines[0].path, [[0, 0], [1, 1], [3, 1]]);
});

test("overrides that make no sense, and stations too close, are reported", () => {
  const { lines, stations, pins } = fork();
  const out = schematize(lines, stations, {
    pins: { ...pins, Nowhere: [9, 9], Birch: [1.5, 0] },
    bends: { "Alder > Birch": "UP" },
    sides: [["X", "Z"]],
    shifts: [{ lines: ["X"], at: "Elm", by: 1 }],
  });
  assert.deepEqual(out.problems.slice(0, 4), [
    'overrides: bad bend "Alder > Birch": "UP"',
    'overrides: unknown station "Nowhere"',
    "overrides: unknown line in sides X, Z",
    'overrides: shift of X at "Elm" matches nothing',
  ]);
  assert.match(out.problems[4], /^Birch and Cedar are 0\.\d+ apart \(min 0\.9\)$/);
  assert.equal(out.problems.length, 5);
});
