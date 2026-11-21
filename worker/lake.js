// The two daily jobs on the lake: load Metro's new timetables, then count the days not yet
// counted into stats/latest.json. Both keep their state in the ARCHIVE bucket.
import { day, hours, lateSql, lateness, pick, trainsSql } from "./stats.js";

const ZONE = "America/Los_Angeles";
const GITLAB = "https://gitlab.com/api/v4/projects/LACMTA%2F";
const RAW = "https://gitlab.com/LACMTA/gtfs_rail/-/raw";
const SINCE = "2026-11-13T00:00:00Z";
const FIRST_DAY = "2026-11-14";
const BATCH = 3e6;
export const LOADED = "timetables/loaded.json";
export const STATS = "stats/latest.json";

export const laDate = (ms) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(ms);
const nextDate = (date) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10);

export function versions(commits) {
  const byDay = new Map();
  for (const { id, committed_date } of commits) {
    const feed = laDate(Date.parse(committed_date));
    const had = byDay.get(feed);
    if (!had || Date.parse(committed_date) > Date.parse(had.committed_at))
      byDay.set(feed, { sha: id, feed, committed_at: committed_date });
  }
  return [...byDay.values()].sort((a, b) => (a.feed < b.feed ? -1 : 1));
}

export function stopTimes(text, network, feed) {
  const [head, ...lines] = text.replace(/^﻿/, "").split(/\r?\n/);
  const col = head.split(",");
  const [trip, arrival, sequence] = [
    "trip_id",
    "arrival_time",
    "stop_sequence",
  ].map((name) => col.indexOf(name));
  const rows = [];
  for (const line of lines) {
    const cells = line.split(",");
    if (!cells[trip] || !cells[arrival]) continue;
    const [h, m, s] = cells[arrival].split(":").map(Number);
    rows.push({
      network,
      feed,
      trip_id: cells[trip],
      stop_sequence: Number(cells[sequence]),
      arrival: h * 3600 + m * 60 + s,
    });
  }
  return rows;
}

export function* batches(rows, max = BATCH) {
  let batch = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length + 1;
    if (batch.length && bytes + size > max) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += size;
  }
  if (batch.length) yield batch;
}

export function daysToCount(stored, loaded, now) {
  const yesterday = laDate(now - 86400000);
  const dates = [];
  const last = stored.days.at(-1)?.date;
  for (
    let date = last ? nextDate(last) : FIRST_DAY;
    date <= yesterday;
    date = nextDate(date)
  ) {
    const feeds = {
      rail: pick(
        loaded.rail.map((v) => v.feed),
        date,
      ),
      bus: pick(
        loaded.bus.map((v) => v.feed),
        date,
      ),
    };
    const checked = Date.parse(loaded.checked ?? 0) / 1000;
    if (!feeds.rail || !feeds.bus || checked < day(date).end) break;
    dates.push({ date, feeds });
  }
  return dates;
}

export async function basin(env, query) {
  const res = await fetch(
    `https://api.sql.cloudflarestorage.com/api/v1/accounts/${env.ACCOUNT_ID}/basin-sql/query/${env.LAKE_BUCKET}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.BASIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success)
    throw new Error(
      `basin: HTTP ${res.status} ${JSON.stringify(body?.errors ?? body)}`,
    );
  return body.result.rows;
}

const read = async (env, key, empty) =>
  (await (await env.ARCHIVE.get(key))?.json()) ?? empty;
const write = (env, key, value) =>
  env.ARCHIVE.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });

async function commits(repo, since) {
  const all = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `${GITLAB}${repo}/repository/commits?ref_name=master&per_page=100&page=${page}` +
        (since ? `&since=${encodeURIComponent(since)}` : ""),
    );
    if (!res.ok) throw new Error(`gitlab ${repo}: HTTP ${res.status}`);
    const got = await res.json();
    all.push(...got);
    if (got.length < 100 || !since) return all;
  }
}

export async function loadTimetables(env, now = Date.now()) {
  const loaded = await read(env, LOADED, { rail: [], bus: [] });
  const fresh = versions(
    await commits("gtfs_rail", loaded.rail.at(-1)?.committed_at ?? SINCE),
  ).filter((v) => !loaded.rail.some((had) => had.feed === v.feed));
  for (const version of fresh) {
    const res = await fetch(`${RAW}/${version.sha}/stop_times.txt`);
    if (!res.ok)
      throw new Error(`stop_times ${version.sha}: HTTP ${res.status}`);
    for (const batch of batches(
      stopTimes(await res.text(), "rail", version.feed),
    ))
      await env.TIMETABLES.send(batch);
    loaded.rail.push(version);
    await write(env, LOADED, loaded);
    console.log(`timetables: loaded rail ${version.feed}`);
  }
  const [bus] = await commits("gtfs_bus");
  if (bus && bus.id !== loaded.bus.at(-1)?.sha)
    console.warn(
      `timetables: gtfs_bus has ${bus.id} of ${bus.committed_date}; load it with scripts/lake-load.mjs`,
    );
  loaded.checked = new Date(now).toISOString();
  await write(env, LOADED, loaded);
}

export async function countDays(env, routes, now = Date.now()) {
  const stored = await read(env, STATS, null);
  if (!stored) return console.warn(`stats: no ${STATS} yet, so not counting`);
  const loaded = await read(env, LOADED, { rail: [], bus: [] });
  const todo = daysToCount(stored, loaded, now);
  if (!todo.length) console.warn("stats: no day ready to count");
  for (const { date, feeds } of todo) {
    const d = day(date);
    const stats = hours(d, await basin(env, trainsSql(d, routes)));
    stats.late = lateness(await basin(env, lateSql(d, routes, feeds)));
    stored.days.push(stats);
    await write(env, STATS, stored);
    console.log(`stats: counted ${date}`);
  }
}
