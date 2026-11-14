import assert from "node:assert/strict";
import { test } from "node:test";
import { parquetReadObjects } from "hyparquet";
import { SPAN, key, parquet, sample, windowOf } from "../worker/archive.js";

const moving = {
  id: "4021-4022",
  route_code: "805",
  vehicle: {
    trip: {
      tripId: "65456566",
      startTime: "22:53:00",
      startDate: "20261113",
      directionId: 1,
    },
    position: { latitude: 34.06, longitude: -118.36 },
    currentStopSequence: 11,
    currentStatus: "IN_TRANSIT_TO",
    timestamp: "1794641824",
    stopId: "80231",
  },
};
const parked = {
  id: "1067-1079",
  route_code: "",
  vehicle: {
    position: { latitude: 34.09, longitude: -117.76 },
    timestamp: "1794692252",
  },
};

test("a message becomes a flat row of the feed's own fields", () => {
  assert.deepEqual(sample(moving), {
    vehicle_id: "4021-4022",
    route_code: "805",
    trip_id: "65456566",
    start_date: "20261113",
    start_time: "22:53:00",
    direction_id: 1,
    stop_id: "80231",
    stop_sequence: 11,
    status: "IN_TRANSIT_TO",
    reported_at: 1794641824,
    lat: 34.06,
    lon: -118.36,
  });
});

test("a parked vehicle is a position and nulls, and a message with no vehicle is nothing", () => {
  const row = sample(parked);
  assert.equal(row.trip_id, null);
  assert.equal(row.route_code, null);
  assert.equal(row.lat, 34.09);
  assert.equal(sample({ id: "1" }), null);
  assert.equal(sample(), null);
});

test("a window is six hours by UTC, and names its file", () => {
  const six = Date.UTC(2026, 10, 14, 6) / 1000;
  assert.equal(windowOf(six), six);
  assert.equal(windowOf(six + SPAN - 1), six);
  assert.equal(windowOf(six + SPAN), six + SPAN);
  assert.equal(key(six), "vehicle_positions/date=2026-11-14/06.parquet");
  assert.equal(
    key(six + 3 * SPAN),
    "vehicle_positions/date=2026-11-15/00.parquet",
  );
});

test("rows come back out of the file as they went in", async () => {
  const at = Date.UTC(2026, 10, 14, 6) / 1000;
  const rows = [moving, parked].map((message) => ({
    sampled_at: at,
    ...sample(message),
  }));
  const back = await parquetReadObjects({ file: parquet(rows) });
  assert.equal(back.length, 2);
  assert.equal(back[0].trip_id, "65456566");
  assert.equal(back[0].stop_sequence, 11);
  assert.deepEqual(back[0].sampled_at, new Date(at * 1000));
  assert.deepEqual(back[0].reported_at, new Date(1794641824 * 1000));
  assert.equal(back[1].trip_id, null);
  assert.equal(back[1].direction_id, null);
});
