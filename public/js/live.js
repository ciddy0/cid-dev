// The live feed: where LA Metro says its trains are, as the hub behind /live (worker/index.js)
// sends it every few seconds. In between, each car glides along its line towards where its train
// was last seen, at the speed the train seems to be making. As the view opens, the hub's record
// of the last hour is run through in half a minute first, every train calling at its stations
// on the way to where it is now. When no word has come for a while the feed answers null, and
// the timetable takes over.
import { clamp, easeInOutQuad } from "./math.js";
import { NOBODY, exchange, riders } from "./timetable.js";

// Seconds a snapshot is good for: long enough to see the socket through a couple of retries and
// the hub waking up, so that the timetable only takes over when Metro is really down.
export const FRESH = 120;
const GLIDE = [5, 30]; // seconds a car takes to where its train was last seen, at least and most
const HOP = 15; // seconds a hop, the fastest a car glides
const LAG = 12; // seconds a car takes to make up the minute or so the record was behind by
const FOLD = 0.8; // how far through the catch-up a snapshot can still be made its last frame
const JUMP = 2; // hops; a train seen further than this from its car has the car put there
const RETRY = [5, 15, 60]; // seconds before each try at a socket that closed, the last for good
const PAST = 60 * 60; // seconds of the record the catch-up goes back
const PACE = 4; // hops a minute, the most a train makes between two frames of the record
const WAIT = 2500; // ms the record is waited for before going on without it
const STAND = 0.3; // of the time a train took over a hop, what its car stands for, half at each end
const SWAP = 60; // seconds of the record passengers take getting off and on, at most
const CHANGE = 2; // seconds they take over it on the live feed
const RAMP = [0.04, 0.16]; // of the catch-up's time, what goes on speeding up, and on slowing into now

// The catch-up's clock, 0 → 1 of its time to 0 → 1 of the record: steady, but for the ramps.
const cruise = 1 / (1 - (RAMP[0] + RAMP[1]) / 2);
const clock = (p) =>
  p < RAMP[0]
    ? (cruise * p * p) / (2 * RAMP[0])
    : p > 1 - RAMP[1]
      ? 1 - (cruise * (1 - p) ** 2) / (2 * RAMP[1])
      : cruise * (p - RAMP[0] / 2);
// A hop as a car rides it in the catch-up, 0 → 1 of the time its train took to 0 → 1 of the
// way: standing at the station, easing out and into the next, standing there. And the other
// way round, how far through the hop's time a car that far along is.
const ridden = (time) => easeInOutQuad(clamp((time - STAND / 2) / (1 - STAND), 0, 1));
const taken = (way) => {
  if (way <= 0 || way >= 1) return clamp(way, 0, 1);
  return STAND / 2 + (1 - STAND) * (way < 0.5 ? Math.sqrt(way / 2) : 1 - Math.sqrt((1 - way) / 2));
};

const seed = (id) => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x9e3779b1), 7) >>> 8;

