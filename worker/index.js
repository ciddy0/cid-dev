// The Worker in front of the page. Everything is a static asset except /live, a websocket that
// sends where LA Metro's trains are every few seconds, and /live/history, where they have been
// over the last half hour. One Durable Object, the hub, holds the only sockets to Metro and
// fans out to every visitor, so Metro sees the same connections however many people are
// watching. With nobody watching it still looks in once a minute, to keep the record.
import { DurableObject } from "cloudflare:workers";
import map from "../public/data/metro.json";
import { adapter } from "./adapt.js";

// GTFS-realtime vehicle positions as JSON, a message per vehicle, no API key: every rail
// vehicle, and the buses of the G Line (route 901).
const FEEDS = [
  "wss://api.metro.net/ws/LACMTA_Rail/vehicle_positions",
  "wss://api.metro.net/ws/LACMTA/vehicle_positions/901",
];
const EVERY = 5; // seconds between snapshots
const QUIET = 30; // seconds without a word from Metro before the snapshots stop
const WARM = 8; // seconds given to Metro to connect and get through every vehicle
const ROUND = 1.5; // seconds a feed takes over every vehicle, from the first it sends
const GONE = 300; // seconds since a train last reported before it is dropped
const RETRY = 30; // seconds between tries at a feed that is down
const RECORD = 60; // seconds between frames of the record
const KEEP = 35 * 60; // seconds a frame is kept, a little over what the page plays back
const RECENT = 180; // seconds old the last frame can be for the record to be worth playing

const seconds = () => Date.now() / 1000;

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/live" && pathname !== "/live/history") return env.ASSETS.fetch(request);
    return env.LIVE.get(env.LIVE.idFromName("hub")).fetch(request);
  },
};

// A snapshot is { trains: [{ id, line, from, to, progress }] }: what `show()` in
// public/js/trains.js takes, less the passengers. A page that stops getting them falls back on
// the timetable. The record is { now, frames: [{ at, trains }] }, a snapshot a minute with the
// time it was taken, oldest first, and the time by the same clock.
export class LiveHub extends DurableObject {
  viewers = new Set();
  feeds = FEEDS.map((url) => ({ url, socket: null, tried: 0, since: 0 })); // since: its first word
  trains = new Map(); // vehicle id → where the feed last put it
  heard = 0; // when Metro last said anything
  woke = 0; // when the hub started listening
  timer = 0;
  adapt = adapter(map);

  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS frames (at INTEGER PRIMARY KEY, trains TEXT NOT NULL)",
    );
    // The record starts with the first visit, and from then on keeps itself going.
    ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) == null) await ctx.storage.setAlarm(Date.now());
    });
  }

  fetch(request) {
    if (new URL(request.url).pathname === "/live/history") return this.history();
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
    if (!this.woke) {
      this.connect(seconds());
      await new Promise((done) => setTimeout(done, WARM * 1000));
    }
    const now = seconds(),
      snapshot = this.snapshot(now);
    if (snapshot) {
      const { sql } = this.ctx.storage;
      sql.exec("INSERT OR REPLACE INTO frames VALUES (?, ?)", Math.round(now), snapshot);
      sql.exec("DELETE FROM frames WHERE at < ?", now - KEEP);
    }
    if (!this.viewers.size) this.rest();
  }

  history() {
    const now = seconds();
    const rows = this.ctx.storage.sql
      .exec("SELECT at, trains FROM frames WHERE at >= ? ORDER BY at", now - KEEP)
      .toArray();
    const frames = now - rows.at(-1)?.at <= RECENT ? rows : [];
    return new Response(
      `{"now":${Math.round(now)},"frames":[${frames.map((row) => `{"at":${row.at},"trains":${row.trains}}`)}]}`,
      { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=20" } },
    );
  }

  // Rings up whichever feeds aren't connected.
  connect(now) {
    this.woke ||= now;
    for (const feed of this.feeds)
      if (!(feed.socket?.readyState <= WebSocket.OPEN) && now - feed.tried >= RETRY)
        this.listen(feed, now);
  }

  listen(feed, now) {
    Object.assign(feed, { tried: now, since: 0 });
    const socket = (feed.socket = new WebSocket(feed.url));
    socket.addEventListener("message", ({ data }) => {
      if (feed.socket !== socket) return; // hung up on, with messages still on their way
      let message, train;
      try {
        message = JSON.parse(data);
        train = this.adapt(message);
      } catch {
        return;
      }
      this.heard = seconds();
      if (!feed.since) {
        // Whoever woke the hub gets a snapshot as soon as there is a whole one.
        feed.since = this.heard;
        setTimeout(() => this.timer && this.tick(), ROUND * 1000 + 100);
      }
      if (train) this.trains.set(train.id, train);
      else this.trains.delete(message.id);
    });
    socket.addEventListener("error", () => {}); // `connect` tries again
  }

  // The trains as JSON, less the ones that have gone, or nothing while Metro hasn't been heard
  // from, not for a while or not yet: every feed gets its say first, if it answers in time.
  snapshot(now) {
    for (const [id, train] of this.trains) if (now - train.seen > GONE) this.trains.delete(id);
    const said = ({ since }) => (since ? now - since >= ROUND : now - this.woke >= WARM);
    if (now - this.heard > QUIET || !this.feeds.every(said)) return null;
    return JSON.stringify(Array.from(this.trains.values(), ({ seen, ...train }) => train));
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
    this.heard = this.woke = 0;
  }
}
