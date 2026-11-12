// The live feed: where LA Metro says its trains are, as the hub behind /live (worker/index.js)
// sends it every few seconds. In between, each car glides along its line towards where its train
// was last seen, at the speed the train seems to be making. As the view opens, the hub's record of the last half hour is run through in a
// few seconds first, the trains racing in to where they are now. When no word has come for a
// while the feed answers null, and the timetable takes over.
import { bezier, clamp, easeInOutQuad } from "./math.js";
import { riders } from "./timetable.js";

// Seconds a snapshot is good for: long enough to see the socket through a couple of retries and
// the hub waking up, so that the timetable only takes over when Metro is really down.
export const FRESH = 120;
const GLIDE = [5, 30]; // seconds a car takes to where its train was last seen, at least and most
const HOP = 15; // seconds a hop, the fastest a car glides
const LAG = 12; // seconds a car takes to make up the minute or so the record was behind by
const FOLD = 0.8; // how far through the catch-up a snapshot can still be made its last frame
const JUMP = 2; // hops; a train seen further than this from its car has the car put there
const RETRY = [5, 15, 60]; // seconds before each try at a socket that closed, the last for good
const PAST = 30 * 60; // seconds of the record the catch-up goes back
const PACE = 4; // hops a minute, the most a train makes between two frames of the record
const WAIT = 2500; // ms the record is waited for before going on without it
const settling = bezier(0.33, 1, 0.68, 1); // the catch-up's clock: flat out, then easing into now

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
  const state = ({ id, line, run, seed }, u) => {
    const k = Math.min(Math.floor(u), run.length - 1),
      hop = run[k];
    return { id, line, from: hop.from, to: hop.to, progress: u - k, load: riders(seed, k) };
  };

  // Whether a train `u` along `run` and next seen on `next` is one nearing the end of the line
  // that has been given its trip back.
  const turnsInto = ({ run }, u, next) =>
    next !== run && next[0].from === run.at(-1).to && run.length - u <= JUMP;
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
      if (train && turnsInto(train, train.u, hop.run)) {
        // Headed back already, by the feed: its car gets to the end of the line first.
        if (!train.turn) head(train, train.run.length, now);
        train.turn = { run: hop.run, goal };
      } else if (train?.run !== hop.run || Math.abs(goal - train.u) > JUMP) {
        const made = { u: goal, goal, speed: 0, changed: now, late };
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
    if (!tracks.has(s.id)) tracks.set(s.id, { ...hop, id: s.id, seed: seed(s.id), keys: [] });
    const keys = tracks.get(s.id).keys,
      was = keys.at(-1),
      u = hop.k + s.progress;
    const wavered = was?.run === hop.run && u < was.u && was.u - u <= JUMP;
    keys.push({ at, run: hop.run, u: wavered ? was.u : u });
  }
  function replay(frames, now, seconds, age = 30) {
    const tracks = new Map();
    for (const { at, trains } of frames) for (const s of trains) key(tracks, s, at);
    const end = frames.at(-1).at,
      start = Math.max(frames[0].at, end - PAST);
    lapse = { tracks, start, end, from: now, seconds, age, upTo: end, since: 0 };
    if (!(seconds > 0)) settle(now);
  }
  // The first snapshot to come during the catch-up becomes the record's last frame, so that it
  // ends on now. The clock is let out to it over what is left, unless that is next to nothing.
  function fold(states, now) {
    const p = (now - lapse.from) / lapse.seconds;
    if (lapse.end > lapse.upTo || p > FOLD) return false;
    lapse.end = lapse.upTo + lapse.age + (now - lapse.from);
    lapse.since = p;
    for (const s of states) key(lapse.tracks, s, lapse.end);
    return true;
  }
  // Where the record has a train at `time`: between the two frames either side, if it got from
  // one to the other along its run, and else standing where the earlier one saw it.
  function recorded({ keys, ...train }, time) {
    const i = keys.findLastIndex((key) => key.at <= time),
      a = keys[i],
      b = keys[i + 1];
    if (!a || (!b && a.at < lapse.end)) return []; // not out yet, or gone in since
    // To the end of the line and back out again counts as along its run.
    const turned = b && turnsInto(a, a.u, b.run),
      made = b?.run === a.run ? b.u - a.u : turned ? a.run.length - a.u + b.u : -1;
    const rode = made >= 0 && made <= 1 + (PACE * (b.at - a.at)) / 60;
    const u = rode ? a.u + (made * (time - a.at)) / (b.at - a.at) : a.u;
    if (turned && u >= a.run.length) return [state({ ...train, run: b.run }, u - a.run.length)];
    return [state({ ...train, run: a.run }, u)];
  }
  // The catch-up is over: every car carries on from where it left it, towards the latest news.
  function settle(now) {
    const { tracks, end, upTo, news } = lapse;
    const ended = [...tracks.values()].flatMap((track) => recorded(track, end));
    lapse = null;
    last = now;
    trains.clear();
    take(ended, now, end === upTo);
    if (news) take(news, now);
  }

  function at(now) {
    if (lapse) {
      const p = (now - lapse.from) / lapse.seconds;
      if (p < 1) {
        const out = clamp((p - lapse.since) / (1 - lapse.since), 0, 1),
          end = lapse.upTo + (lapse.end - lapse.upTo) * out;
        const time = lapse.start + (end - lapse.start) * settling(Math.max(0, p));
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
      if (train.turn && train.u >= train.run.length) {
        const { run, goal } = train.turn;
        Object.assign(train, { run, turn: null, lag: null, u: 0, goal: 0, speed: 0 });
        if (goal > 0) head(train, goal, now);
      }
      return state(train, train.u);
    });
  }
  return { take, replay, at };
}

// The socket to /live, and the record at /live/history. Returns { feed, watch }: `watch(on)`
// opens or closes the socket (it is also closed while the page is hidden), and each time it
// opens the feed starts by catching up, in `catchUp()` seconds. `feed` is the follower's, with
// no trains at all while the record is on its way. `onNews()` is called whenever there is
// something new to draw.
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
      if (waiting === mine && frames.length > 1)
        follow.replay(frames, Date.now() / 1000, catchUp(), now - frames.at(-1).at);
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
