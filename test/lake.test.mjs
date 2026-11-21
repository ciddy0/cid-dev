import assert from "node:assert/strict";
import { test } from "node:test";
import { lakeRow } from "../worker/archive.js";
import {
  batches,
  daysToCount,
  laDate,
  stopTimes,
  versions,
} from "../worker/lake.js";

test("a lake row has RFC 3339 times, which the stream reads as timestamps", () => {
  const row = lakeRow(1794700052, {
    vehicle_id: "4021-4022",
    reported_at: 1794700040,
  });
  assert.equal(row.sampled_at, "2026-11-14T23:47:32Z");
  assert.equal(row.reported_at, "2026-11-14T23:47:20Z");
  assert.equal(lakeRow(1794700052, { reported_at: null }).reported_at, null);
});

test("a timetable belongs to the LA day it was published, the last of that day", () => {
  const got = versions([
    { id: "b", committed_date: "2026-11-14T01:30:18.000-08:00" },
    { id: "a", committed_date: "2026-11-13T01:30:24.000-08:00" },
    { id: "c", committed_date: "2026-11-14T15:00:00.000-08:00" },
    { id: "d", committed_date: "2026-11-15T07:30:00.000Z" },
  ]);
  assert.deepEqual(
    got.map((v) => [v.feed, v.sha]),
    [
      ["2026-11-13", "a"],
      ["2026-11-14", "d"],
    ],
  );
  assert.equal(laDate(Date.parse("2026-11-15T07:59:00Z")), "2026-11-14");
});

test("stop_times rows give seconds from noon less 12 hours", () => {
  const rows = stopTimes(
    "﻿trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
      "64762207,05:08:00,05:08:00,80101,1\n" +
      "64762207,25:01:30,25:01:30,80102,2\r\n\n",
    "rail",
    "2026-11-14",
  );
  assert.deepEqual(rows, [
    {
      network: "rail",
      feed: "2026-11-14",
      trip_id: "64762207",
      stop_sequence: 1,
      arrival: 18480,
    },
    {
      network: "rail",
      feed: "2026-11-14",
      trip_id: "64762207",
      stop_sequence: 2,
      arrival: 90090,
    },
  ]);
});

test("batches stay under the size, and never come out empty", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    i,
    pad: "x".repeat(40),
  }));
  const got = [...batches(rows, 200)];
  assert.equal(got.flat().length, 10);
  for (const batch of got)
    assert.ok(JSON.stringify(batch).length <= 200 || batch.length === 1);
  assert.deepEqual([...batches([])], []);
});

const loaded = {
  rail: [{ feed: "2026-11-14" }, { feed: "2026-11-17" }],
  bus: [{ feed: "2026-10-11" }],
  checked: "2026-11-18T10:00:00Z",
};
const at = (iso) => Date.parse(iso);

test("the job counts from the archive's first day, up to yesterday", () => {
  const todo = daysToCount({ days: [] }, loaded, at("2026-11-18T12:00:00Z"));
  assert.deepEqual(
    todo.map((t) => [t.date, t.feeds.rail]),
    [
      ["2026-11-14", "2026-11-14"],
      ["2026-11-15", "2026-11-14"],
      ["2026-11-16", "2026-11-14"],
      ["2026-11-17", "2026-11-17"],
    ],
  );
});

test("the job carries on after the last day counted", () => {
  const todo = daysToCount(
    { days: [{ date: "2026-11-16" }] },
    loaded,
    at("2026-11-18T12:00:00Z"),
  );
  assert.deepEqual(
    todo.map((t) => t.date),
    ["2026-11-17"],
  );
});

test("a day waits until its timetables have been looked for", () => {
  const todo = daysToCount(
    { days: [{ date: "2026-11-16" }] },
    { ...loaded, checked: "2026-11-17T10:00:00Z" },
    at("2026-11-18T12:00:00Z"),
  );
  assert.deepEqual(todo, []);
  assert.deepEqual(
    daysToCount(
      { days: [] },
      { ...loaded, bus: [] },
      at("2026-11-18T12:00:00Z"),
    ),
    [],
  );
});
