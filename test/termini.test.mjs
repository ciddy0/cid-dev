import assert from "node:assert/strict";
import { test } from "node:test";
import { termini } from "../public/js/termini.js";

const LANE = 0.2;
const track = (id, pts, extra = 0) => ({ line: { id }, extra, pts });

test("a line on its own ends in a straight T at each end", () => {
  const ts = termini([track("A", [[0, 0], [10, 0]])], LANE);
  assert.equal(ts.length, 2);
  for (const t of ts) assert.equal(t.trim, null);
  // stem 2.2 lanes out past the end, crossbar 1.4 lanes either side
  assert.equal(ts[1].d, "M9.78 0L10 0L10.44 0M10.44 -0.28L10.44 0.28");
});

test("extra paths get no T", () => {
  const ts = termini([track("A", [[0, 0], [10, 0]]), track("A", [[0, 0], [0, 5]], 1)], LANE);
  assert.equal(ts.length, 2);
});

test("a T that would hit another line turns aside, and its line is trimmed to meet it", () => {
  const blocked = track("A", [[0, 0], [10, 0]]);
  const wall = track("B", [[10.3, -5], [10.3, 5]]);
  const t = termini([blocked, wall], LANE)[1];
  assert.deepEqual(t.trim, { track: blocked, at: 1, from: [9.78, 0] });
  assert.match(t.d, /A/); // curves into the turned stem
});

test("lines ending side by side share a T, each bar stopping halfway to its neighbour", () => {
  const ts = termini(
    [track("A", [[0, 0], [10, 0]]), track("B", [[0, LANE], [10, LANE]])],
    LANE,
  );
  assert.equal(ts[1].d, "M9.78 0L10 0L10.44 0M10.44 -0.28L10.44 0.1");
  assert.equal(ts[3].d, "M9.78 0.2L10 0.2L10.44 0.2M10.44 0.1L10.44 0.48");
});
