// The live feed: where LA Metro says its trains are, as the hub behind /live (worker/index.js)
// sends it every few seconds. In between, each car eases along its line towards where its train
// was last seen. When no word has come for a while the feed answers null, and the timetable
// takes over.
import { riders } from "./timetable.js";

const FRESH = 30; // seconds a snapshot is good for
const EASE = 3; // seconds a car takes over most of the way to where its train was last seen
const JUMP = 2; // hops; a train seen further than this from its car has the car put there
const RETRY = [5, 15, 60]; // seconds before each try at a socket that closed, the last for good

const seed = (id) => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x9e3779b1), 7) >>> 8;

// Follows the trains through their snapshots, for `routes` of { line, runs }: `take(states,
// now)` is given each one as it comes, and `at(now)` is a feed like `scheduled()`'s, or null
// with nothing fresh to go on. A train is kept as `u`, the hops it has made along its run, so
// that easing it forward takes it through the stations on the way. Never touches the page.
export function follower(routes) {
  const hops = new Map(
    routes.flatMap(({ line, runs }) =>
      runs.flatMap((run) =>
        run.map((h, k) => [`${line.id} ${h.from} ${h.to}`, { line: line.id, run, k }]),
      ),
    ),
  );
  const trains = new Map();
  let heard = -Infinity,
    last = -Infinity;
  return {
    take(states, now) {
      heard = now;
      const live = new Set();
      for (const state of states) {
        const hop = hops.get(`${state.line} ${state.from} ${state.to}`);
        if (!hop) continue;
        live.add(state.id);
        const goal = hop.k + state.progress,
          train = trains.get(state.id);
        // Its position wavers; a car never backs up over that.
        if (train?.run === hop.run && Math.abs(goal - train.u) <= JUMP)
          train.goal = Math.max(goal, train.u);
        else trains.set(state.id, { ...hop, id: state.id, seed: seed(state.id), u: goal, goal });
      }
      for (const id of trains.keys()) if (!live.has(id)) trains.delete(id);
    },
    at(now) {
      if (now - heard > FRESH || !trains.size) return null;
      const pull = 1 - Math.exp(-Math.max(0, now - last) / EASE);
      last = now;
      return Array.from(trains.values(), (train) => {
        train.u += (train.goal - train.u) * pull;
        if (train.goal - train.u < 1e-3) train.u = train.goal;
        const k = Math.min(Math.floor(train.u), train.run.length - 1),
          hop = train.run[k];
        return {
          id: train.id,
          line: train.line,
          from: hop.from,
          to: hop.to,
          progress: train.u - k,
          load: riders(train.seed, k),
        };
      });
    },
  };
}

// The socket to /live. Returns { feed, watch }: `watch(on)` opens or closes it (it is also
// closed while the page is hidden), `feed` is the follower's, and `onNews()` is called with
// each snapshot.
export function live(routes, onNews = () => {}) {
  const follow = follower(routes);
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`;
  let socket = null,
    wanted = false,
    fails = 0,
    timer = 0;
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
  document.addEventListener("visibilitychange", () => (document.hidden ? close() : open()));
  return {
    feed: follow.at,
    watch(on) {
      wanted = on;
      if (on) open();
      else close();
    },
  };
}
