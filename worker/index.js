import { DurableObject } from "cloudflare:workers";
import map from "../public/data/metro.json";
import { adapter, spot, unique } from "./adapt.js";
import { STATS, countDays, loadTimetables } from "./lake.js";
import { SPAN, key, lakeRow, parquet, sample, windowOf } from "./archive.js";

const FEEDS = [
  "wss://api.metro.net/ws/LACMTA_Rail/vehicle_positions",
  "wss://api.metro.net/ws/LACMTA/vehicle_positions/901",
];
const EVERY = 5;
const QUIET = 30;
const WARM = 8;
const HOLD = 25;
const ROUND = 1.5;
const GONE = 300;
const RETRY = 30;
const RECORD = 60;
const KEEP = 65 * 60;
const RECENT = 180;
const CACHE = 20;
const SLACK = 100;
const SEND = 3e6;
const OUTBOX = 24 * 60;
const STATS_CACHE = 3600;
const LOAD_AT = "0 10 * * *";
const COUNT_AT = "0 12 * * *";
const ROUTES = map.lines.map((line) => line.route).sort();

const seconds = () => Date.now() / 1000;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/stats") return stats(request, env);
    if (pathname !== "/live" && pathname !== "/live/history")
      return env.ASSETS.fetch(request);
    return env.LIVE.get(env.LIVE.idFromName("hub")).fetch(request);
  },

  async scheduled(event, env) {
    if (!env.TIMETABLES || !env.BASIN_TOKEN)
      return console.warn("lake: no TIMETABLES binding or BASIN_TOKEN");
    if (event.cron === LOAD_AT) await loadTimetables(env, event.scheduledTime);
    if (event.cron === COUNT_AT)
      await countDays(env, ROUTES, event.scheduledTime);
  },
};

