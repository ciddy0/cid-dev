import assert from "node:assert/strict";
import { test } from "node:test";
import { FRESH, follower } from "../public/js/live.js";
import { SEATS } from "../public/js/timetable.js";

const hop = (from, to) => ({ from, to });
const line = { id: "A" };
const routes = [{ line, runs: [[hop("a", "b"), hop("b", "c")], [hop("c", "b"), hop("b", "a")]] }];
const train = (from, to, progress, id = "101") => ({ id, line: "A", from, to, progress });
const where = ([s]) => [s.from, s.to, +s.progress.toFixed(2)];

test("nothing to go on until a snapshot comes, nor once it is old", () => {
  const follow = follower(routes);
  assert.equal(follow.at(0), null);
  follow.take([], 0);
  assert.equal(follow.at(1), null); // nobody about
  follow.take([train("a", "b", 0.5)], 10);
  const [state] = follow.at(11);
  assert.deepEqual(where([state]), ["a", "b", 0.5]);
  assert.ok(state.id === "101" && state.line === "A" && state.load.length === SEATS);
  assert.equal(follow.at(10 + FRESH + 1), null);
});

test("a car glides to where its train was last seen, through the station on the way", () => {
  const follow = follower(routes);
  follow.take([train("a", "b", 0.8)], 0);
  follow.at(5);
  follow.take([train("b", "c", 0.1)], 5);
  const seen = [5.1, 6, 7, 9, 12, 29].map((now) => follow.at(now)[0]);
  const u = seen.map((s) => (s.from === "a" ? 0 : 1) + s.progress);
  assert.ok(u[0] > 0.8 && u[0] < 1, "still short of b");
  assert.deepEqual(u, u.toSorted((a, b) => a - b));
  // At the speed of the train, which took 5 s over it: no rush at first, no crawl after.
  assert.ok(Math.abs(u[1] - u[0] - 0.054) < 1e-9 && Math.abs(u[2] - u[1] - 0.06) < 1e-9);
  assert.deepEqual(where([seen.at(-1)]), ["b", "c", 0.1]);
});

test("a car stands at the station its train stopped at, and doesn't back up", () => {
  const follow = follower(routes);
  follow.take([train("a", "b", 1)], 0);
  assert.deepEqual(where(follow.at(0)), ["b", "c", 0]); // at b, either way of putting it
  follow.take([train("a", "b", 0.9)], 5);
  assert.deepEqual(where(follow.at(6)), ["b", "c", 0]);
  follow.take([train("b", "c", 1)], 10);
  assert.deepEqual(where(follow.at(25)), ["b", "c", 1]);
});

test("a train given its trip back early has its car finish the run first", () => {
  const follow = follower(routes);
  follow.take([train("b", "c", 0.4)], 0);
  follow.at(5);
  follow.take([train("c", "b", 0)], 5); // the feed has it at c already, headed back
  assert.deepEqual(where(follow.at(5)), ["b", "c", 0.4]);
  assert.deepEqual(where(follow.at(9.5)), ["b", "c", 0.7]);
  follow.take([train("c", "b", 0.3)], 10);
  assert.deepEqual(where(follow.at(13.9)).slice(0, 2), ["b", "c"]);
  assert.deepEqual(where(follow.at(14.1)), ["c", "b", 0]); // turned round where it stands
  assert.deepEqual(where(follow.at(40)), ["c", "b", 0.3]);
});

test("a train that jumps, or leaves, takes its car with it", () => {
  const stops = [..."abcdef"];
  const out = stops.slice(1).map((to, k) => hop(stops[k], to));
  const follow = follower([{ line, runs: [out, out.map((h) => hop(h.to, h.from)).reverse()] }]);
  follow.take([train("a", "b", 0.2), train("a", "b", 0.2, "102"), train("a", "b", 0.2, "103")], 0);
  assert.equal(follow.at(0).length, 3);
  follow.take([train("d", "c", 0.3), train("e", "f", 0.5, "102"), train("x", "y", 0.2, "104")], 5);
  assert.deepEqual(
    follow.at(5.1).map((s) => [s.id, ...where([s])]),
    [["101", "d", "c", 0.3], ["102", "e", "f", 0.5]],
  );
});