// Follows the trains through their snapshots, for `routes` of { line, runs }: `take(states,
// now)` is given each one as it comes, and `at(now)` is a feed like `scheduled()`'s, or null
// with nothing fresh to go on. A train is kept as `u`, the hops it has made along its run, so
// that moving it forward takes it through the stations on the way. `replay(frames, now,
// seconds, age)` has the feed first run through `frames` of { at, trains }, the record up to
// `age` seconds ago, in that many seconds. Never touches the page.
export function follower(routes) {
  const hops = new Map(
    routes.flatMap(({ line, runs }) =>
      runs.flatMap((run) =>
        run.map((h, k) => [`${line.id} ${h.from} ${h.to}`, { line: line.id, run, k }]),
      ),
    ),
  );
  const hopOf = (state) => hops.get(`${state.line} ${state.from} ${state.to}`);
  // A car is empty at either end of its run: everyone gets off at the last stop, and on as it
  // leaves the first.
  const aboard = ({ run, seed }, u) =>
    u <= 0 || u >= run.length ? NOBODY : riders(seed, Math.floor(u));
  const state = (train, u, load = aboard(train, u)) => {
    const { id, line, run } = train,
      k = Math.min(Math.floor(u), run.length - 1),
      hop = run[k];
    return { id, line, from: hop.from, to: hop.to, progress: u - k, load };
  };

  // Where a train `u` along `run` and next seen `v` along `next` turned into it, as { at, k },
  // how far along each of them: one nearing the end of the line that has been given its trip
  // back, as a rule. Or else at the next station ahead that both call at, for the ones that
  // turn back short of the end, or go on as another line. Null if it can't have.
  const turnAt = ({ run }, u, next, v) => {
    if (next === run) return null;
    if (next[0].from === run.at(-1).to && run.length - u <= JUMP) return { at: run.length, k: 0 };
    for (let k = Math.min(Math.floor(v), next.length - 1); k >= 0 && v - k <= JUMP; k--) {
      const i = run.findIndex((h, i) => h.to === next[k].from && i + 1 >= u && i + 1 - u <= JUMP);
      if (i >= 0) return { at: i + 1, k };
    }
    return null;
  };
  // Who is on a car of the live feed at `now`: once its train is somewhere that changes who is
  // `aboard`, they take CHANGE seconds getting off and on.
  function changed(train, now) {
    const load = aboard(train, train.u),
      stop = load.join();
    if (stop !== train.stop)
      Object.assign(train, { stop, was: train.load ?? load, since: now });
    return (train.load = exchange(train.was, load, (now - train.since) / CHANGE));
  }
  // How far through making up what the record was behind by: off gently, and gently in.
  const lagged = (train, now) => easeInOutQuad(clamp((now - train.lag.since) / LAG, 0, 1));

  const trains = new Map();
  let heard = -Infinity,
    last = 0,
    lapse = null;

  // `late` marks trains put where the record ends, to be brought gently up to date.
  function take(states, now, late = false) {
    heard = now;
    if (lapse) return void (fold(states, now) || (lapse.news = states)); // or for when it's over
    const live = new Set();
    for (const s of states) {
      const hop = hopOf(s);
      if (!hop) continue;
      live.add(s.id);
      const goal = hop.k + s.progress,
        train = trains.get(s.id);
      const turn =
        train?.turn?.run === hop.run ? train.turn : train && turnAt(train, train.u, hop.run, goal);
      if (turn) {
        // Headed back already, by the feed: its car gets to where the train turned first.
        if (!train.turn) head(train, turn.at, now);
        train.turn = { at: turn.at, k: turn.k, line: hop.line, run: hop.run, goal };
      } else if (train?.run !== hop.run || Math.abs(goal - train.u) > JUMP) {
        const made = { u: goal, goal, speed: 0, changed: now, late, load: s.load };
        trains.set(s.id, { ...hop, id: s.id, seed: seed(s.id), ...made });
      } else if (goal > train.goal) head(train, goal, now); // (a car never backs up)
    }
    for (const id of trains.keys()) if (!live.has(id)) trains.delete(id);
  }
  // Sets a car off for `goal`, further along its run.
  function head(train, goal, now) {
    if (train.late) Object.assign(train, { late: false, lag: { from: train.u, since: now } });
    if (train.lag) {
      // Still making up for the record: carry on from where it is, to there instead.
      const e = lagged(train, now);
      if (e < 1) train.lag.from = (train.u - goal * e) / (1 - e);
      train.goal = goal;
      return;
    }
    // There in about as long as it took the train, and never at a dash.
    const over = Math.max(clamp(now - train.changed, ...GLIDE), (goal - train.u) * HOP);
    Object.assign(train, { goal, speed: (goal - train.u) / over, changed: now });
  }

  // Adds a train as it was seen at `at` to the `tracks` of a record: every train as its `keys`,
  // each of them when, on which run and how far along.
  function key(tracks, s, at) {
    const hop = hopOf(s);
    if (!hop) return;
    if (!tracks.has(s.id)) tracks.set(s.id, { id: s.id, seed: seed(s.id), keys: [] });
    const keys = tracks.get(s.id).keys,
      was = keys.at(-1),
      u = hop.k + s.progress;
    const wavered = was?.run === hop.run && u < was.u && was.u - u <= JUMP;
    keys.push({ at, line: hop.line, run: hop.run, u: wavered ? was.u : u });
  }
  // A train's keys as the rides its car makes of them: each a stretch along one run, as the
  // `stops` on the way. A new one starts where the train turned into another run, which counts
  // as along its run, and wherever it wasn't seen to get from one key to the next, where the
  // car stands until it is put at the next. A ride that begins a run or ends one has `boards`
  // or `empties` on its first or last stop.
  function rides(keys) {
    const made = [];
    let pts;
    const start = ({ line, run }, at, u, turned) =>
      made.push({ line, run, at, turned, pts: (pts = [[at, u]]) });
    keys.forEach((b, i) => {
      const a = keys[i - 1],
        turn = a && turnAt(a, a.u, b.run, b.u),
        rode = a?.run === b.run ? b.u - a.u : turn ? turn.at - a.u + b.u - turn.k : -1;
      if (rode < 0 || rode > 1 + (PACE * (b.at - a.at)) / 60) return start(b, b.at, b.u);
      if (turn) {
        const at = rode ? a.at + ((turn.at - a.u) / rode) * (b.at - a.at) : b.at;
        pts.push([at, turn.at]);
        start(b, at, turn.k, true);
      }
      pts.push([b.at, b.u]);
    });
    made.forEach((ride, i) => {
      const next = made[i + 1],
        [first] = (ride.stops = stops(ride.pts)),
        last = ride.stops.at(-1);
      first.boards = ride.turned || first.u === 0;
      last.empties = next?.turned || last.u === ride.run.length;
      if (next?.turned) last.out = next.at; // everyone off by then
    });
    return made;
  }
  // The stops of a ride through `pts` of [when, how far along]: where it starts and ends, and
  // every station between, each { u, arr, dep }, when the train got there and left, which for a
  // station it was never seen at is when it must have passed. Whatever happened in between,
  // the car takes each hop as one, so that it only ever stands at a station, or where it was
  // last seen: `from` and `rate` are how far through the hop's time it sets off, and how fast
  // that then goes. It stands at a station from `in` to `out`.
  function stops(pts) {
    const first = pts[0][1],
      last = pts.at(-1)[1],
      us = [first];
    for (let n = Math.floor(first) + 1; n < last; n++) us.push(n);
    if (last > first) us.push(last);
    const list = us.map((u) => {
      const i = pts.findIndex(([, v]) => v >= u),
        j = pts.findLastIndex(([, v]) => v <= u),
        [t0, u0] = pts[i - 1] ?? pts[i],
        [t1, u1] = pts[i];
      const passed = u1 > u ? t0 + ((u - u0) / (u1 - u0)) * (t1 - t0) : null,
        n = Math.floor(u),
        dep = passed ?? pts[u > n ? i : j][0]; // (between stations, it is off at once)
      return { u, n, arr: passed ?? t1, dep, in: -Infinity, out: Infinity };
    });
    list.forEach((p, k) => {
      const q = list[k + 1];
      if (!q) return;
      p.from = taken(p.u - p.n);
      p.rate = (taken(q.u - p.n) - p.from) / (q.arr - p.dep);
      p.out = p.dep + (STAND / 2 - p.from) / p.rate;
      q.in = p.dep + (1 - STAND / 2 - p.from) / p.rate;
    });
    return list;
  }
  function replay(frames, now, seconds, age = 30) {
    const tracks = new Map();
    for (const { at, trains } of frames) for (const s of trains) key(tracks, s, at);
    for (const track of tracks.values()) track.rides = rides(track.keys);
    const end = frames.at(-1).at,
      start = Math.max(frames[0].at, end - PAST);
    lapse = { tracks, start, end, record: end, age, from: now, seconds, upTo: end, since: 0 };
    if (!(seconds > 0)) settle(now);
  }
  // Where the catch-up ends, `p` of the way through it: the record does a little before now,
  // and news that comes in the meantime is let into it over what is left.
  const ending = ({ upTo, end, since }, p) =>
    upTo + (end - upTo) * clamp((p - since) / (1 - since), 0, 1);
  // A snapshot that comes during the catch-up becomes the record's last frame, so that it ends
  // on now, unless there is next to nothing left of it.
  function fold(states, now) {
    const p = (now - lapse.from) / lapse.seconds;
    if (p > FOLD) return false;
    const end = Math.max(lapse.end + 1, lapse.record + lapse.age + (now - lapse.from));
    Object.assign(lapse, { upTo: ending(lapse, p), since: p, end });
    for (const s of states) key(lapse.tracks, s, end);
    for (const track of lapse.tracks.values())
      if (track.keys.at(-1).at === end) track.rides = rides(track.keys);
    return true;
  }
  // Who is aboard at a `stop` of a ride at `time`. They change over as the car pulls in,
  // except at the start of its run, where they get on as it is about to leave.
  const changing = ({ seed }, { u, arr, in: came, out: left, boards, empties }, time) =>
    boards
      ? exchange(NOBODY, riders(seed, u), 1 - (left - time) / Math.min(SWAP, left - arr))
      : exchange(
          riders(seed, u - 1),
          empties ? NOBODY : riders(seed, u),
          (time - came) / Math.min(SWAP, left - came),
        );
  // Where the record has a train at `time`, and who is on it: at a stop of the ride it was on,
  // or on its way from one to the next.
  function recorded(track, time) {
    const { id, seed, keys } = track,
      last = keys.at(-1).at;
    // Not out yet, or gone in since.
    if (time < keys[0].at || (time >= last && last < lapse.end)) return [];
    const { line, run, stops } = track.rides.findLast((ride) => ride.at <= time),
      k = stops.findLastIndex((stop) => stop.arr <= time),
      p = stops[k],
      q = stops[k + 1];
    const u = !q || time <= p.dep ? p.u : p.n + ridden(p.from + p.rate * (time - p.dep));
    const at = [q, p].find((s) => s && s.u === s.n && time >= s.in && time <= s.out),
      load = at ? changing(track, at, time) : riders(seed, p.n);
    return [state({ id, line, run }, u, load)];
  }
  // The catch-up is over: every car carries on from where it left it, towards the latest news.
  function settle(now) {
    const { tracks, end, record, news } = lapse;
    const ended = [...tracks.values()].flatMap((track) => recorded(track, end));
    lapse = null;
    last = now;
    trains.clear();
    take(ended, now, end === record);
    if (news) take(news, now);
  }

  function at(now) {
    if (lapse) {
      const p = (now - lapse.from) / lapse.seconds;
      if (p < 1) {
        const time = lapse.start + (ending(lapse, p) - lapse.start) * clock(Math.max(0, p));
        return [...lapse.tracks.values()].flatMap((track) => recorded(track, time));
      }
      settle(now);
    }
    if (now - heard > FRESH || !trains.size) return null;
    const dt = Math.max(0, now - last);
    last = now;
    return Array.from(trains.values(), (train) => {
      if (train.lag) {
        const e = lagged(train, now);
        train.u = train.lag.from + (train.goal - train.lag.from) * e;
        if (e >= 1) Object.assign(train, { lag: null, speed: 0, changed: now });
      } else train.u = Math.min(train.goal, train.u + train.speed * dt);
      if (train.turn && train.u >= train.turn.at) {
        const { k, line, run, goal } = train.turn;
        Object.assign(train, { line, run, turn: null, lag: null, u: k, goal: k, speed: 0 });
        if (goal > k) head(train, goal, now);
      }
      return state(train, train.u, changed(train, now));
    });
  }
  return { take, replay, at };
}

