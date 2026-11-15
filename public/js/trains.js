// The trains: a feed says where every train is, and this puts a car there. The feed is the live
// one (live.js) while it has word from Metro, and the timetable (timetable.js) otherwise.
import { el } from "./dom.js";
import { round } from "./math.js";
import { live } from "./live.js";
import { lineColor } from "./network.js";
import { prefs } from "./prefs.js";
import { rail } from "./rail.js";
import { drone } from "./sound.js";
import { SEATS, runs, scheduled } from "./timetable.js";

const CATCH_UP = 30;
const ALIGHT = 120;
const CAR_LONG = 3.2;
const CAR_WIDE = 1.9;
const CAR_CORNER = 0.08;
const RIDER = 0.15;
const ROWS = 0.86;
const AISLE = 0.23;

export function trains(
  { tracks, layers, lane },
  map,
  { onArrive = () => {} } = {},
) {
  const long = lane * CAR_LONG,
    wide = lane * CAR_WIDE;
  const rails = new Map(
    tracks.map((track) => [track, rail(track, layers.trains)]),
  );
  const routes = map.lines.map((line) => ({
    line,
    runs: runs(line, tracks, rails),
  }));
  const hops = new Map(
    routes.flatMap(({ line, runs }) =>
      runs
        .flat()
        .map((h) => [`${line.id} ${h.from} ${h.to}`, { line, legs: h.legs }]),
    ),
  );

  const cars = new Map();
  function car() {
    const g = el("g", { class: "train" }, layers.trains);
    const body = el(
      "rect",
      {
        x: -long / 2,
        y: -wide / 2,
        width: long,
        height: wide,
        rx: wide * CAR_CORNER,
      },
      g,
    );
    return {
      g,
      body,
      riders: el("g", { class: "riders" }, g),
      load: null,
      seats: [],
    };
  }
  // Passengers sit two abreast, the first seats at the front. One who gets on pops into their
  // seat and one who gets off shrinks out of it, except on a car only now put on the map.
  const r = wide * RIDER;
  const rider = {
    circle: (x, y, to) => el("circle", { cx: x, cy: y, r }, to),
    square: (x, y, to) =>
      el(
        "rect",
        { x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8 },
        to,
      ),
    triangle: (x, y, to) =>
      el(
        "path",
        { d: `M${x + r * 1.1} ${y}l${-r * 2} ${r * 1.15}v${-r * 2.3}z` },
        to,
      ),
  };
  function seat(car, load = []) {
    if (car.load === load.join()) return;
    const fresh = car.load == null;
    car.load = load.join();
    const rows = SEATS / 2,
      pitch = (long * ROWS) / rows;
    for (let k = 0; k < SEATS; k++) {
      const was = car.seats[k],
        shape = load[k] ?? null;
      if (shape === (was?.shape ?? null)) continue;
      if (was && prefs.motion) {
        was.el.setAttribute("class", "off");
        setTimeout(() => was.el.remove(), ALIGHT);
      } else was?.el.remove();
      const x = (rows / 2 - Math.floor(k / 2) - 0.5) * pitch,
        y = (k % 2 ? 1 : -1) * wide * AISLE;
      const made = rider[shape]?.(round(x), round(y), car.riders);
      if (made && !fresh) made.setAttribute("class", "on");
      car.seats[k] = made && { shape, el: made };
    }
  }

  // Put a car on every train in `states`, and take away the cars of trains no longer in it.
  function show(states) {
    const live = new Set();
    for (const state of states) {
      const hop = hops.get(`${state.line} ${state.from} ${state.to}`);
      if (!hop) continue;
      live.add(state.id);
      if (!cars.has(state.id)) cars.set(state.id, car());
      const it = cars.get(state.id);
      if (it.line !== hop.line)
        it.body.style.fill = lineColor((it.line = hop.line));
      seat(it, state.load);
      const at =
        state.progress >= 1
          ? state.to
          : state.progress <= 0
            ? state.from
            : null;
      if (it.moving && (at || it.to === state.from))
        onArrive(hop.line, at ?? state.from);
      it.moving = !at;
      it.to = state.to;
      let d =
        state.progress *
        hop.legs.reduce((sum, [, a, b]) => sum + Math.abs(b - a), 0);
      const [track, a, b] = hop.legs.find(([, a, b], k) => {
        if (d <= Math.abs(b - a) || k === hop.legs.length - 1) return true;
        d -= Math.abs(b - a);
      });
      const way = b < a ? -1 : 1,
        s = a + way * d;
      const [x, y] = track.at(s),
        [fx, fy] = track.at(s + (way * long) / 3),
        [bx, by] = track.at(s - (way * long) / 3);
      const turn = (Math.atan2(fy - by, fx - bx) * 180) / Math.PI;
      it.g.setAttribute(
        "transform",
        `translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${turn.toFixed(1)})`,
      );
    }
    for (const [id, { g }] of cars)
      if (!live.has(id)) {
        g.remove();
        cars.delete(id);
      }
  }

  const feed = scheduled(routes);
  let frame = 0,
    running = false;
  const tick = () => {
    const now = Date.now() / 1000,
      states = real.feed(now) ?? feed(now);
    show(states);
    drone(states.filter((s) => s.progress % 1).length / (states.length || 1));
    frame = prefs.motion ? requestAnimationFrame(tick) : 0;
  };
  const real = live(routes, {
    onNews: () => running && !frame && tick(),
    catchUp: () => (prefs.motion ? CATCH_UP : 0),
  });
  function run(on) {
    running = on;
    cancelAnimationFrame(frame);
    frame = on ? requestAnimationFrame(tick) : 0;
    real.watch(on);
    if (!on) drone(null);
  }
  return { run };
}