test("a train that turns back short, or goes on as another line, has its car ride there first", () => {
  const stops = [..."abcdef"];
  const out = stops.slice(1).map((to, k) => hop(stops[k], to));
  const other = { line: { id: "D" }, runs: [[hop("c", "x")], [hop("x", "c")]] };
  const follow = follower([{ line, runs: [out, out.map((h) => hop(h.to, h.from)).reverse()] }, other]);
  follow.take([train("a", "b", 0.5), train("b", "c", 0.5, "102")], 0);
  follow.at(5);
  // 101 is headed back from b, never having gone on to f; 102 leaves c as a D train.
  follow.take([train("b", "a", 0.2), { ...train("c", "x", 0.1, "102"), line: "D" }], 5);
  const seen = [5, 8, 12.4, 12.6, 60].map((now) => follow.at(now).map((s) => [s.line, ...where([s])]));
  assert.deepEqual(seen[0], [["A", "a", "b", 0.5], ["A", "b", "c", 0.5]]);
  assert.deepEqual(seen[1], [["A", "a", "b", 0.7], ["A", "b", "c", 0.7]]);
  assert.deepEqual(seen[2].map(([line, from, to]) => [line, from, to]), [["A", "a", "b"], ["A", "b", "c"]]);
  assert.deepEqual(seen[3].map(([line, from, to]) => [line, from, to]), [["A", "b", "a"], ["D", "c", "x"]]);
  assert.deepEqual(seen[4], [["A", "b", "a", 0.2], ["D", "c", "x", 0.1]]);
});

test("on the live feed passengers get off and on one at a time", () => {
  const follow = follower(routes);
  follow.take([train("a", "b", 0.9)], 0);
  const before = follow.at(0)[0].load;
  follow.take([train("b", "c", 1)], 5); // the end of the line: everybody off
  let was = before;
  for (let now = 5; now < 40; now += 0.05) {
    const { load } = follow.at(now)[0];
    assert.ok(load.filter((shape, seat) => shape !== was[seat]).length <= 1);
    was = load;
  }
  assert.ok(before.some(Boolean) && !was.some(Boolean));
});

test("the record is run through first, every train along its run", () => {
  const follow = follower(routes);
  const frames = [
    { at: 1000, trains: [train("a", "b", 0)] },
    { at: 1060, trains: [train("a", "b", 1), train("c", "b", 0.5, "102")] },
    { at: 1120, trains: [train("b", "c", 0.9), train("c", "b", 0.4, "102")] }, // 102 only wavers
    { at: 1180, trains: [train("b", "c", 1), train("b", "a", 0.5, "102"), train("c", "b", 0.2, "103")] },
  ];
  follow.replay(frames, 50, 4);
  assert.deepEqual(follow.at(50).map((s) => [s.id, ...where([s])]), [["101", "a", "b", 0]]);
  const u = [50.2, 50.5, 51, 52, 53, 53.9].map((now) => {
    const s = follow.at(now).find((s) => s.id === "101");
    return (s.from === "a" ? 0 : 1) + s.progress;
  });
  assert.deepEqual(u, u.toSorted((a, b) => a - b));
  assert.ok(u[0] < u[1] && u[2] < 1 && u[3] > 1 && u.at(-1) === 2, "through b, and in by the end");
  // Over: everyone is where the last frame saw them, and it counts as a snapshot.
  const ended = follow.at(54.1).map((s) => [s.id, ...where([s])]);
  assert.deepEqual(ended, [["101", "b", "c", 1], ["102", "b", "a", 0.5], ["103", "c", "b", 0.2]]);
  assert.equal(follow.at(54.1 + FRESH + 1), null);
});

test("in the catch-up a car stands at each station, its passengers changing one at a time", () => {
  const stops = [..."abcdef"];
  const out = stops.slice(1).map((to, k) => hop(stops[k], to));
  const runs = [out, out.map((h) => hop(h.to, h.from)).reverse()];
  // Seen once a minute, wherever it happened to be: a→b, c→d, then back out of f, by e.
  const seen = [train("a", "b", 0.5), train("c", "d", 0.2), train("e", "f", 0.6), train("e", "d", 0.4)];
  const frames = seen.map((s, k) => ({ at: 1000 + 60 * k, trains: [s] }));
  const follow = follower([{ line, runs }]);
  follow.replay(frames, 0, 10, 0);
  const stood = new Map(); // station → how many looks the car was standing at it for
  let was = null,
    changes = 0;
  for (let now = 0; now < 10; now += 0.01) {
    const [s] = follow.at(now);
    const at = s.progress === 0 ? s.from : s.progress === 1 ? s.to : null;
    if (was) {
      const changed = s.load.filter((shape, seat) => shape !== was.load[seat]).length;
      assert.ok(changed <= 1, "one passenger at a time");
      assert.ok(!changed || at, "and only at a station");
      assert.ok(at || s.progress !== was.progress || now > 9, "never standing between two");
      changes += changed;
    }
    if (at) stood.set(at, (stood.get(at) ?? 0) + 1);
    was = s;
  }
  assert.deepEqual([...stood.keys()], ["b", "c", "d", "e", "f"]); // f both ways: there, and back
  for (const looks of stood.values()) assert.ok(looks > 10);
  assert.ok(changes > 2);
  assert.deepEqual(where([was]), ["e", "d", 0.4]);
});