// The socket to /live, and the record at /live/history. Returns { feed, watch }: `watch(on)`
// opens or closes the socket (it is also closed while the page is hidden), and each time it
// opens the feed starts by catching up, in `catchUp()` seconds for a whole record. `feed` is the
// follower's, with no trains at all while the record is on its way. `onNews()` is called
// whenever there is something new to draw.
export function live(routes, { onNews = () => {}, catchUp = () => 0 } = {}) {
  const follow = follower(routes);
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`;
  let socket = null,
    wanted = false,
    fails = 0,
    timer = 0,
    recorded = true, // until the hub turns out not to be there
    waiting = null; // the record being fetched
  function open() {
    clearTimeout(timer);
    if (socket || !wanted || document.hidden) return;
    const mine = (socket = new WebSocket(url));
    mine.onmessage = ({ data }) => {
      try {
        follow.take(JSON.parse(data).trains, Date.now() / 1000);
      } catch {
        return;
      }
      fails = 0;
      onNews();
    };
    mine.onclose = () => {
      if (socket !== mine) return;
      socket = null;
      timer = setTimeout(open, RETRY[Math.min(fails++, RETRY.length - 1)] * 1000);
    };
  }
  function close() {
    clearTimeout(timer);
    const mine = socket;
    socket = null;
    mine?.close();
  }
  async function history() {
    if (!recorded) return;
    const mine = (waiting = {});
    try {
      const res = await fetch("/live/history", { signal: AbortSignal.timeout(WAIT) });
      recorded = res.ok;
      const { now, frames } = await res.json();
      if (waiting === mine && frames.length > 1) {
        // Less of a record than the whole of PAST is run through at the same speed.
        const end = frames.at(-1).at,
          seconds = (catchUp() * Math.min(end - frames[0].at, PAST)) / PAST;
        follow.replay(frames, Date.now() / 1000, seconds, now - end);
      }
    } catch {}
    if (waiting !== mine) return;
    waiting = null;
    onNews();
  }
  // Back after long enough for the trains to be stale: caught up on, as when the view opens.
  let left = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return void ((left = Date.now() / 1000), close());
    if (wanted && Date.now() / 1000 - left > FRESH) history();
    open();
  });
  return {
    feed: (now) => (waiting ? [] : follow.at(now)),
    watch(on) {
      if (on && !wanted) history();
      if (!on) waiting = null;
      wanted = on;
      if (on) open();
      else close();
    },
  };
}
