import assert from "node:assert/strict";
import { test } from "node:test";
import { follower } from "../public/js/live.js";
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
  assert.ok(state.id === "101" && state.line === "A" && state.load.length <= SEATS);
  assert.equal(follow.at(41), null);
});

test("a car eases towards where its train was last seen, through the station on the way", () => {
  const follow = follower(routes);
  follow.take([train("a", "b", 0.5)], 0);
  follow.at(5);
  follow.take([train("b", "c", 0.5)], 5);
  const seen = [5.1, 6, 7, 9, 12, 29].map((now) => follow.at(now)[0]);
  const u = seen.map((s) => (s.from === "a" ? 0 : 1) + s.progress);
  assert.ok(u[0] > 0.5 && u[0] < 1, "still short of b");
  assert.deepEqual(u, u.toSorted((a, b) => a - b));
  assert.deepEqual(where([seen.at(-1)]), ["b", "c", 0.5]);
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

test("a train that turns back, or leaves, takes its car with it", () => {
  const follow = follower(routes);
  follow.take([train("b", "c", 1), train("a", "b", 0.2, "102")], 0);
  assert.equal(follow.at(0).length, 2);
  follow.take([train("c", "b", 0.3), train("x", "y", 0.2, "103")], 5);
  assert.deepEqual(follow.at(5.1).map((s) => [s.id, ...where([s])]), [["101", "c", "b", 0.3]]);
});
