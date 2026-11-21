import { parquetWriteBuffer } from "hyparquet-writer";

export const SPAN = 6 * 60 * 60;

export function sample({ id, route_code, vehicle } = {}) {
  if (!id || !vehicle) return null;

  const { trip = {}, position = {} } = vehicle;
  return {
    vehicle_id: id,
    route_code: route_code || null,
    trip_id: trip.tripId ?? null,
    start_date: trip.startDate ?? null,
    start_time: trip.startTime ?? null,
    direction_id: trip.directionId ?? null,
    stop_id: vehicle.stopId ?? null,
    stop_sequence: vehicle.currentStopSequence ?? null,
    status: vehicle.currentStatus ?? null,
    reported_at: +vehicle.timestamp || null,
    lat: position.latitude ?? null,
    lon: position.longitude ?? null,
  };
}

export const windowOf = (at) => at - (at % SPAN);
export function key(start) {
  const iso = new Date(start * 1000).toISOString();
  return `vehicle_positions/date=${iso.slice(0, 10)}/${iso.slice(11, 13)}.parquet`;
}

const COLUMNS = {
  sampled_at: "TIMESTAMP",
  vehicle_id: "STRING",
  route_code: "STRING",
  trip_id: "STRING",
  start_date: "STRING",
  start_time: "STRING",
  direction_id: "INT32",
  stop_id: "STRING",
  stop_sequence: "INT32",
  status: "STRING",
  reported_at: "TIMESTAMP",
  lat: "DOUBLE",
  lon: "DOUBLE",
};

const cell = (type, value) =>
  type === "TIMESTAMP" && value != null
    ? new Date(value * 1000)
    : (value ?? null);

export function parquet(rows) {
  return parquetWriteBuffer({
    columnData: Object.entries(COLUMNS).map(([name, type]) => ({
      name,
      type,
      data: rows.map((row) => cell(type, row[name])),
    })),
  });
}

const stamp = (at) =>
  at == null ? null : new Date(at * 1000).toISOString().slice(0, 19) + "Z";
export const lakeRow = (at, row) => ({
  ...row,
  sampled_at: stamp(at),
  reported_at: stamp(row.reported_at),
});