async function stats(request, env) {
  const file = await env.ARCHIVE.get(STATS);
  if (!file) return env.ASSETS.fetch(new URL("/data/stats.json", request.url));
  return new Response(file.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${STATS_CACHE}`,
    },
  });
}

// A snapshot is { trains: [{ id, line, from, to, progress }] }: what `show()` in
// public/js/trains.js takes, less the passengers. A page that stops getting them falls back on
// the timetable. The record is { now, frames: [{ at, trains }] }, a snapshot a minute with the
// time it was taken, oldest first, and the time by the same clock.
export class LiveHub extends DurableObject {
  viewers = new Set();
  feeds = FEEDS.map((url) => ({ url, socket: null, tried: 0, since: 0 })); // since: its first word
  trains = new Map();
  seen = new Map();
  heard = 0;
  woke = 0;
  timer = 0;
  adapt = adapter(map);

  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS frames (at INTEGER PRIMARY KEY, trains TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS samples (at INTEGER PRIMARY KEY, vehicles TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS outbox (at INTEGER PRIMARY KEY, vehicles TEXT NOT NULL)",
    );
    ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) == null)
        await ctx.storage.setAlarm(Date.now());
    });
  }

  fetch(request) {
    if (new URL(request.url).pathname === "/live/history")
      return this.history();
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This is a websocket.", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.viewers.add(server);
    const leave = () => {
      this.viewers.delete(server);
      try {
        server.close();
      } catch {}
      if (!this.viewers.size) this.rest();
    };
    server.addEventListener("close", leave);
    server.addEventListener("error", leave);
    this.timer ||= setInterval(() => this.tick(), EVERY * 1000);
    this.tick(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Once a minute, watched or not: a frame for the record. Unwatched, that means ringing Metro
  // up for long enough to hear where everything is.
  async alarm() {
    await this.ctx.storage.setAlarm(Date.now() + RECORD * 1000);
    const from = seconds(),
      now = await this.hear(from),
      snapshot = this.snapshot(now);
    if (!snapshot || !this.feeds.every(({ since }) => since))
      console.warn(
        `record: ${snapshot ? "partial" : "skipped"} after ${Math.round(now - from)}s:`,
        this.feeds
          .map(
            ({ url, socket, since }) =>
              `${url.split("/ws/")[1]} state=${socket?.readyState ?? "none"} spoke=${since ? Math.round(now - since) + "s ago" : "never"}`,
          )
          .join(", "),
      );
    if (snapshot) {
      const { sql } = this.ctx.storage;
      sql.exec(
        "INSERT OR REPLACE INTO frames VALUES (?, ?)",
        Math.round(now),
        snapshot,
      );
      sql.exec("DELETE FROM frames WHERE at < ?", now - KEEP);
      const rows = [];
      for (const [id, { heard, ...row }] of this.seen)
        if (now - heard > RECORD) this.seen.delete(id);
        else rows.push(row);
      for (const table of this.env.LAKE ? ["samples", "outbox"] : ["samples"])
        sql.exec(
          `INSERT OR REPLACE INTO ${table} VALUES (?, ?)`,
          Math.round(now),
          JSON.stringify(rows),
        );
    }
    if (!this.viewers.size) this.rest();
    await this.flush(now);
    await this.stream();
  }

  // Sends the outbox to the lake, oldest first, up to SEND bytes a time. What doesn't go waits for
  // the next minute; past OUTBOX samples it is dropped, since the Parquet files still have it.
  async stream() {
    if (!this.env.LAKE) return;
    const { sql } = this.ctx.storage;
    const waiting = sql.exec("SELECT COUNT(*) AS n FROM outbox").one().n;
    if (waiting > OUTBOX) {
      sql.exec(
        "DELETE FROM outbox WHERE at NOT IN (SELECT at FROM outbox ORDER BY at DESC LIMIT ?)",
        OUTBOX,
      );
      console.warn(`lake: dropped ${waiting - OUTBOX} samples`);
    }
    const batch = [];
    let bytes = 0;
    for (const row of sql.exec("SELECT at, vehicles FROM outbox ORDER BY at")) {
      if (batch.length && bytes + row.vehicles.length > SEND) break;
      batch.push(row);
      bytes += row.vehicles.length;
    }
    if (!batch.length) return;
    try {
      await this.env.LAKE.send(
        batch.flatMap(({ at, vehicles }) =>
          JSON.parse(vehicles).map((row) => lakeRow(at, row)),
        ),
      );
      sql.exec("DELETE FROM outbox WHERE at <= ?", batch.at(-1).at);
    } catch (error) {
      console.error("lake:", error);
    }
  }

  // Waits for every feed's say: WARM from the dial at least, up to HOLD for a slow one.
  async hear(from) {
    for (;;) {
      const now = seconds();
      this.connect(now);
      const said = ({ since }) => since && now - since >= ROUND;
      if (
        now - from >= HOLD ||
        (now - this.woke >= WARM && this.feeds.every(said))
      )
        return now;
      await new Promise((done) => setTimeout(done, 1000));
    }
  }

  async flush(now) {
    const { sql } = this.ctx.storage;
    const first = sql.exec("SELECT MIN(at) AS at FROM samples").one().at;
    if (first == null) return;
    const start = windowOf(first),
      end = start + SPAN;
    if (end > now) return;
    try {
      const rows = sql
        .exec("SELECT at, vehicles FROM samples WHERE at < ? ORDER BY at", end)
        .toArray()
        .flatMap(({ at, vehicles }) =>
          JSON.parse(vehicles).map((row) => ({ sampled_at: at, ...row })),
        );
      await this.env.ARCHIVE.put(key(start), parquet(rows));
      sql.exec("DELETE FROM samples WHERE at < ?", end);
    } catch (error) {
      console.error("archive:", error);
    }
  }

  history() {
    const now = seconds();
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT at, trains FROM frames WHERE at >= ? ORDER BY at",
        now - KEEP,
      )
      .toArray();
    const frames = now - rows.at(-1)?.at <= RECENT ? rows : [];
    return new Response(
      `{"now":${Math.round(now)},"frames":[${frames.map((row) => `{"at":${row.at},"trains":${row.trains}}`)}]}`,
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `max-age=${CACHE}`,
        },
      },
    );
  }

  // Rings up whichever feeds aren't connected.
  connect(now) {
    this.woke ||= now;
    for (const feed of this.feeds)
      if (
        !(feed.socket?.readyState <= WebSocket.OPEN) &&
        now - feed.tried >= RETRY
      )
        this.listen(feed, now);
  }

  listen(feed, now) {
    Object.assign(feed, { tried: now, since: 0 });
    const socket = (feed.socket = new WebSocket(feed.url));
    socket.addEventListener("message", ({ data }) => {
      if (feed.socket !== socket) return; // hung up on, with messages still on their way
      let message, train, row;
      try {
        message = JSON.parse(data);
        train = this.adapt(message);
        row = sample(message);
      } catch {
        return;
      }
      this.heard = seconds();
      if (!feed.since) {
        feed.since = this.heard;
        setTimeout(() => this.timer && this.tick(), ROUND * 1000 + SLACK);
      }
      if (train)
        this.trains.set(train.id, {
          ...train,
          heard: this.heard,
          spot: spot(message),
        });
      else this.trains.delete(message.id);
      if (row) this.seen.set(row.vehicle_id, { ...row, heard: this.heard });
    });
    socket.addEventListener("error", () => {});
  }

  // The trains as JSON, less the ones that have gone, or nothing while Metro hasn't been heard
  // from, not for a while or not yet: every feed gets its say first, if it answers in time.
  snapshot(now) {
    for (const [id, train] of this.trains)
      if (now - train.heard > GONE) this.trains.delete(id);
    const said = ({ since }) =>
      since ? now - since >= ROUND : now - this.woke >= WARM;
    if (now - this.heard > QUIET || !this.feeds.every(said)) return null;
    return JSON.stringify(
      unique([...this.trains.values()]).map(
        ({ seen, heard, spot, ...train }) => train,
      ),
    );
  }

  // Keeps the feeds up and sends everyone (or just `to`, who has only now joined) a snapshot.
  tick(to) {
    const now = seconds();
    this.connect(now);
    const snapshot = this.snapshot(now);
    if (!snapshot) return;
    for (const viewer of to ? [to] : this.viewers)
      try {
        viewer.send(`{"trains":${snapshot}}`);
      } catch {}
  }

  // Nobody is watching: hang up on Metro until somebody is, or the record wants a frame.
  rest() {
    clearInterval(this.timer);
    this.timer = 0;
    for (const feed of this.feeds) {
      try {
        feed.socket?.close();
      } catch {}
      Object.assign(feed, { socket: null, tried: 0, since: 0 });
    }
    this.trains.clear();
    this.seen.clear();
    this.heard = this.woke = 0;
  }
}
