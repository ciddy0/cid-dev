import assert from "node:assert/strict";
import { test } from "node:test";
import { SEATS, SHAPES, runs, scheduled } from "../public/js/timetable.js";

// A straight rail: distances along it are its x coordinates.
const straight = (total) => ({ total, len: (d) => d, at: (s) => [s, 0], near: ([x]) => x });

const line = { id: "A", stations: ["a", "b", "c"], times: [0, 100, 250], at: [0, 1, 2], trainsPerHour: 12 };
const track = { line, part: line };
const rails = new Map([[track, straight(2)]]);

test("runs go out and back, hop by hop", () => {
  const [out, back] = runs(line, [track], rails);
  assert.deepEqual(out.map((h) => [h.from, h.to, h.dep, h.arr]), [["a", "b", 0, 100], ["b", "c", 100, 250]]);
  assert.deepEqual(back.map((h) => [h.from, h.to, h.dep, h.arr]), [["c", "b", 0, 150], ["b", "a", 150, 250]]);
  assert.deepEqual(out[0].legs, [[rails.get(track), 0, 1]]);
  assert.deepEqual(back[0].legs, [[rails.get(track), 2, 1]]);
});

test("the way back detours along an extra path", () => {
  const loop = { stations: ["a", "x", "c"], at: [0, 1.5, 3] };
  const extra = { line, part: loop };
  const both = new Map([...rails, [extra, straight(3)]]);
  const [out, back] = runs(line, [track, extra], both);
  assert.deepEqual(out.map((h) => h.to), ["b", "c"]);
  assert.deepEqual(back.map((h) => [h.from, h.to]), [["c", "x"], ["x", "a"]]);
  assert.deepEqual(back.map((h) => [h.dep, h.arr]), [[0, 125], [125, 250]]);
});

test("the scheduled feed keeps the line's frequency, every train between two neighbours", () => {
  const feed = scheduled([{ line, runs: runs(line, [track], rails) }]);
  const hops = new Set(["a b", "b c", "c b", "b a"]);
  for (const now of [0, 1, 7.5, 1e6, 1.8e9]) {
    const states = feed(now);
    assert.equal(states.length, 3); // a lap out and back is 2 × (250 + 180) s; 12 an hour
    assert.equal(new Set(states.map((s) => s.id)).size, 3);
    for (const s of states) {
      assert.equal(s.line, "A");
      assert.ok(hops.has(`${s.from} ${s.to}`));
      assert.ok(s.progress >= 0 && s.progress <= 1);
      assert.ok(s.load.length <= SEATS && s.load.every((shape) => SHAPES.includes(shape)));
    }
  }
  assert.deepEqual(feed(42), feed(42)); // from the clock alone
});
