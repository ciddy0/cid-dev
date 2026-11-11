import assert from "node:assert/strict";
import { test } from "node:test";
import { bendAt, bendRadii, bendShift, bounds, lineEnds, segDist, toD } from "../public/js/geometry.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);
const corner = [[0, 0], [4, 0], [4, 4]]; // east, then a right-angle turn south

test("bendAt describes a turn, and is null where there is none", () => {
  const b = bendAt(corner, 1);
  assert.deepEqual([b.u, b.v], [[1, 0], [0, 1]]);
  near(b.half, Math.PI / 4);
  assert.equal(b.cw, true);
  near(b.room, 2);
  assert.equal(bendAt(corner, 0), null);
  assert.equal(bendAt(corner, 2), null);
  assert.equal(bendAt([[0, 0], [1, 0], [2, 0]], 1), null);
});

test("toD rounds a bend off with an arc that starts and ends short of the corner", () => {
  assert.equal(toD(corner), "M0 0L4 0L4 4");
  assert.equal(toD(corner, [, 1]), "M0 0L3 0A1 1 0 0 1 4 1L4 4");
});

test("bendShift is how far the arc's midpoint sits inside the corner", () => {
  const [dx, dy] = bendShift(corner, 1, 1);
  near(dx, -(1 - Math.SQRT1_2));
  near(dy, 1 - Math.SQRT1_2);
  assert.deepEqual(bendShift(corner, 0, 1), [0, 0]);
});

test("bendRadii gives a lone bend the radius that starts `cut` from its corner", () => {
  const [radii] = bendRadii([{ pts: corner }], 0.5, 0.2);
  near(radii[1], 0.5);
});

test("bendRadii nests lines going round a bend side by side", () => {
  const lane = 0.2;
  const outer = { pts: corner };
  const inner = { pts: [[0, lane], [4 - lane, lane], [4 - lane, 4]] };
  const [a, b] = bendRadii([outer, inner], 0.5, lane);
  near(a[1] - b[1], lane); // one lane apart all the way round
  near((a[1] + b[1]) / 2, 0.5);
});

test("segDist is 0 for crossing segments and the gap between others", () => {
  assert.equal(segDist([[0, 0], [2, 2]], [[0, 2], [2, 0]]), 0);
  near(segDist([[0, 0], [2, 0]], [[0, 1], [2, 1]]), 1);
  near(segDist([[0, 0], [1, 0]], [[4, 4], [4, 9]]), 5);
});

test("lineEnds gives each end and the direction the line arrives in", () => {
  assert.deepEqual(lineEnds(corner), [
    { x: 0, y: 0, dx: -1, dy: 0 },
    { x: 4, y: 4, dx: 0, dy: 1 },
  ]);
  assert.deepEqual(lineEnds([[0, 0]]), []);
});

test("bounds grows to cover points and discs", () => {
  const b = bounds();
  b.cover(0, 0);
  b.cover(4, 2, 1);
  assert.deepEqual(b.box(), { x: 0, y: 0, w: 5, h: 3 });
  assert.deepEqual(b.box(1), { x: -1, y: -1, w: 7, h: 5 });
});