test("news during the catch-up becomes its last frame, so that it ends on now", () => {
  const follow = follower(routes);
  const frames = [{ at: 1000, trains: [train("a", "b", 0.2)] }, { at: 1060, trains: [train("a", "b", 0.6)] }];
  follow.replay(frames, 0, 2, 40);
  follow.at(0.5);
  follow.take([train("a", "b", 0.9)], 1);
  const seen = [1, 1.2, 1.5, 1.9, 2, 2.1].map((now) => follow.at(now)[0].progress);
  assert.deepEqual(seen, seen.toSorted((a, b) => a - b));
  assert.ok(seen[0] <= 0.6 && seen[3] > 0.6);
  assert.deepEqual(seen.slice(-2).map((p) => +p.toFixed(6)), [0.9, 0.9]);
  // And so does all the news after it, while there is time.
  const more = follower(routes);
  more.replay(frames, 0, 2, 40);
  more.take([train("a", "b", 0.7)], 0.5);
  more.take([train("a", "b", 0.9)], 1.5);
  const later = [0.5, 1, 1.5, 1.8, 2, 2.1].map((now) => more.at(now)[0].progress);
  assert.deepEqual(later, later.toSorted((a, b) => a - b));
  assert.deepEqual(later.slice(-2).map((p) => +p.toFixed(6)), [0.9, 0.9]);
});

test("news after the catch-up, or too late in it, is made up gently", () => {
  const frames = [{ at: 1000, trains: [train("a", "b", 0.2)] }, { at: 1060, trains: [train("a", "b", 0.6)] }];
  for (const when of [1.9, 4]) {
    const follow = follower(routes);
    follow.replay(frames, 0, 2);
    follow.at(1.8);
    if (when < 2) follow.take([train("a", "b", 0.9)], when);
    assert.deepEqual(where(follow.at(2)), ["a", "b", 0.6]);
    follow.at(4);
    if (when > 2) follow.take([train("a", "b", 0.9)], when);
    const from = Math.max(when, 2);
    const seen = [1, 6, 11, 12, 20].map((s) => follow.at(from + s)[0].progress);
    assert.ok(seen[0] - 0.6 < 0.01, "off gently"); // no lurch
    assert.equal(+seen[1].toFixed(6), 0.75); // half way, half way through its 12 s
    assert.ok(0.9 - seen[2] < 0.01, "and gently in");
    assert.deepEqual(seen.slice(-2).map((p) => +p.toFixed(6)), [0.9, 0.9]);
  }
  // More news on the way there moves where it is headed, not where it is.
  const follow = follower(routes);
  follow.replay(frames, 0, 2);
  follow.at(2);
  follow.take([train("a", "b", 0.8)], 2);
  const before = follow.at(8)[0].progress;
  follow.take([train("b", "c", 0.2)], 8);
  assert.equal(+follow.at(8)[0].progress.toFixed(6), +before.toFixed(6));
  assert.ok(follow.at(8.1)[0].progress - before < 0.02);
  assert.deepEqual(where(follow.at(14)), ["b", "c", 0.2]);
  // With no time to run through it in, straight to the end.
  const calm = follower(routes);
  calm.replay(frames, 0, 0);
  assert.deepEqual(where(calm.at(0)), ["a", "b", 0.6]);
});

test("a car never dashes: a train suddenly far ahead is glided to at a hop's pace", () => {
  const follow = follower(routes);
  follow.take([train("a", "b", 0.1)], 0);
  follow.at(5);
  follow.take([train("b", "c", 0.1)], 5); // a whole hop on in 5 s
  follow.at(5);
  const s = follow.at(10);
  assert.deepEqual([s[0].from, +s[0].progress.toFixed(3)], ["a", 0.433]); // a third of a hop in 5 s
});
