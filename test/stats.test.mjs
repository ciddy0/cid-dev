import assert from "node:assert/strict";
import { test } from "node:test";
import {
  day,
  hours,
  lateSql,
  lateness,
  pick,
  trainsSql,
} from "../worker/stats.js";

const at = (iso) => Date.parse(iso) / 1000;
const hourOf = (d, t) =>
  Math.floor((t + (t < d.turn ? d.before : d.after) - d.midnight) / 3600);
const clock = (d) => {
  const seen = [];
  for (let t = d.start; t < d.end; t += 3600) seen.push(hourOf(d, t));
  return seen;
};

test("an ordinary day is 24 LA hours", () => {
  const d = day("2026-11-16");
  assert.equal(d.start, at("2026-11-16T08:00:00Z"));
  assert.equal(d.end, at("2026-11-17T08:00:00Z"));
  assert.equal(d.service, d.start);
  assert.deepEqual(
    clock(d),
    Array.from({ length: 24 }, (_, h) => h),
  );
  assert.doesNotMatch(trainsSql(d, ["801"]), /CASE WHEN m\.secs/);
});

test("spring forward leaves 2 AM empty", () => {
  const d = day("2026-03-08");
  assert.equal(d.end - d.start, 23 * 3600);
  assert.equal(d.turn, at("2026-03-08T10:00:00Z"));
  assert.deepEqual(clock(d), [
    0,
    1,
    ...Array.from({ length: 21 }, (_, h) => h + 3),
  ]);
  assert.equal(d.service, at("2026-03-08T07:00:00Z"));
  assert.match(
    trainsSql(d, ["801"]),
    /CASE WHEN m\.secs < \d+ THEN -28800 ELSE -25200 END/,
  );
});

test("fall back folds both 1 AMs into one hour", () => {
  const d = day("2026-11-01");
  assert.equal(d.end - d.start, 25 * 3600);
  assert.equal(d.turn, at("2026-11-01T09:00:00Z"));
  assert.deepEqual(clock(d), [
    0,
    1,
    1,
    ...Array.from({ length: 22 }, (_, h) => h + 2),
  ]);
});

test("a day is read against the last timetable published by then", () => {
  const versions = ["2026-11-10", "2026-11-14", "2026-11-17"];
  assert.equal(pick(versions, "2026-11-14"), "2026-11-14");
  assert.equal(pick(versions, "2026-11-16"), "2026-11-14");
  assert.equal(pick(versions, "2026-11-01"), null);
});

test("names going into the SQL are checked", () => {
  const d = day("2026-11-16");
  assert.throws(() => trainsSql(d, ["801'; --"]), /bad name/);
  assert.throws(
    () => lateSql(d, ["802"], { rail: "x' OR 1=1", bus: "2026-10-11" }),
    /bad name/,
  );
  assert.throws(() => day("2026-11-16' --"), /bad date/);
});

test("the A Line isn't timed", () => {
  const sql = lateSql(day("2026-11-16"), ["801", "802"], {
    rail: "2026-11-14",
    bus: "2026-10-11",
  });
  assert.match(sql, /route_code IN \('802'\)/);
});

test("rows become the stats screen's day", () => {
  const d = day("2026-11-16");
  const rows = [
    { hour: 7, route: "801", trains: 30, minutes: 600, cars: 3 },
    { hour: 8, route: "801", trains: 31, minutes: 600, cars: 3 },
  ];
  const made = hours(d, rows);
  assert.equal(made.minutes, 600);
  assert.equal(made.lines["801"][7], 30);
  assert.equal(made.lines["801"][6], null);
  assert.throws(() => hours(d, [{ ...rows[0], cars: 7 }]), /7 cars/);
});

test("a line is off its timetable when most arrivals were 10+ minutes late", () => {
  const late = lateness([
    { route: "802", arrivals: 100, late: 90, way_late: 51 },
    { route: "803", arrivals: 100, late: 50, way_late: 50 },
  ]);
  assert.deepEqual(late["802"], { arrivals: 100, late: 90, off: true });
  assert.equal(late["803"].off, false);
});
