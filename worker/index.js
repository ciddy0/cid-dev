// The Worker in front of the page. Everything is a static asset except /live, a websocket that
// sends where LA Metro's trains are every few seconds. One Durable Object, the hub, holds the
// only sockets to Metro and fans out to every visitor, so Metro sees the same connections
// however many people are watching, and none when nobody is.
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
const WARM = 8; // seconds Metro takes to get through every vehicle once the hub starts listening
const GONE = 300; // seconds since a train last reported before it is dropped
const RETRY = 30; // seconds between tries at a feed that is down

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname !== "/live") return env.ASSETS.fetch(request);
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This is a websocket.", { status: 426 });
    return env.LIVE.get(env.LIVE.idFromName("hub")).fetch(request);
  },
};

// A snapshot is { trains: [{ id, line, from, to, progress }] }: what `show()` in
// public/js/trains.js takes, less the passengers. A page that stops getting them falls back on
// the timetable.
export class LiveHub extends DurableObject {
  viewers = new Set();
  feeds = FEEDS.map((url) => ({ url, socket: null, tried: 0 }));
  trains = new Map(); // vehicle id → where the feed last put it
  heard = 0; // when Metro last said anything
  woke = 0; // when the first viewer came
  timer = 0;
  adapt = adapter(map);

  fetch() {
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
    if (!this.timer) {
      this.woke = Date.now() / 1000;
      this.timer = setInterval(() => this.tick(), EVERY * 1000);
    }
    this.tick(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Keeps the feeds up, forgets trains that have gone, and sends everyone (or just `to`, who
  // has only now joined) a snapshot.
  tick(to) {
    const now = Date.now() / 1000;
    for (const feed of this.feeds)
      if (!(feed.socket?.readyState <= WebSocket.OPEN) && now - feed.tried >= RETRY)
        this.listen(feed, now);
    for (const [id, train] of this.trains) if (now - train.seen > GONE) this.trains.delete(id);
    if (now - this.heard > QUIET || now - this.woke < WARM) return;
    const snapshot = JSON.stringify({
      trains: Array.from(this.trains.values(), ({ seen, ...train }) => train),
    });
    for (const viewer of to ? [to] : this.viewers)
      try {
        viewer.send(snapshot);
      } catch {}
  }

  listen(feed, now) {
    feed.tried = now;
    feed.socket = new WebSocket(feed.url);
    feed.socket.addEventListener("message", ({ data }) => {
      let message, train;
      try {
        message = JSON.parse(data);
        train = this.adapt(message);
      } catch {
        return;
      }
      this.heard = Date.now() / 1000;
      if (train) this.trains.set(train.id, train);
      else this.trains.delete(message.id);
    });
    feed.socket.addEventListener("error", () => {}); // `tick` tries again
  }

  // Nobody is watching: hang up on Metro until somebody is.
  rest() {
    clearInterval(this.timer);
    this.timer = 0;
    for (const feed of this.feeds) {
      try {
        feed.socket?.close();
      } catch {}
      Object.assign(feed, { socket: null, tried: 0 });
    }
    this.trains.clear();
    this.heard = 0;
  }
}
